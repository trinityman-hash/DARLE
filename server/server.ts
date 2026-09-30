// Dependency-free host (Render, VPS, Oracle): static site + /healthz + /api/state + POST /api/chat with bounded per-session memory.
import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { seeded, type Darle } from '../src/darle.ts';
const PUB = join(process.cwd(), 'public'), PORT = Number(process.env.PORT ?? 8080), MAX = 64, TTL = 20 * 60e3, ID = /^[\w-]{8,64}$/;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const H = { 'content-security-policy': "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const sessions = new Map<string, { d: Darle; t: number }>();
const json = (res: ServerResponse, code: number, b: unknown) => res.writeHead(code, { ...H, 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(b));
const pack = (b: Uint8Array | null) => { if (!b) return ''; const o = Buffer.alloc(b.length >> 3); for (let j = 0; j < b.length; j++) if (b[j]) o[j >> 3] |= 1 << (j & 7); return o.toString('base64'); };
function session(id: string) {
  const now = Date.now(); for (const [k, s] of sessions) if (now - s.t > TTL) sessions.delete(k);
  let s = sessions.get(id);
  if (!s) { if (sessions.size >= MAX) sessions.delete(sessions.keys().next().value!); s = { d: seeded(), t: now }; }
  s.t = now; sessions.delete(id); sessions.set(id, s); return s.d;
}
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (url.pathname === '/healthz') { res.writeHead(200, { ...H, 'content-type': 'text/plain' }).end('ok'); return; }
    if (url.pathname === '/api/state' && req.method === 'GET') {
      const id = url.searchParams.get('session') ?? ''; if (!ID.test(id)) return json(res, 400, { error: 'bad session' });
      const d = session(id); return json(res, 200, { stats: d.stats(), bits: pack(d.bits('france')) });
    }
    if (url.pathname === '/api/chat') {
      if (req.method !== 'POST') return json(res, 405, { error: 'use POST' });
      let body = ''; for await (const c of req) { body += c; if (body.length > 4096) return json(res, 413, { error: 'too large' }); }
      let j: any; try { j = JSON.parse(body); } catch { return json(res, 400, { error: 'invalid JSON' }); }
      if (typeof j?.text !== 'string' || j.text.length > 500 || !ID.test(j?.session)) return json(res, 400, { error: 'bad request' });
      const d = session(j.session), reply = d.chat(j.text);
      return json(res, 200, { reply, stats: d.stats(), bits: pack(d.bits(reply.touched ?? 'france') ?? d.bits('france')) });
    }
    const p = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
    if (p.includes('..')) throw new Error('path');
    res.writeHead(200, { ...H, 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' }).end(await readFile(join(PUB, p)));
  } catch { res.writeHead(404, H).end('not found'); }
}).listen(PORT, '0.0.0.0', () => console.log(`darle listening on :${PORT}`));
