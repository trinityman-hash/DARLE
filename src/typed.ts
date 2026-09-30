// Typed boundary. One schema drives (1) the JSON Schema sent to the model for constrained decoding,
// (2) runtime validation of whatever comes back, and (3) the TypeScript type. Nothing else is trusted.
export type S = { t: 'string'; max: number } | { t: 'bool' } | { t: 'array'; of: S; max: number } | { t: 'object'; f: { [k: string]: S } };
export type I<X> = X extends { t: 'string' } ? string : X extends { t: 'bool' } ? boolean : X extends { t: 'array'; of: infer O } ? I<O>[] : X extends { t: 'object'; f: infer F } ? { [K in keyof F]: I<F[K]> } : never;
export const str = (max: number) => ({ t: 'string', max }) as const;
export const bool = () => ({ t: 'bool' }) as const;
export const arr = <O extends S>(of: O, max: number) => ({ t: 'array', of, max }) as const;
export const obj = <F extends { [k: string]: S }>(f: F) => ({ t: 'object', f }) as const;

/** Returns null when x matches s, otherwise a short path-qualified reason. */
export function check(s: S, x: unknown, p = '$'): string | null {
  switch (s.t) {
    case 'string': return typeof x !== 'string' ? `${p}: expected string` : x.length > s.max ? `${p}: longer than ${s.max}` : null;
    case 'bool': return typeof x === 'boolean' ? null : `${p}: expected boolean`;
    case 'array': {
      if (!Array.isArray(x)) return `${p}: expected array`;
      if (x.length > s.max) return `${p}: more than ${s.max} items`;
      for (let i = 0; i < x.length; i++) { const e = check(s.of, x[i], `${p}[${i}]`); if (e) return e; }
      return null;
    }
    case 'object': {
      if (typeof x !== 'object' || x === null || Array.isArray(x)) return `${p}: expected object`;
      const o = x as Record<string, unknown>;
      for (const k of Object.keys(o)) if (!(k in s.f)) return `${p}.${k}: unexpected field`;
      for (const k of Object.keys(s.f)) { if (!(k in o)) return `${p}.${k}: missing`; const e = check(s.f[k], o[k], `${p}.${k}`); if (e) return e; }
      return null;
    }
  }
}

export function jsonSchema(s: S): object {
  switch (s.t) {
    case 'string': return { type: 'string', maxLength: s.max };
    case 'bool': return { type: 'boolean' };
    case 'array': return { type: 'array', items: jsonSchema(s.of), maxItems: s.max };
    case 'object': return { type: 'object', properties: Object.fromEntries(Object.entries(s.f).map(([k, v]) => [k, jsonSchema(v)])), required: Object.keys(s.f), additionalProperties: false };
  }
}
