import { seeded } from './darle.ts';
const d = seeded(); const bits = (n?: string) => (n ? d.bits(n) : null) ?? d.bits('france');
postMessage({ type: 'ready', stats: d.stats(), bits: bits() });
onmessage = (e: MessageEvent) => {
  const text = String(e.data.text ?? '').slice(0, 500), reply = d.chat(text);
  postMessage({ type: 'reply', reply, stats: d.stats(), bits: bits(reply.touched) });
};
