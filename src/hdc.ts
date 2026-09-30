// Binary hyperdimensional primitives. No floats in the memory path, no training, no gradients.
export const D = 8192, W = D / 32;
export type HV = Uint32Array;
const mix = (a: number) => { a = Math.imul(a ^ (a >>> 16), 0x85ebca6b); a = Math.imul(a ^ (a >>> 13), 0xc2b2ae35); return (a ^ (a >>> 16)) >>> 0; };
const cache = new Map<string, HV>();
/** Deterministic random hypervector for a symbol: nothing to store or train. */
export function hv(name: string): HV {
  let v = cache.get(name); if (v) return v;
  let h = 2166136261; for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  const m = mix(h); v = new Uint32Array(W);
  for (let i = 0; i < W; i++) v[i] = mix((m + Math.imul(i + 1, 0x9e3779b9)) >>> 0);
  if (cache.size > 100000) cache.clear();
  cache.set(name, v); return v;
}
export const xor = (a: HV, b: HV): HV => { const o = new Uint32Array(W); for (let i = 0; i < W; i++) o[i] = a[i] ^ b[i]; return o; };
export const pc = (x: number) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24; };
export const ham = (a: HV, b: HV) => { let d = 0; for (let i = 0; i < W; i++) d += pc(a[i] ^ b[i]); return d; };
const TIE = hv('tie');
/** Superposition store: adding a bound vector remembers it; adding it with sign -1 removes it exactly. */
export class Counters {
  c = new Int16Array(D);
  add(v: HV, sign: number) { const c = this.c; for (let j = 0; j < D; j++) c[j] += ((v[j >> 5] >>> (j & 31)) & 1) ? sign : -sign; }
  bin(): HV { const o = new Uint32Array(W), c = this.c; for (let j = 0; j < D; j++) if (c[j] > 0 || (c[j] === 0 && ((TIE[j >> 5] >>> (j & 31)) & 1))) o[j >> 5] |= 1 << (j & 31); return o; }
  corr(v: HV): number { let s = 0; const c = this.c; for (let j = 0; j < D; j++) s += ((v[j >> 5] >>> (j & 31)) & 1) ? c[j] : -c[j]; return s; }
  halve() { for (let j = 0; j < D; j++) this.c[j] = Math.trunc(this.c[j] / 2); }
}
