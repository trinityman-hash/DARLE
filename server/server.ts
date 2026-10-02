// Dependency-free host (Render, VPS): static site, health, state and chat APIs.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { seeded } from '../src/darle.ts';
import { Agent } from '../src/agent.ts';
import { llmFromEnv } from '../src/llm.ts';

const PUB = join(process.cwd(), 'public'), PORT = Number(process.env.PORT ?? 8080), MAX = 64, TTL = 20 * 60e3, PER_MIN = 40, ID = /^[\w-]{8,64}$/;
const LLM = llmFromEnv(process.env), NEEDLE = process.env.NEEDLE_BASE_URL || null;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };
const H = {
  'content-security-policy': "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin', 'strict-transport-security': 'max-age=31536000; includeSubDomains'
};
interface Sess { a: Agent; t: number; q: Promise<unknown> }
const sessions = new Map<string, Sess>(), hits = new Map<string, number[]>();
const json = (res: ServerResponse, code: number, b: unknown) => { res.writeHead(code, { ...H, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(b)); };
const pack = (b: Uint8Array | null) => { if (!b) return ''; const o = Buffer.alloc(b.length >> 3); for (let j = 0; j < b.length; j++) if (b[j]) o[j >> 3] |= 1 << (j & 7); return o.toString('base64'); };
function clientIp(req: IncomingMessage): string {
  // Render terminates TLS and supplies X-Forwarded-For. Restrict trust to the first proxy-provided address.
  return String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '?';
}
function limited(req: IncomingMessage): boolean {
  const ip = clientIp(req), now = Date.now(), a = (hits.get(ip) ?? []).filter(t => now - t < 60e3);
  a.push(now); hits.set(ip, a); if (hits.size > 5000) hits.clear();
  return a.length > PER_MIN;
}
function session(id: string): Sess {
  const now = Date.now(); for (const [k, s] of sessions) if (now - s.t > TTL) sessions.delete(k);
  let s = sessions.get(id);
  if (!s) { if (sessions.size >= MAX) sessions.delete(sessions.keys().next().value!); s = { a: new Agent(seeded(), LLM, fetch, NEEDLE), t: now, q: Promise.resolve() }; }
  s.t = now; sessions.delete(id); sessions.set(id, s); return s;
}
async function readBody(req: IncomingMessage, res: ServerResponse): Promise<any | null> {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) { json(res, 415, { error: 'content type must be application/json' }); return null; }
  let body = '';
  for await (const c of req) { body += c.toString(); if (Buffer.byteLength(body, 'utf8') > 4096) { json(res, 413, { error: 'request too large' }); req.destroy(); return null; } }
  try { return JSON.parse(body); } catch { json(res, 400, { error: 'invalid JSON' }); return null; }
}
async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (limited(req)) return json(res, 429, { error: 'too many requests' });
  if (url.pathname === '/api/state' && req.method === 'GET') {
    const id = url.searchParams.get('session') ?? ''; if (!ID.test(id)) return json(res, 400, { error: 'bad session' });
    const s = session(id); return json(res, 200, { stats: s.a.mem.stats(), bits: pack(s.a.mem.bits('france')), llm: { configured: !!LLM, model: LLM?.model ?? null }, needle: { configured: !!NEEDLE } });
  }
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    const j = await readBody(req, res); if (j === null) return;
    if (typeof j?.text !== 'string' || j.text.length > 500 || !ID.test(j?.session)) return json(res, 400, { error: 'bad request' });
    const s = session(j.session), t0 = Date.now(), p = s.q.catch(() => undefined).then(() => s.a.turn(j.text));
    s.q = p; const reply = await p;
    console.log(JSON.stringify({ route: reply.route, tokens: reply.tokens, ms: Date.now() - t0 }));
    return json(res, 200, { reply, stats: s.a.mem.stats(), bits: pack(s.a.mem.bits(reply.touched ?? 'france') ?? s.a.mem.bits('france')) });
  }
  return json(res, url.pathname.startsWith('/api/') ? 404 : 405, { error: 'not found or method not allowed' });
}
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/healthz' && req.method === 'GET') { res.writeHead(200, { ...H, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end('ok'); return; }
    if (url.pathname.startsWith('/api/')) { await api(req, res, url); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { ...H, allow: 'GET, HEAD' }).end('method not allowed'); return; }
    const p = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
    if (p.includes('..') || p.startsWith('/')) { /* normalize absolute paths remain rooted under PUB below */ }
    const file = join(PUB, p.replace(/^[/\\]+/, ''));
    if (!file.startsWith(PUB + '/') && file !== PUB) throw new Error('path');
    const data = await readFile(file);
    res.writeHead(200, { ...H, 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=300', 'content-length': data.length });
    if (req.method === 'HEAD') res.end(); else res.end(data);
  } catch { if (!res.headersSent) res.writeHead(404, { ...H, 'content-type': 'text/plain; charset=utf-8' }).end('not found'); }
}).listen(PORT, '0.0.0.0', () => console.log(`darle listening on :${PORT}, language model ${LLM ? LLM.model : 'not configured'}`));