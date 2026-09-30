interface Claim { fact: string; status: 'supported' | 'contradicted' | 'unknown'; proof: string[] }
interface Turn { text: string; route: 'memory' | 'calc' | 'model' | 'none'; claims: Claim[]; proof: string[]; notes: string[]; tokens: number }
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const log = $('#log'), form = $<HTMLFormElement>('#form'), box = $<HTMLTextAreaElement>('#prompt'), send = $<HTMLButtonElement>('#send'), modeEl = $('#mode'), trace = $('#trace'), engine = $('#engine');
const fmt = new Intl.NumberFormat('en');
const ROUTE = { memory: 'from memory', calc: 'calculator', model: 'language model', none: 'declined' } as const;
const LABEL = { supported: 'verified', contradicted: 'conflict', unknown: 'unverified' } as const;
const el = (tag: string, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; return e; };
const add = (n: HTMLElement) => { $('#empty')?.remove(); log.append(n); log.scrollTop = log.scrollHeight; };
function stats(s: { dims: number; banks: number; facts: number; bytes: number }) {
  $('#s-d').textContent = fmt.format(s.dims); $('#s-b').textContent = fmt.format(s.banks); $('#s-f').textContent = fmt.format(s.facts); $('#s-m').textContent = (s.bytes / 1048576).toFixed(1) + ' MB';
}
function draw(bits: Uint8Array | null) {
  if (!bits) return; const c = $<HTMLCanvasElement>('#matrix'), g = c.getContext('2d')!, S = c.width, cols = 90, u = S / cols;
  g.clearRect(0, 0, S, S); g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#faf7ee'; g.fillRect(0, 0, S, S); g.fillStyle = '#ff4f12';
  for (let j = 0; j < bits.length; j++) if (bits[j]) g.fillRect((j % cols) * u, Math.floor(j / cols) * u, u - 0.6, u - 0.6);
  g.restore(); g.strokeStyle = '#141414'; g.lineWidth = 3; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2); g.stroke();
}
const unpack = (b64: string): Uint8Array | null => { if (!b64) return null; const raw = atob(b64), o = new Uint8Array(raw.length * 8); for (let j = 0; j < o.length; j++) o[j] = (raw.charCodeAt(j >> 3) >> (j & 7)) & 1; return o; };

function renderTrace(r: Turn) {
  trace.replaceChildren();
  trace.append(el('p', 'kv', `route: ${ROUTE[r.route]}${r.tokens ? ' \u00b7 ' + fmt.format(r.tokens) + ' tokens' : ''}`));
  if (r.claims.length) {
    const ul = el('ul', 'claims');
    for (const c of r.claims) { const li = el('li', 'c ' + c.status); li.append(el('span', 'mk'), el('span', 'ct', c.fact), el('span', 'cs', LABEL[c.status])); ul.append(li); }
    trace.append(ul);
  }
  for (const n of r.notes) trace.append(el('p', 'note', n));
  for (const p of new Set([...r.proof, ...r.claims.flatMap(c => c.proof)])) trace.append(el('div', 'pl', p));
  if (trace.children.length === 1 && !r.notes.length) trace.append(el('p', 'note', 'Nothing to verify in this answer.'));
}
function show(r: Turn) {
  const t = el('div', 'turn darle'), body = el('div', 'body'), meta = el('div', 'meta');
  meta.append(el('span', 'chip r-' + r.route, ROUTE[r.route]));
  if (r.claims.length) { const ok = r.claims.filter(c => c.status === 'supported').length, bad = r.claims.filter(c => c.status === 'contradicted').length; meta.append(el('span', 'chip', `${ok}/${r.claims.length} claims verified${bad ? `, ${bad} conflict` : ''}`)); }
  body.append(el('p', 'txt', r.text), meta); t.append(el('span', 'who', 'darle'), body); add(t); renderTrace(r);
}
function user(text: string) { const t = el('div', 'turn you'); t.append(el('span', 'who', 'you'), el('div', 'body')); t.querySelector('.body')!.append(el('p', 'txt', text)); add(t); }

let session = ''; try { session = sessionStorage.getItem('darle') ?? ''; } catch { /* storage blocked */ }
if (!session) { session = crypto.randomUUID(); try { sessionStorage.setItem('darle', session); } catch { /* ignore */ } }
let mode: 'server' | 'local' = 'server', worker: Worker | null = null, queued: string | null = null;
function startLocal() {
  mode = 'local'; modeEl.textContent = 'browser only'; engine.textContent = 'Not available in browser-only mode. Answers come from memory and the calculator.';
  worker = new Worker('/darle.worker.js');
  worker.onmessage = (e: MessageEvent) => {
    const d = e.data; stats(d.stats); draw(d.bits); send.disabled = false;
    if (d.type === 'ready' && queued !== null) { worker!.postMessage({ text: queued }); queued = null; send.disabled = true; }
    if (d.type === 'reply') show(d.reply);
  };
  worker.onerror = () => { const n = el('p', 'note', 'The engine could not start in this browser.'); log.append(n); };
}
async function boot() {
  try {
    const r = await fetch('/api/state?session=' + session); if (!r.ok) throw new Error(String(r.status));
    const d = await r.json(); stats(d.stats); draw(unpack(d.bits)); modeEl.textContent = 'server connected'; send.disabled = false;
    engine.textContent = d.llm.configured ? `Attached: ${d.llm.model}. Its answers are typed, calculated and verified.` : 'None attached. Answers come from memory and the calculator only. Set LLM_BASE_URL on the server to attach one.';
  } catch { startLocal(); }
}
async function submit() {
  const t = box.value.trim(); if (!t || send.disabled) return; send.disabled = true; user(t); box.value = '';
  if (mode === 'server') {
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session, text: t }) });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json(); stats(d.stats); draw(unpack(d.bits)); show(d.reply); send.disabled = false; return;
    } catch { log.append(el('p', 'note', 'Lost the server. Continuing in your browser; this session\'s memory is not carried over.')); queued = t; startLocal(); return; }
  }
  worker!.postMessage({ text: t });
}
form.addEventListener('submit', e => { e.preventDefault(); void submit(); });
box.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } });
$('#clear').onclick = () => { log.replaceChildren(); trace.replaceChildren(el('p', 'note', 'Nothing yet.')); };
document.querySelectorAll<HTMLButtonElement>('[data-ex]').forEach(b => b.onclick = () => { box.value = b.dataset.ex!; box.focus(); });
void boot();
