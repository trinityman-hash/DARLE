import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { seeded } from '../src/darle.ts';
import { Agent } from '../src/agent.ts';
import { calc } from '../src/calc.ts';
import { check, jsonSchema, str, arr, obj, bool } from '../src/typed.ts';

/** Scripted OpenAI-compatible server. The last reply repeats once the script runs out. */
function mock(replies: (string | object)[]) {
  const calls: any[] = [];
  const srv = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    calls.push(JSON.parse(b));
    const r = replies[Math.min(calls.length - 1, replies.length - 1)], content = typeof r === 'string' ? r : JSON.stringify(r);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 10 } }));
  });
  return new Promise<{ url: string; calls: any[]; close: () => void }>(ok => srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`, calls, close: () => { srv.closeAllConnections(); srv.close(); } })));
}
const turn = (answer: string, claims: object[] = [], calcExpr = '') => ({ answer, claims, calc: calcExpr });
const claim = (s: string, rel: string, o: string) => ({ s, rel, o, neg: false });
async function rig(replies: (string | object)[]) { const m = await mock(replies); return { m, a: new Agent(seeded(), { base: m.url, model: 'mock', timeoutMs: 3000 }) }; }

test('calc: precedence, powers, errors, no code execution', () => {
  assert.equal(calc('2+3*4'), 14); assert.equal(calc('2^3^2'), 512); assert.equal(calc('-2^2'), -4);
  assert.equal(calc('(1+2)*sqrt(16)'), 12); assert.equal(calc('0.1+0.2'), 0.3);
  for (const bad of ['1/0', 'process.exit()', '2+', '9^9^9', '1;2', '']) assert.throws(() => calc(bad), bad);
});
test('typed gate rejects wrong shapes and emits a strict JSON schema', () => {
  const s = obj({ a: str(3), b: arr(bool(), 2) });
  assert.equal(check(s, { a: 'ab', b: [true] }), null);
  for (const bad of [{ a: 'abcd', b: [] }, { a: 'a' }, { a: 'a', b: [1] }, { a: 'a', b: [], z: 1 }, null, []]) assert.notEqual(check(s, bad), null);
  assert.equal((jsonSchema(s) as any).additionalProperties, false);
});
test('arithmetic never reaches the model', async () => {
  const { m, a } = await rig([turn('x')]); const r = await a.turn('What is 1234 * 5678?'); m.close();
  assert.equal(r.route, 'calc'); assert.equal(r.text, '1234 * 5678 = 7006652'); assert.equal(m.calls.length, 0);
});
test('memory-first: provable questions never reach the model', async () => {
  const { m, a } = await rig([turn('SHOULD NOT BE USED')]); const r = await a.turn('Is a whale an animal?'); m.close();
  assert.equal(r.route, 'memory'); assert.equal(m.calls.length, 0); assert.equal(r.tokens, 0);
});
test('ordinary sentences are not mistaken for facts', () => {
  const d = seeded(); for (const s of ['I think the sky is blue.', 'She lives in Paris.', 'Tell me about Paris']) assert.equal(d.chat(s).miss, true, s);
});
test('unknown questions go to the model; claims are verified; the model output is never stored', async () => {
  const { m, a } = await rig([turn('Paris is the capital of France.', [claim('Paris', 'capital of', 'France'), claim('Paris', 'twinned with', 'Rome')])]);
  const r = await a.turn('Tell me about Paris'); m.close();
  assert.equal(r.route, 'model'); assert.deepEqual(r.claims.map(c => c.status), ['supported', 'unknown']);
  assert.equal(m.calls[0].response_format.json_schema.strict, true); assert.equal(m.calls[0].temperature, 0);
  assert.equal(a.mem.verify({ s: 'paris', rel: 'twinned with', o: 'rome', neg: false }).v, 'unknown');
});
test('a contradicted claim sends the model back with evidence, then the corrected answer is accepted', async () => {
  const { m, a } = await rig([turn('Sam lives in Rome.', [claim('Sam', 'lives in', 'Rome')]), turn('Sam lives in Paris.', [claim('Sam', 'lives in', 'Paris')])]);
  await a.turn('Sam lives in Paris.'); const r = await a.turn('Tell me about Sam'); m.close();
  assert.equal(m.calls.length, 2); assert.equal(r.text, 'Sam lives in Paris.'); assert.ok(r.notes.some(n => n.startsWith('retry')));
  assert.match(JSON.stringify(m.calls[0].messages), /Sam lives in paris/);
  assert.match(JSON.stringify(m.calls[1].messages), /conflict with verified memory/);
});
test('a model that keeps contradicting memory is declined after four tries', async () => {
  const { m, a } = await rig([turn('Sam lives in Rome.', [claim('Sam', 'lives in', 'Rome')])]);
  await a.turn('Sam lives in Paris.'); const r = await a.turn('Tell me about Sam'); m.close();
  assert.equal(r.route, 'none'); assert.match(r.text, /not going to guess/); assert.equal(m.calls.length, 4);
});
test('calculation is requested by the model and returned as a fact', async () => {
  const { m, a } = await rig([turn('', [], '12*13'), turn('12 times 13 is 156.')]);
  const r = await a.turn('Tell me 12 times 13'); m.close();
  assert.equal(r.route, 'model'); assert.equal(r.text, '12 times 13 is 156.'); assert.match(JSON.stringify(m.calls[1].messages), /calc result: 12\*13 = 156/);
});
test('invalid model output is rejected and re-asked', async () => {
  const { m, a } = await rig(['not json', { answer: 5 }, { answer: 'x', claims: [], calc: '', extra: 1 }, turn('ok')]);
  const r = await a.turn('Tell me something'); m.close();
  assert.equal(r.text, 'ok'); assert.equal(m.calls.length, 4); assert.equal(r.notes.filter(n => n.startsWith('invalid output')).length, 3);
});
test('an unreachable model degrades gracefully; memory still works', async () => {
  const a = new Agent(seeded(), { base: 'http://127.0.0.1:1/v1', model: 'x', timeoutMs: 1500 });
  const r = await a.turn('Tell me about Paris'); assert.equal(r.route, 'none'); assert.match(r.text, /unavailable/);
  assert.equal((await a.turn('Is a whale an animal?')).route, 'memory');
});
test('without a model it answers from memory and says when it cannot parse', async () => {
  const a = new Agent(seeded(), null); const r = await a.turn('Tell me about Paris'); assert.equal(r.route, 'memory'); assert.match(r.text, /could not parse/);
});

test('specialist workload is identified and fallback to general LLM is disclosed', async () => {
  const { m, a } = await rig([turn('Extracted fields.')]);
  const r = await a.turn('Extract names and dates as JSON');
  m.close();
  assert.equal(r.route, 'model');
  assert.ok(r.notes.some(n => n.includes('workload=needle') && n.includes('needle-provider-unavailable-language-fallback')));
  assert.equal(m.calls.length, 1);
});


test('configured Needle handles bounded extraction through the Agent and validates claims', async () => {
  let calls = 0;
  const fetchFn: typeof fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.schema.type, 'object');
    return new Response(JSON.stringify({ request_id: body.request_id, model: 'needle3-test', result: turn('The extracted value is Indore.', []) }), { status: 200 });
  };
  const a = new Agent(seeded(), null, fetchFn, { base: 'http://127.0.0.1:8765', timeoutMs: 1000 });
  const r = await a.turn('Extract the city as JSON');
  assert.equal(calls, 1);
  assert.equal(r.route, 'model');
  assert.equal(r.text, 'The extracted value is Indore.');
  assert.ok(r.notes.some(n => n.includes('needle-model=needle3-test')));
});

test('configured Needle invalid structured output is not accepted', async () => {
  const fetchFn: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ request_id: body.request_id, model: 'needle3-test', result: { answer: 'untrusted', claims: [], calc: '', extra: true } }), { status: 200 });
  };
  const a = new Agent(seeded(), null, fetchFn, { base: 'http://127.0.0.1:8765', timeoutMs: 1000 });
  const r = await a.turn('Extract the city as JSON');
  assert.equal(r.route, 'none');
  assert.match(r.text, /invalid structured result/);
});
