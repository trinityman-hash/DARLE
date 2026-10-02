// The turn loop: route -> recall -> generate (typed) -> calculate -> verify -> retry or decline.
// Memory is written only from what the user states. Model output is never stored, so a wrong answer cannot poison later ones.
import { Darle, RELS, realize, type Fact } from './darle.ts';
import { obj, str, bool, arr, check, jsonSchema, type I } from './typed.ts';
import { calc } from './calc.ts';
import { complete, type LlmConfig, type Msg } from './llm.ts';

const CLAIM = obj({ s: str(40), rel: str(30), o: str(40), neg: bool() });
export const TURN = obj({ answer: str(1500), claims: arr(CLAIM, 8), calc: str(120) });
type Turn = I<typeof TURN>;
export interface ClaimStatus { fact: string; status: 'supported' | 'contradicted' | 'unknown'; proof: string[] }
export interface TurnResult { text: string; route: 'memory' | 'calc' | 'needle' | 'model' | 'none'; claims: ClaimStatus[]; proof: string[]; notes: string[]; tokens: number; touched?: string }

const MAX_TRIES = 4;
const SCHEMA: Record<string, unknown> = jsonSchema(TURN) as Record<string, unknown>;
const SYSTEM = `You are the language layer of DARLE. Reply with JSON only. "answer": a short, direct reply. "claims": every checkable fact you assert as {s, rel, o, neg}; rel must be one of: ${RELS.join(", ")}. Use only facts in KNOWN FACTS as verified; do not invent memory. Put arithmetic expressions in "calc" and leave "answer" brief. If no checkable facts, use an empty claims array. Schema: {"answer":string,"claims":[{"s":string,"rel":string,"o":string,"neg":boolean}],"calc":string}.`;
const nz = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(the|a|an) /, '');
class Bad extends Error {}

export class Agent {
  mem: Darle; llm: LlmConfig | null; fetchFn: typeof fetch; needleBase: string | null; history: Msg[] = [];
  constructor(mem: Darle, llm: LlmConfig | null, fetchFn: typeof fetch = fetch, needleBase: string | null = null) { this.mem = mem; this.llm = llm; this.fetchFn = fetchFn; this.needleBase = needleBase; }

  async turn(text: string): Promise<TurnResult> {
    const ex = text.replace(/^(what is|what's|calculate|compute)\s+/i, '').replace(/[?=\s]+$/, '');
    if (/^[\d\s+\-*/%^().]+$/.test(ex) && /\d/.test(ex) && /[-+*/%^]/.test(ex)) {
      try { return this.done(text, { text: `${ex} = ${calc(ex)}`, route: 'calc', claims: [], proof: [], notes: [], tokens: 0 }); } catch { /* fall through */ }
    }
    const r = this.mem.chat(text);
    if (!r.miss || (!this.llm && !this.needleBase)) return this.done(text, { text: r.text, route: 'memory', claims: [], proof: r.proof, notes: [], tokens: 0, touched: r.touched });
    if (this.needleBase && /\b(extract|parse|classify|categorize|structured|json|which tool|route this)\b/i.test(text)) {
      const small = await this.viaNeedle(text);
      if (small) return this.done(text, small);
    }
    if (this.llm) return this.done(text, await this.viaModel(text));
    return this.done(text, { text: 'This request needs the language model; the local specialist handles structured tasks.', route: 'none', claims: [], proof: [], notes: [], tokens: 0 });
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

  private async viaNeedle(text: string): Promise<TurnResult | null> {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await this.fetchFn(this.needleBase! + '/complete', {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: text, schema: SCHEMA }),
      });
      if (!r.ok) throw new Error('Needle returned HTTP ' + r.status);
      const payload: any = await r.json(), e = check(TURN, payload?.turn);
      if (e || !payload?.turn || typeof payload.confidence !== 'number' || payload.confidence < 0.65) return null;
      const out = payload.turn as Turn, claims = out.claims.map(c => this.verifyClaim(c));
      if (claims.some(c => c.status === 'contradicted')) return null;
      const answer = out.calc.trim() ? (() => { try { return out.answer + (out.answer ? ' ' : '') + String(calc(out.calc)); } catch { return out.answer; } })() : out.answer;
      return { text: answer, route: 'needle', claims, proof: [], notes: [], tokens: 0 };
    } catch {
      return null;
    } finally { clearTimeout(timer); }
  }

  private async viaModel(text: string): Promise<TurnResult> {
    const facts = this.recall(text), notes: string[] = [];
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
        msgs.push({ role: "assistant", content: JSON.stringify(out) }, { role: "user", content: v ? `calc result: ${out.calc} = ${v}. Give the final answer now and set calc to "".` : `calc failed. Do not retry that calculation; provide a concise answer without it and set calc to "".` });
        continue;
      }
      const claims = out.claims.map(c => this.verifyClaim(c)), bad = claims.filter(c => c.status === 'contradicted');
      last = claims;
      if (!bad.length) return { text: out.answer, route: 'model', claims, proof: [], notes, tokens };
      notes.push(`retry: ${bad.length} claim(s) contradicted memory`);
      msgs.push({ role: "assistant", content: JSON.stringify(out) }, { role: "user", content: `Your claims conflict with verified memory: ${bad.map(b => `"${b.fact}" but memory has: ${b.proof[0] ?? "no matching verified fact"}`).join("; ")}. Revise the answer and claims to avoid contradicted statements.` });
    }
    return { text: 'I could not produce an answer that agrees with what I have verified, so I am not going to guess.', route: 'none', claims: last, proof: last.flatMap(c => c.proof), notes, tokens };
  }
}
