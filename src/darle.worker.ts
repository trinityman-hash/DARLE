// Browser-only fallback (static hosting): memory + calculator, no language model.
import { seeded } from './darle.ts';
import { Agent } from './agent.ts';
const a = new Agent(seeded(), null);
const bits = (n?: string) => (n ? a.mem.bits(n) : null) ?? a.mem.bits('france');
postMessage({ type: 'ready', stats: a.mem.stats(), bits: bits() });
onmessage = async (e: MessageEvent) => {
  const reply = await a.turn(String(e.data.text ?? '').slice(0, 500));
  postMessage({ type: 'reply', reply, stats: a.mem.stats(), bits: bits(reply.touched) });
};
