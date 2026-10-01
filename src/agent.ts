// The turn loop: route -> recall -> generate (typed) -> calculate -> verify -> retry or decline.
// Memory is written only from what the user states. Model output is never stored, so a wrong answer cannot poison later ones.
import { Darle, RELS, realize, type Fact } from './darle.ts';
import { obj, str, bool, arr, check, jsonSchema, type I } from './typed.ts';
import { calc } from './calc.ts';
import { complete, type LlmConfig, type Msg } from './llm.ts';
import { classifyWorkload, type Workload } from './model-routing.ts';
import { selectModel } from './model-registry.ts';
import { completeNeedle, type NeedleConfig } from './needle-client.ts';

const CLAIM = obj({ s: str(40), rel: str(30), o: str(40), neg: bool() });
export const TURN = obj({ answer: str(1500), claims: arr(CLAIM, 8), calc: str(120) });
type Turn = I<typeof TURN>;
export interface ClaimStatus { fact: string; status: 'supported' | 'contradicted' | 'unknown'; proof: string[] }
export interface TurnResult { text: string; route: 'memory' | 'calc' | 'model' | 'none'; claims: ClaimStatus[]; proof: string[]; notes: string[]; tokens: number; touched?: string }

const MAX_TRIES = 4, SCHEMA = jsonSchema(TURN);
const SYSTEM = `You are the language layer of DARLE. Reply with JSON only. "answer": a short, direct reply. "claims": every checkable fact you assert as {s, rel, o, neg}; rel must be one of: ${RELS.join(', ')}. Use [] if none. "calc": an arithmetic expression to evaluate exactly (digits and + - * / % ^ ( ) sqrt abs only), or "" if not needed. Never do arithmetic yourself; use calc. Prefer KNOWN FACTS over your own memory. If you do not know, say so plainly.`;
const nz = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(the|a|an) /, '');
class Bad extends Error {}

export class Agent {
  mem: Darle; llm: LlmConfig | null; needle: NeedleConfig | null; fetchFn: typeof fetch; history: Msg[] = []; private needleSequence = 0;
  constructor(mem: Darle, llm: LlmConfig | null, fetchFn: typeof fetch = fetch, needle: NeedleConfig | null = null) { this.mem = mem; this.llm = llm; this.fetchFn = fetchFn; this.needle = needle; }

  async turn(text: string): Promise<TurnResult> {
    const ex = text.replace(/^(what is|what's|calculate|compute)\s+/i, '').replace(/[?=\s]+$/, '');
    if (/^[\d\s+\-*/%^().]+$/.test(ex) && /\d/.test(ex) && /[-+*/%^]/.test(ex)) {
      try { return this.done(text, { text: `${ex} = ${calc(ex)}`, route: 'calc', claims: [], proof: [], notes: [], tokens: 0 }); } catch { /* fall through */ }
    }
    const hint = classifyWorkload(text);
    const providers = [
      ...(this.llm ? [{ id: 'configured-language', role: 'language' as const, endpoint: this.llm.base, model: this.llm.model, available: true, maxInputChars: 12000 }] : []),
      ...(this.needle ? [{ id: 'configured-needle', role: 'needle' as const, endpoint: this.needle.base, model: 'needle', available: true, maxInputChars: 8192 }] : []),
    ];
    const selection = selectModel(hint.workload, providers, text.length);
    const r = this.mem.chat(text);
    if (!r.miss || !selection.provider) return this.done(text, { text: r.text, route: 'memory', claims: [], proof: r.proof, notes: selection.reason === 'no-eligible-provider' && hint.workload !== 'deterministic' ? [`workload=${hint.workload}; no eligible model provider configured`] : [], tokens: 0, touched: r.touched });
    if (selection.provider.role === 'needle') return this.done(text, await this.viaNeedle(text, hint.workload));
    return this.done(text, await this.viaModel(text, hint.workload, selection.reason));
  }
  private done(q: string, r: TurnResult): TurnResult {
    this.history.push({ role: 'user', content: q }, { role: 'assistant', content: r.text });
    if (this.history.length > 12) this.history.splice(0, this.history.length - 12);
    return r;
  }
  private recall(text: string): string[] {
    const t = ' ' + nz(text) + ' ', out: string[] = [];
    for (const it of this.mem.items) {
      if (out.length >= 12) break;
      if (!t.includes(' ' + it.name + ' ')) continue;
      for (const rel of RELS) for (const r of this.mem.get(it.name, rel)) out.push(realize({ s: it.name, rel, o: r.name, neg: false }));
    }
    return out.slice(0, 12);
  }
  private verifyClaim(c: Turn['claims'][number]): ClaimStatus {
    const f: Fact = { s: nz(c.s), rel: nz(c.rel), o: nz(c.o), neg: c.neg }, fact = `${c.s} ${c.neg ? 'not ' : ''}${c.rel} ${c.o}`;
    if (!f.s || !f.rel || !f.o) return { fact, status: 'unknown', proof: [] };
    const r = this.mem.verify(f); return { fact, status: r.v, proof: r.proof };
  }
  private async viaNeedle(text: string, workload: Workload): Promise<TurnResult> {
    const notes = [`workload=${workload}; configured Needle structured extraction`];
    try {
      const requestId = `darle-${++this.needleSequence}`;
      const response = await completeNeedle(this.needle!, requestId, text, this.fetchFn, SCHEMA);
      if (response.result === null) return { text: 'Needle found no structured result; no answer was inferred.', route: 'none', claims: [], proof: [], notes: [...notes, 'needle-no-match'], tokens: 0 };
      const error = check(TURN, response.result);
      if (error) return { text: 'Needle returned an invalid structured result; no answer was accepted.', route: 'none', claims: [], proof: [], notes: [...notes, 'needle-invalid-output: ' + error], tokens: 0 };
      const out = response.result as Turn;
      if (out.calc.trim()) return { text: 'Needle returned an arithmetic request outside the structured extraction contract; no answer was accepted.', route: 'none', claims: [], proof: [], notes: [...notes, 'needle-calc-not-supported'], tokens: 0 };
      const claims = out.claims.map(c => this.verifyClaim(c));
      if (claims.some(c => c.status === 'contradicted')) return { text: 'Needle output conflicts with verified memory, so I will not use it.', route: 'none', claims, proof: claims.flatMap(c => c.proof), notes: [...notes, 'needle-claim-conflict'], tokens: 0 };
      return { text: out.answer, route: 'model', claims, proof: [], notes: [...notes, `needle-model=${response.model}`], tokens: 0 };
    } catch (e) {
      return { text: `The structured model is unavailable: ${(e as Error).message}`, route: 'none', claims: [], proof: [], notes, tokens: 0 };
    }
  }

  private async viaModel(text: string, workload: Workload, selectionReason: string): Promise<TurnResult> {
    const facts = this.recall(text), notes: string[] = [];
    if (selectionReason !== 'configured-provider') notes.push(`workload=${workload}; ${selectionReason}; using configured general language model`);
    const msgs: Msg[] = [{ role: 'system', content: SYSTEM + (facts.length ? '\nKNOWN FACTS:\n' + facts.join('\n') : '') }, ...this.history.slice(-6), { role: 'user', content: text }];
    let tokens = 0, last: ClaimStatus[] = [];
    for (let k = 0; k < MAX_TRIES; k++) {
      let out: Turn;
      try {
        const r = await complete(this.llm!, msgs, SCHEMA, this.fetchFn); tokens += r.tokens;
        let j: unknown; try { j = JSON.parse(r.text); } catch { throw new Bad('not valid JSON'); }
        const e = check(TURN, j); if (e) throw new Bad(e);
        out = j as Turn;
      } catch (e) {
        if (!(e instanceof Bad)) return { text: `The language model is unavailable: ${(e as Error).message}`, route: 'none', claims: [], proof: [], notes, tokens };
        notes.push('invalid output: ' + e.message);
        msgs.push({ role: 'user', content: `Your last reply was invalid (${e.message}). Reply again in the required JSON format.` });
        continue;
      }
      if (out.calc.trim()) {
        let v = ''; try { v = String(calc(out.calc)); notes.push(`calc ${out.calc} = ${v}`); } catch (e) { notes.push(`calc rejected: ${(e as Error).message}`); }
        msgs.push({ role: 'assistant', content: JSON.stringify(out) }, { role: 'user', content: v ? `calc result: ${out.calc} = ${v}. Give the final answer now and set calc to "".` : 'calc failed: the expression was invalid. Answer without arithmetic you cannot verify and set calc to "".' });
        continue;
      }
      const claims = out.claims.map(c => this.verifyClaim(c)), bad = claims.filter(c => c.status === 'contradicted');
      last = claims;
      if (!bad.length) return { text: out.answer, route: 'model', claims, proof: [], notes, tokens };
      notes.push(`retry: ${bad.length} claim(s) contradicted memory`);
      msgs.push({ role: 'assistant', content: JSON.stringify(out) }, { role: 'user', content: `Your claims conflict with verified memory: ${bad.map(b => `"${b.fact}" but memory has: ${b.proof[0] ?? ''}`).join('; ')}. Correct your answer.` });
    }
    return { text: 'I could not produce an answer that agrees with what I have verified, so I am not going to guess.', route: 'none', claims: last, proof: last.flatMap(c => c.proof), notes, tokens };
  }
}
