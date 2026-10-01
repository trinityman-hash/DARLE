import { test } from 'node:test';
import assert from 'node:assert/strict';
import { complete, llmFromEnv } from '../src/llm.ts';

const cfg = { base: 'http://127.0.0.1:9000/v1', model: 'test', timeoutMs: 1000 };
const msgs = [{ role: 'user' as const, content: 'hello' }];
const schema = { type: 'object' };

test('LLM client sends constrained JSON request and parses valid response', async () => {
  let request: RequestInit | undefined;
  const fetchFn: typeof fetch = async (_url, init) => {
    request = init;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":"ok"}' } }], usage: { total_tokens: 7 } }), { status: 200 });
  };
  const result = await complete(cfg, msgs, schema, fetchFn);
  assert.deepEqual(result, { text: '{"answer":"ok"}', tokens: 7 });
  const sent = JSON.parse(String(request?.body));
  assert.equal(sent.response_format.json_schema.strict, true);
  assert.equal(sent.model, 'test');
});

test('LLM client rejects malformed configuration before making a request', async () => {
  let called = false;
  const fetchFn: typeof fetch = async () => { called = true; return new Response('{}'); };
  for (const invalid of [
    { ...cfg, base: 'file:///etc/passwd' },
    { ...cfg, base: 'http://user:pass@localhost/v1' },
    { ...cfg, timeoutMs: 0 },
    { ...cfg, timeoutMs: Number.NaN },
    { ...cfg, model: ' ' },
  ]) await assert.rejects(() => complete(invalid, msgs, schema, fetchFn), /invalid language model configuration/);
  assert.equal(called, false);
});

test('LLM client rejects invalid response envelopes and token counts', async () => {
  const responses = [null, [], {}, { choices: [{ message: { content: 12 } }] },
    { choices: [{ message: { content: 'ok' } }], usage: { total_tokens: -1 } },
    { choices: [{ message: { content: 'ok' } }], usage: { total_tokens: '7' } }];
  for (const payload of responses) {
    const fetchFn: typeof fetch = async () => new Response(JSON.stringify(payload), { status: 200 });
    await assert.rejects(() => complete(cfg, msgs, schema, fetchFn), /invalid language model response/);
  }
  const invalidJson: typeof fetch = async () => new Response('not json', { status: 200 });
  await assert.rejects(() => complete(cfg, msgs, schema, invalidJson), /invalid language model response/);
});

test('LLM environment parsing preserves optional configuration behavior', () => {
  assert.equal(llmFromEnv({}), null);
  assert.deepEqual(llmFromEnv({ LLM_BASE_URL: 'http://localhost/v1' }), {
    base: 'http://localhost/v1', model: 'default', key: undefined, timeoutMs: 60000,
  });
});
