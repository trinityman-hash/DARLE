interface Claim { fact: string; status: 'supported' | 'contradicted' | 'unknown'; proof: string[] }
interface Turn { text: string; route: 'memory' | 'calc' | 'needle' | 'model' | 'none'; claims: Claim[]; proof: string[]; notes: string[]; tokens: number }
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const log = $('#log'), form = $<HTMLFormElement>('#form'), box = $<HTMLTextAreaElement>('#prompt'), send = $<HTMLButtonElement>('#send'), modeEl = $('#mode'), engine = $('#engine');
const fmt = new Intl.NumberFormat('en');
const el = (tag: string, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; return e; };
const add = (n: HTMLElement) => { $('#empty')?.remove(); log.append(n); log.scrollTop = log.scrollHeight; };
function stats(s: { dims: number; banks: number; facts: number; bytes: number }) {
  $('#s-d').textContent = fmt.format(s.dims); $('#s-b').textContent = fmt.format(s.banks); $('#s-f').textContent = fmt.format(s.facts); $('#s-m').textContent = (s.bytes / 1048576).toFixed(2) + ' MB';
}
function draw(bits: Uint8Array | null) {
  if (!bits) return; const c = $<HTMLCanvasElement>('#matrix'), g = c.getContext('2d')!, S = c.width, cols = 90, u = S / cols;
  g.clearRect(0, 0, S, S); g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#f2efe7'; g.fillRect(0, 0, S, S); g.fillStyle = '#df2929';
  for (let j = 0; j < bits.length; j++) if (bits[j]) g.fillRect((j % cols) * u, Math.floor(j / cols) * u, u - 0.6, u - 0.6);
  g.restore(); g.strokeStyle = '#171717'; g.lineWidth = 3; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2); g.stroke();
}
const unpack = (b64: string): Uint8Array | null => { if (!b64) return null; const raw = atob(b64), o = new Uint8Array(raw.length * 8); for (let j = 0; j < o.length; j++) o[j] = (raw.charCodeAt(j >> 3) >> (j & 7)) & 1; return o; };
function show(r: Turn) {
  const t = el('article', 'turn darle'), body = el('div', 'body');
  body.append(el('p', 'txt', r.text)); t.append(el('span', 'who', 'DARLE'), body); add(t);
}
function user(text: string) { const t = el('article', 'turn you'), body = el('div', 'body'); t.append(el('span', 'who', 'YOU'), body); body.append(el('p', 'txt', text)); add(t); }
let session = ''; try { session = sessionStorage.getItem('darle') ?? ''; } catch { /* storage blocked */ }
if (!/^[\w-]{8,64}$/.test(session)) { session = crypto.randomUUID(); try { sessionStorage.setItem('darle', session); } catch { /* ignore */ } }
let mode: 'server' | 'local' = 'server', worker: Worker | null = null, queued: string | null = null;
function startLocal() {
  mode = 'local'; modeEl.textContent = 'LOCAL / LIMITED'; modeEl.className = 'mode offline';
  engine.textContent = 'Browser-only mode. Memory and exact calculation are available; no language model is attached.';
  worker = new Worker('/darle.worker.js');
  worker.onmessage = (e: MessageEvent) => {
    const d = e.data; stats(d.stats); draw(d.bits); send.disabled = false;
    if (d.type === 'ready' && queued !== null) { worker!.postMessage({ text: queued }); queued = null; send.disabled = true; }
    if (d.type === 'reply') show(d.reply);
  };
  worker.onerror = () => { add(el('p', 'note', 'The local engine could not start. Reload to retry.')); };
}
async function boot() {
  try {
    const r = await fetch('/api/state?session=' + encodeURIComponent(session), { headers: { accept: 'application/json' }, credentials: 'same-origin' }); if (!r.ok) throw new Error(String(r.status));
    const d = await r.json(); stats(d.stats); draw(unpack(d.bits)); modeEl.textContent = 'SERVER / REACHABLE'; send.disabled = false;
    engine.textContent = [d.llm.configured ? `Language model configured: ${d.llm.model} (not live-tested)` : 'Language model not configured', d.needle?.ready ? 'Needle 2 responding' : 'Needle 2 unavailable'].join(' · ');
  } catch { startLocal(); }
}
async function submit() {
  const t = box.value.trim(); if (!t || send.disabled) return; send.disabled = true; user(t); box.value = ''; $('#counter')!.textContent = '0 / 500';
  if (mode === 'server') {
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ session, text: t }) });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json(); stats(d.stats); draw(unpack(d.bits)); show(d.reply); send.disabled = false; box.focus(); return;
    } catch { add(el('p', 'note', 'Server connection lost. Switching to limited browser-only mode; server memory is not transferred.')); queued = t; startLocal(); return; }
  }
  worker!.postMessage({ text: t });
}
form.addEventListener('submit', e => { e.preventDefault(); void submit(); });
box.addEventListener('input', () => { $('#counter')!.textContent = box.value.length + ' / 500'; });
box.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } });
$('#clear')!.addEventListener('click', () => { log.replaceChildren(); const empty = el('div', 'empty'); empty.id = 'empty'; empty.append(el('p', '', 'Conversation cleared from this screen. Session memory remains active until it expires or you start a new session.')); log.append(empty); });
$('#new-session')!.addEventListener('click', () => { const id = crypto.randomUUID(); try { sessionStorage.setItem('darle', id); } catch { /* session will be regenerated on reload */ } location.reload(); });
$('#export')!.addEventListener('click', () => { const lines = [...log.querySelectorAll<HTMLElement>('.turn')].map(t => (t.classList.contains('you') ? 'YOU' : 'DARLE') + '\n' + (t.querySelector('.txt')?.textContent ?? '')).join('\n\n'); if (!lines) return; const a = document.createElement('a'), url = URL.createObjectURL(new Blob([lines], { type: 'text/plain;charset=utf-8' })); a.href = url; a.download = 'darle-conversation.txt'; a.click(); URL.revokeObjectURL(url); });
document.querySelectorAll<HTMLButtonElement>('[data-ex]').forEach(b => b.addEventListener('click', () => { box.value = b.dataset.ex!; $('#counter')!.textContent = box.value.length + ' / 500'; box.focus(); }));
void boot();