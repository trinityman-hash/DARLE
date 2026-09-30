// DARLE: hyperdimensional memory + rule parser + multi-hop reasoner + verifier. No neural network, no Markov chain.
import { D, W, hv, xor, pc, Counters } from './hdc.ts';

export interface Fact { s: string; rel: string; o: string; neg: boolean }
export interface Reply { text: string; verdict?: 'supported' | 'contradicted' | 'unknown'; proof: string[]; touched?: string; miss?: true }
interface Verb { key: string; third: string; base: string; fn?: boolean }
const VERBS: Verb[] = [
  { key: 'works for', third: 'works for', base: 'work for', fn: true }, { key: 'lives in', third: 'lives in', base: 'live in', fn: true },
  { key: 'reports to', third: 'reports to', base: 'report to', fn: true }, { key: 'manages', third: 'manages', base: 'manage' },
  { key: 'owns', third: 'owns', base: 'own' }, { key: 'likes', third: 'likes', base: 'like' }, { key: 'loves', third: 'loves', base: 'love' },
  { key: 'knows', third: 'knows', base: 'know' }, { key: 'has', third: 'has', base: 'have' }, { key: 'eats', third: 'eats', base: 'eat' },
];
const FUNC = new Set([...VERBS.filter(v => v.fn).map(v => v.key), 'capital of']);
export const RELS = [...VERBS.map(v => v.key), 'is a', 'is', 'located in', 'part of', 'capital of'];
const TRANS = new Set(['is a', 'located in', 'part of']);
const MAX_BANKS = 5000, IDLE_TURNS = 500, Z_MIN = 5, MAX_DEPTH = 6;

export const SEED = [
  ...['paris:france', 'berlin:germany', 'madrid:spain', 'rome:italy', 'tokyo:japan', 'ottawa:canada', 'canberra:australia', 'new delhi:india', 'brasilia:brazil', 'cairo:egypt', 'nairobi:kenya', 'oslo:norway', 'lisbon:portugal', 'athens:greece', 'beijing:china'].map(x => { const [c, n] = x.split(':'); return `${c} is the capital of ${n}`; }),
  ...['paris:france', 'berlin:germany', 'rome:italy', 'tokyo:japan', 'france:europe', 'germany:europe', 'italy:europe', 'spain:europe', 'japan:asia', 'india:asia', 'china:asia', 'egypt:africa', 'kenya:africa', 'brazil:south america', 'canada:north america'].map(x => { const [a, b] = x.split(':'); return `${a} is in ${b}`; }),
  'dog is a mammal', 'cat is a mammal', 'whale is a mammal', 'bat is a mammal', 'mammal is a vertebrate', 'bird is a vertebrate', 'fish is a vertebrate', 'vertebrate is an animal',
  'eagle is a bird', 'penguin is a bird', 'salmon is a fish', 'shark is a fish', 'oak is a tree', 'tree is a plant', 'rose is a plant', 'penguin is flightless',
];

const norm = (t: string) => t.toLowerCase().replace(/doesn't/g, 'does not').replace(/don't/g, 'do not').replace(/isn't/g, 'is not').replace(/aren't/g, 'are not').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const ent = (t: string) => t.replace(/^(the|a|an) /, '').trim();
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const art = (w: string) => (/^[aeiou]/.test(w) ? 'an' : 'a');
const PRON = /\b(i|me|my|we|our|you|your|it|this|that|they|he|she)\b/;
const mk = (s: string, rel: string, o: string, neg: boolean): Fact | null => {
  s = ent(s); o = ent(o);
  return s && o && s.length < 40 && o.length < 40 && s.split(' ').length <= 4 && o.split(' ').length <= 4 && !PRON.test(s) && !PRON.test(o) ? { s, rel, o, neg } : null;
};

function parseFact(t: string): Fact | null {
  let m: RegExpMatchArray | null;
  for (const v of VERBS) {
    if ((m = t.match(new RegExp(`^(.+?) (?:does|do) not ${v.base} (.+)$`)))) return mk(m[1], v.key, m[2], true);
    if ((m = t.match(new RegExp(`^(.+?) ${v.third} (.+)$`)))) return mk(m[1], v.key, m[2], false);
  }
  if ((m = t.match(/^(.+?) (?:is|are) (not )?(?:a|an) (.+)$/))) return mk(m[1], 'is a', m[3], !!m[2]);
  if ((m = t.match(/^(.+?) (?:is|are) (not )?(?:the )?(\w+) of (.+)$/))) return mk(m[1], m[3] + ' of', m[4], !!m[2]);
  if ((m = t.match(/^(.+?) (?:is|are) (not )?(?:located )?in (.+)$/))) return mk(m[1], 'located in', m[3], !!m[2]);
  if ((m = t.match(/^(.+?) (?:is|are) (not )?(\w+)$/))) return mk(m[1], 'is', m[3], !!m[2]);
  return null;
}
type Q = { k: 'yn'; f: Fact } | { k: 'read'; s: string; key: string; label: string } | { k: 'desc'; s: string };
function parseQ(t: string): Q | null {
  let m: RegExpMatchArray | null; const yn = (f: Fact | null): Q | null => (f ? { k: 'yn', f } : null);
  if ((m = t.match(/^(?:what|who) (?:is|are) (?:the )?(\w+) of (.+)$/))) return { k: 'read', s: ent(m[2]), key: '^' + m[1] + ' of', label: `the ${m[1]} of ${ent(m[2])}` };
  if ((m = t.match(/^where (?:does|do) (.+?) live$/))) return { k: 'read', s: ent(m[1]), key: 'lives in', label: `${ent(m[1])} lives in` };
  for (const v of VERBS) {
    if ((m = t.match(new RegExp(`^(?:what|who|whom) (?:does|do) (.+?) ${v.base}$`)))) return { k: 'read', s: ent(m[1]), key: v.key, label: `${ent(m[1])} ${v.third}` };
    if ((m = t.match(new RegExp(`^(?:what|who) ${v.third} (.+)$`)))) return { k: 'read', s: ent(m[1]), key: '^' + v.key, label: `who ${v.third} ${ent(m[1])}` };
    if ((m = t.match(new RegExp(`^(?:does|do) (.+?) ${v.base} (.+)$`)))) return yn(mk(m[1], v.key, m[2], false));
  }
  if ((m = t.match(/^(?:what|who) (?:is|are) (.+)$/))) return { k: 'desc', s: ent(m[1]) };
  if ((m = t.match(/^(?:is|are) (.+?) (?:a|an) (.+)$/))) return yn(mk(m[1], 'is a', m[2], false));
  if ((m = t.match(/^(?:is|are) (.+?) (?:the )?(\w+) of (.+)$/))) return yn(mk(m[1], m[2] + ' of', m[3], false));
  if ((m = t.match(/^(?:is|are) (.+?) (?:located )?in (.+)$/))) return yn(mk(m[1], 'located in', m[2], false));
  if ((m = t.match(/^(?:is|are) (.+?) (\w+)$/))) return yn(mk(m[1], 'is', m[2], false));
  return null;
}
export function realize(f: Fact): string {
  const { s, rel, o, neg } = f, v = VERBS.find(x => x.key === rel), n = neg ? 'not ' : '';
  if (v) return `${cap(s)}${neg ? ` does not ${v.base} ` : ` ${v.third} `}${o}`;
  if (rel === 'is a') return `${cap(s)} is ${n}${art(o)} ${o}`;
  if (rel === 'located in') return `${cap(s)} is ${n}located in ${o}`;
  if (rel === 'is') return `${cap(s)} is ${n}${o}`;
  return `${cap(s)} is ${n}the ${rel} ${o}`;
}

interface Bank { c: Counters; n: number; scale: number; last: number }
interface Read { name: string; z: number }
export class Darle {
  banks = new Map<string, Bank>(); items: { name: string; v: Uint32Array }[] = []; known = new Set<string>(); facts = 0; turn = 0;

  private bank(s: string): Bank {
    let b = this.banks.get(s);
    if (b) this.banks.delete(s); else { b = { c: new Counters(), n: 0, scale: 1, last: 0 }; if (this.banks.size >= MAX_BANKS) this.banks.delete(this.banks.keys().next().value!); }
    b.last = this.turn; this.banks.set(s, b); return b;
  }
  private item(name: string) { if (!this.known.has(name)) { this.known.add(name); this.items.push({ name, v: hv('o:' + name) }); } }
  private put(s: string, key: string, o: string, sign: number) {
    const a = this.bank(s), b = this.bank(o);
    a.c.add(xor(hv('r:' + key), hv('o:' + o)), sign); a.n += sign;
    b.c.add(xor(hv('r:^' + key), hv('o:' + s)), sign); b.n += sign;
    if (sign > 0) { this.item(s); this.item(o); }
    this.facts += sign;
  }
  private nearest(q: Uint32Array, k: number): string[] {
    const best: { name: string; d: number }[] = [];
    for (const it of this.items) {
      let d = 0; for (let i = 0; i < W; i++) d += pc(q[i] ^ it.v[i]);
      if (best.length < k || d < best[best.length - 1].d) { best.push({ name: it.name, d }); best.sort((x, y) => x.d - y.d); if (best.length > k) best.pop(); }
    }
    return best.map(x => x.name);
  }
  /** Unbind the relation from the subject's bank, clean up against known items, keep only matches above Z_MIN sigma. */
  get(s: string, key: string): Read[] {
    const b = this.banks.get(s); if (!b || b.n <= 0) return [];
    const r = hv('r:' + key), sd = b.scale * Math.sqrt(D * Math.max(1, b.n - 1)), out: Read[] = [];
    for (const name of this.nearest(xor(b.c.bin(), r), 16)) { const z = b.c.corr(xor(r, hv('o:' + name))) / sd; if (z >= Z_MIN) out.push({ name, z }); }
    return out.sort((x, y) => y.z - x.z);
  }
  /** Exact test of one claimed object: no top-k cutoff, so crowded banks still verify. */
  probe(s: string, key: string, o: string): Read | null {
    const b = this.banks.get(s); if (!b || b.n <= 0) return null;
    const z = b.c.corr(xor(hv('r:' + key), hv('o:' + o))) / (b.scale * Math.sqrt(D * Math.max(1, b.n - 1)));
    return z >= Z_MIN ? { name: o, z } : null;
  }
  private line = (s: string, key: string, r: Read) => `${s} \u2014${key}\u2192 ${r.name}  (${r.z.toFixed(1)}\u03c3)`;
  private chain(s: string, key: string, goal: string): string[] | null {
    const seen = new Set([s]); let q: [string, string[]][] = [[s, []]];
    for (let d = 0; d < MAX_DEPTH && q.length; d++) {
      const nx: [string, string[]][] = [];
      for (const [x, path] of q) for (const r of this.get(x, key)) {
        const p = [...path, this.line(x, key, r)]; if (r.name === goal) return p;
        if (!seen.has(r.name)) { seen.add(r.name); nx.push([r.name, p]); }
      }
      q = nx;
    }
    return null;
  }
  verify(f: Fact): { v: 'supported' | 'contradicted' | 'unknown'; proof: string[]; clash?: Fact[] } {
    const p = this.probe(f.s, f.rel, f.o), n = this.probe(f.s, 'not ' + f.rel, f.o), pos = p || n || !FUNC.has(f.rel) ? [] : this.get(f.s, f.rel);
    if (!f.neg) {
      if (p) return { v: 'supported', proof: [this.line(f.s, f.rel, p)] };
      if (n) return { v: 'contradicted', proof: [this.line(f.s, 'not ' + f.rel, n)], clash: [{ ...f, neg: true }] };
      if (FUNC.has(f.rel) && pos.length) return { v: 'contradicted', proof: [this.line(f.s, f.rel, pos[0])], clash: pos.map(r => ({ s: f.s, rel: f.rel, o: r.name, neg: false })) };
      if (TRANS.has(f.rel)) { const c = this.chain(f.s, f.rel, f.o); if (c) return { v: 'supported', proof: c }; }
    } else {
      if (n) return { v: 'supported', proof: [this.line(f.s, 'not ' + f.rel, n)] };
      if (p) return { v: 'contradicted', proof: [this.line(f.s, f.rel, p)], clash: [{ ...f, neg: false }] };
      if (pos.length) return { v: 'supported', proof: [this.line(f.s, f.rel, pos[0]) + ' (excludes it)'] };
    }
    return { v: 'unknown', proof: [] };
  }
  learn(f: Fact) { this.put(f.s, (f.neg ? 'not ' : '') + f.rel, f.o, 1); }
  seed(lines: string[]) { for (const l of lines) { const f = parseFact(norm(l)); if (f && this.verify(f).v === 'unknown') this.learn(f); } }
  private closure(s: string, key: string): { names: string[]; proof: string[] } {
    const names: string[] = [], proof: string[] = [], seen = new Set([s]); let q = [s];
    for (let d = 0; d < MAX_DEPTH && q.length; d++) { const nx: string[] = []; for (const x of q) for (const r of this.get(x, key)) if (!seen.has(r.name)) { seen.add(r.name); names.push(r.name); proof.push(this.line(x, key, r)); nx.push(r.name); } q = nx; }
    return { names, proof };
  }
  /** Forgetting: banks idle for IDLE_TURNS are halved, then dropped. Memory is bounded by MAX_BANKS. */
  private tick() {
    if (++this.turn % 50) return;
    for (const [k, b] of this.banks) if (this.turn - b.last > IDLE_TURNS) { b.c.halve(); b.scale /= 2; b.n /= 2; b.last = this.turn - IDLE_TURNS / 2; if (b.scale < 0.1) this.banks.delete(k); }
  }
  stats() { return { dims: D, banks: this.banks.size, facts: this.facts, items: this.items.length, bytes: this.banks.size * D * 2 }; }
  bits(name: string): Uint8Array | null {
    const b = this.banks.get(name); if (!b) return null; const o = new Uint8Array(D); for (let j = 0; j < D; j++) o[j] = b.c.c[j] > 0 ? 1 : 0; return o;
  }

  chat(raw: string): Reply {
    this.tick(); let t = norm(raw); if (!t) return { text: 'Type a statement or a question.', proof: [] };
    if (/^(help|hi|hello|hey)$/.test(t)) return { proof: [], text: 'I hold facts, check claims, and chain them. Teach me: "Sam works for Acme." Ask: "Who works for Acme?", "Is a whale an animal?", "What is the capital of Japan?", "Where does Sam live?", "What is a penguin?". Correct me with "Actually, Sam lives in Rome."' };
    let fix = false; if (t.startsWith('actually ')) { fix = true; t = t.slice(9); }
    if (/\?\s*$/.test(raw.trim()) || /^(what|who|whom|where|is|are|does|do) /.test(t)) return this.ask(t);
    const f = parseFact(t);
    if (!f) return { miss: true, proof: [], text: 'I could not parse that. I understand: "X is a Y", "X is in Y", "X is the capital of Y", "X is adjective", and X works for / lives in / reports to / manages / owns / likes / loves / knows / has / eats Y.' };
    const r = this.verify(f);
    if (r.v === 'supported') return { text: `I already hold that: ${realize(f)}.`, verdict: 'supported', proof: r.proof, touched: f.s };
    if (r.v === 'contradicted' && !fix) return { text: `That conflicts with what I hold: ${realize(r.clash![0])}. Say "Actually, ${realize(f).toLowerCase()}" to replace it.`, verdict: 'contradicted', proof: r.proof, touched: f.s };
    for (const c of r.clash ?? []) this.put(c.s, (c.neg ? 'not ' : '') + c.rel, c.o, -1);
    this.learn(f); return { text: `${fix ? 'Corrected' : 'Noted'}: ${realize(f)}.`, verdict: 'unknown', proof: [], touched: f.s };
  }
  private ask(t: string): Reply {
    const q = parseQ(t); if (!q) return { miss: true, proof: [], text: 'I could not parse that question. Try "Is X a Y?", "Who works for X?", "What is the capital of X?", "What is X?".' };
    if (q.k === 'yn') {
      const r = this.verify(q.f), s = realize(q.f);
      if (r.v === 'supported') return { text: `Yes. ${s}.`, verdict: 'supported', proof: r.proof, touched: q.f.s };
      if (r.v === 'contradicted') return { text: `No. I hold that ${realize(r.clash![0]).toLowerCase()}.`, verdict: 'contradicted', proof: r.proof, touched: q.f.s };
      return { miss: true, text: `I don't know. Nothing I hold supports or contradicts "${s}".`, verdict: 'unknown', proof: [], touched: q.f.s };
    }
    if (q.k === 'read') {
      const rs = this.get(q.s, q.key);
      return rs.length ? { text: `${cap(q.label)}: ${rs.map(r => r.name).join(', ')}.`, verdict: 'supported', proof: rs.map(r => this.line(q.s, q.key, r)), touched: q.s }
        : { miss: true, text: `I hold nothing for ${q.label}.`, verdict: 'unknown', proof: [] };
    }
    const up = this.closure(q.s, 'is a'), loc = this.closure(q.s, 'located in'), props = this.get(q.s, 'is'), parts: string[] = [];
    const direct = this.get(q.s, 'is a').map(r => r.name);
    if (direct.length) parts.push(`${cap(q.s)} is ${direct.map(d => `${art(d)} ${d}`).join(' and ')}` + (up.names.length > direct.length ? `, and so also ${up.names.filter(n => !direct.includes(n)).map(n => `${art(n)} ${n}`).join(', ')}` : ''));
    if (props.length) parts.push(`${parts.length ? 'It' : cap(q.s)} is ${props.map(p => p.name).join(', ')}`);
    if (loc.names.length) parts.push(`${parts.length ? 'It' : cap(q.s)} is located in ${loc.names.join(', within ')}`);
    return parts.length ? { text: parts.join('. ') + '.', verdict: 'supported', proof: [...up.proof, ...loc.proof, ...props.map(p => this.line(q.s, 'is', p))], touched: q.s }
      : { miss: true, text: `I hold nothing about ${q.s}.`, verdict: 'unknown', proof: [] };
  }
}
export function seeded(): Darle { const d = new Darle(); d.seed(SEED); return d; }
