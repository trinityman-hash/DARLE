// Dependency-free host (Render, VPS, Oracle): static site, /healthz, GET /api/state, POST /api/chat. Bounded per-session memory, per-IP rate limit.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { seeded } from '../src/darle.ts';
import { Agent } from '../src/agent.ts';
import { llmFromEnv } from '../src/llm.ts';
import type { NeedleConfig } from '../src/needle-client.ts';

const PUB = join(process.cwd(), 'public'), PORT = Number(process.env.PORT ?? 8080), MAX = 64, TTL = 20 * 60e3, PER_MIN = 40, ID = /^[\w-]{8,64}$/;
const LLM = llmFromEnv(process.env);
const NEEDLE: NeedleConfig | null = process.env.NEEDLE_BASE_URL ? {
  base: process.env.NEEDLE_BASE_URL,
  token: process.env.NEEDLE_API_TOKEN || undefined,
  timeoutMs: Number(process.env.NEEDLE_TIMEOUT_MS ?? 15000),
} : null;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };
const H = { 'content-security-policy': "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'cross-origin-opener-policy': 'same-origin' };
interface Sess { a: Agent; t: number; q: Promise<unknown> }
const sessions = new Map<string, Sess>(), hits = new Map<string, number[]>();

const json = (res: ServerResponse, code: number, b: unknown) => { res.writeHead(code, { ...H, 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(b)); };
const pack = (b: Uint8Array | null) => { if (!b) return ''; const o = Buffer.alloc(b.length >> 3); for (let j = 0; j < b.length; j++) if (b[j]) o[j >> 3] |= 1 << (j & 7); return o.toString('base64'); };
function limited(req: IncomingMessage): boolean {
  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '?', now = Date.now();
  const a = (hits.get(ip) ?? []).filter(t => now - t < 60e3); a.push(now); hits.set(ip, a); if (hits.size > 5000) hits.clear();
  return a.length > PER_MIN;
}
function session(id: string): Sess {
  const now = Date.now(); for (const [k, s] of sessions) if (now - s.t > TTL) sessions.delete(k);
  let s = sessions.get(id);
  if (!s) { if (sessions.size >= MAX) sessions.delete(sessions.keys().next().value!); s = { a: new Agent(seeded(), LLM, fetch, NEEDLE), t: now, q: Promise.resolve() }; }
  s.t = now; sessions.delete(id); sessions.set(id, s); return s;
}
async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (limited(req)) return json(res, 429, { error: 'too many requests' });
  if (url.pathname === '/api/state' && req.method === 'GET') {
    const id = url.searchParams.get('session') ?? ''; if (!ID.test(id)) return json(res, 400, { error: 'bad session' });
    const s = session(id); return json(res, 200, { stats: s.a.mem.stats(), bits: pack(s.a.mem.bits('france')), llm: { configured: !!LLM, model: LLM?.model ?? null } });
  }
  if (url.pathname !== '/api/chat') return json(res, 404, { error: 'not found' });
  if (req.method !== 'POST') return json(res, 405, { error: 'use POST' });
  let body = ''; for await (const c of req) { body += c; if (body.length > 4096) return json(res, 413, { error: 'too large' }); }
  let j: any; try { j = JSON.parse(body); } catch { return json(res, 400, { error: 'invalid JSON' }); }
  if (typeof j?.text !== 'string' || j.text.length > 500 || !ID.test(j?.session)) return json(res, 400, { error: 'bad request' });
  const s = session(j.session), t0 = Date.now(), p = s.q.catch(() => undefined).then(() => s.a.turn(j.text));
  s.q = p; const reply = await p;
  console.log(JSON.stringify({ route: reply.route, tokens: reply.tokens, ms: Date.now() - t0 }));
  json(res, 200, { reply, stats: s.a.mem.stats(), bits: pack(s.a.mem.bits(reply.touched ?? 'france') ?? s.a.mem.bits('france')) });
}
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (url.pathname === '/healthz') { res.writeHead(200, { ...H, 'content-type': 'text/plain' }).end('ok'); return; }
    if (url.pathname.startsWith('/api/')) { try { await api(req, res, url); } catch (e) { console.error(e); if (!res.headersSent) json(res, 500, { error: 'internal error' }); } return; }
    const p = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
    if (p.includes('..')) throw new Error('path');
    res.writeHead(200, { ...H, 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' }).end(await readFile(join(PUB, p)));
  } catch { res.writeHead(404, H).end('not found'); }
}).listen(PORT, '0.0.0.0', () => console.log(`darle listening on :${PORT}, language model ${LLM ? LLM.model : 'not configured'}, Needle ${NEEDLE ? 'configured' : 'not configured'}`));
