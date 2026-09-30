// Exact arithmetic without eval: recursive descent over a fixed grammar. The model never does arithmetic; it asks for it.
export function calc(src: string): number {
  if (src.length > 120) throw new Error('expression too long');
  const tok = src.toLowerCase().replace(/\s+/g, '').match(/\d+\.?\d*|\.\d+|[a-z]+|[-+*/%^()]|./g) ?? [];
  let i = 0;
  const peek = () => tok[i], next = () => tok[i++];
  const close = () => { if (next() !== ')') throw new Error('missing )'); };
  const atom = (): number => {
    const t = next();
    if (t === undefined) throw new Error('unexpected end');
    if (t === '(') { const v = sum(); close(); return v; }
    if (/^[\d.]/.test(t)) return Number(t);
    if (t === 'sqrt' || t === 'abs') { if (next() !== '(') throw new Error('expected ('); const v = sum(); close(); return t === 'sqrt' ? Math.sqrt(v) : Math.abs(v); }
    throw new Error(`unexpected "${t}"`);
  };
  const unary = (): number => (peek() === '-' ? (i++, -unary()) : peek() === '+' ? (i++, unary()) : pow());
  const pow = (): number => { const b = atom(); if (peek() === '^') { i++; return b ** unary(); } return b; };
  const prod = (): number => {
    let v = unary();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const o = next(), r = unary();
      if (o === '*') v *= r; else if (r === 0) throw new Error('division by zero'); else v = o === '/' ? v / r : v % r;
    }
    return v;
  };
  const sum = (): number => { let v = prod(); while (peek() === '+' || peek() === '-') { const o = next(), r = prod(); v = o === '+' ? v + r : v - r; } return v; };
  const v = sum();
  if (i < tok.length) throw new Error(`unexpected "${tok[i]}"`);
  if (!Number.isFinite(v)) throw new Error('result is not finite');
  return Number(v.toPrecision(12));
}
