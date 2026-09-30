const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const log = $('#log'), form = $<HTMLFormElement>('#form'), box = $<HTMLTextAreaElement>('#prompt'), send = $<HTMLButtonElement>('#send'), modeEl = $('#mode');
const fmt = new Intl.NumberFormat('en');
const el = (tag: string, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; return e; };
const add = (n: HTMLElement) => { $('#empty')?.remove(); log.append(n); log.scrollTop = log.scrollHeight; };
function stats(s: { dims: number; banks: number; facts: number; bytes: number }) {
  $('#s-d').textContent = fmt.format(s.dims); $('#s-b').textContent = fmt.format(s.banks); $('#s-f').textContent = fmt.format(s.facts); $('#s-m').textContent = (s.bytes / 1048576).toFixed(1) + ' MB';
}
function draw(bits: Uint8Array | null) {
  if (!bits) return; const c = $<HTMLCanvasElement>('#matrix'), g = c.getContext('2d')!, S = c.width, cols = 90, u = S / cols;
  g.clearRect(0, 0, S, S); g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#fffdf7'; g.fillRect(0, 0, S, S); g.fillStyle = '#ff4f12';
  for (let j = 0; j < bits.length; j++) if (bits[j]) g.fillRect((j % cols) * u, Math.floor(j / cols) * u, u - 0.6, u - 0.6);
  g.restore(); g.strokeStyle = '#151515'; g.lineWidth = 3; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2); g.stroke();
}
const unpack = (b64: string): Uint8Array | null => { if (!b64) return null; const raw = atob(b64), o = new Uint8Array(raw.length * 8); for (let j = 0; j < o.length; j++) o[j] = (raw.charCodeAt(j >> 3) >> (j & 7)) & 1; return o; };
function show(r: { text: string; verdict?: string; proof: string[] }) {
  const m = el('div', 'msg bot ' + (r.verdict ?? ''), r.text);
  if (r.proof.length) { const det = el('details', 'proof'); det.append(el('summary', '', 'proof'), ...r.proof.map(p => el('div', 'pl', p))); m.append(det); }
  add(m);
}
let session = ''; try { session = sessionStorage.getItem('darle') ?? ''; } catch { /* storage blocked */ }
if (!session) { session = crypto.randomUUID(); try { sessionStorage.setItem('darle', session); } catch { /* ignore */ } }

let mode: 'server' | 'local' = 'server', worker: Worker | null = null, queued: string | null = null;
function startLocal() {
  mode = 'local'; modeEl.textContent = 'running in your browser (no server found)';
  worker = new Worker('/darle.worker.js');
  worker.onmessage = (e: MessageEvent) => {
    const d = e.data; stats(d.stats); draw(d.bits); send.disabled = false;
    if (d.type === 'ready' && queued !== null) { worker!.postMessage({ text: queued }); queued = null; send.disabled = true; }
    if (d.type === 'reply') show(d.reply);
  };
  worker.onerror = () => add(el('div', 'msg halt', 'The engine could not start in this browser.'));
}
async function boot() {
  try {
    const r = await fetch('/api/state?session=' + session); if (!r.ok) throw new Error(String(r.status));
    const d = await r.json(); stats(d.stats); draw(unpack(d.bits)); modeEl.textContent = 'connected to server'; send.disabled = false;
  } catch { startLocal(); }
}
async function submit() {
  const t = box.value.trim(); if (!t || send.disabled) return; send.disabled = true; add(el('div', 'msg you', t)); box.value = '';
  if (mode === 'server') {
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session, text: t }) });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json(); stats(d.stats); draw(unpack(d.bits)); show(d.reply); send.disabled = false; return;
    } catch { add(el('div', 'msg halt', 'Lost the server. Continuing in your browser; what you taught this session is not carried over.')); queued = t; startLocal(); return; }
  }
  worker!.postMessage({ text: t });
}
form.addEventListener('submit', e => { e.preventDefault(); void submit(); });
box.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } });
$('#clear').onclick = () => log.replaceChildren();
document.querySelectorAll<HTMLButtonElement>('[data-ex]').forEach(b => b.onclick = () => { box.value = b.dataset.ex!; box.focus(); });
void boot();
