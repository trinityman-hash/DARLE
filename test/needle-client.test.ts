import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeNeedle } from '../src/needle-client.ts';

test('Needle client sends bounded request and validates matching response ID', async () => {
  let seen: RequestInit | undefined;
  const fetchFn: typeof fetch = async (_input, init) => {
    seen = init;
    return new Response(JSON.stringify({
      request_id: 'req-1', model: 'needle3-test',
      result: { type: 'text', text: 'proposal', function_calls: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const r = await completeNeedle({ base: 'http://127.0.0.1:8765/', token: 'secret', timeoutMs: 1000 }, 'req-1', 'extract fields', fetchFn);
  assert.equal(r.model, 'needle3-test');
  assert.equal((r.result as any).text, 'proposal');
  assert.equal(new Headers(seen?.headers).get('authorization'), 'Bearer secret');
  assert.equal(JSON.parse(String(seen?.body)).request_id, 'req-1');
});
test('Needle client rejects mismatched response IDs and malformed shapes', async () => {
  const fetchFn: typeof fetch = async () => new Response(JSON.stringify({
    request_id: 'other', model: 'needle3-test', result: {},
  }), { status: 200 });
  await assert.rejects(() => completeNeedle({ base: 'http://localhost', timeoutMs: 1000 }, 'req-1', 'task', fetchFn), /response shape/);
});
test('Needle client rejects invalid input and non-success responses', async () => {
  const cfg = { base: 'http://localhost', timeoutMs: 1000 };
  await assert.rejects(() => completeNeedle(cfg, '', 'task'), /invalid Needle request/);
  const failed: typeof fetch = async () => new Response('', { status: 503 });
  await assert.rejects(() => completeNeedle(cfg, 'req-1', 'task', failed), /HTTP 503/);
});

test('Needle client uses schema-bound extraction endpoint', async () => {
  let input = '';
  const schema = { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false };
  const fetchFn: typeof fetch = async (url, init) => {
    input = String(url) + ' ' + String(init?.body);
    return new Response(JSON.stringify({ request_id: 'extract-1', model: 'needle3-test', result: { city: 'Indore' } }), { status: 200 });
  };
  const r = await completeNeedle({ base: 'http://localhost', timeoutMs: 1000 }, 'extract-1', 'I live in Indore', fetchFn, schema);
  assert.match(input, /\/v1\/extract/);
  assert.deepEqual(r.result, { city: 'Indore' });
  await assert.rejects(() => completeNeedle({ base: 'http://localhost', timeoutMs: 1000 }, 'extract-2', 'text', fetchFn, { type: 'array' }), /invalid Needle schema/);
});

test('Needle extraction preserves documented null no-match result', async () => {
  const fetchFn: typeof fetch = async () => new Response(JSON.stringify({
    request_id: 'no-match', model: 'needle3-test', result: null,
  }), { status: 200 });
  const r = await completeNeedle({ base: 'http://localhost', timeoutMs: 1000 }, 'no-match', 'no matching fields', fetchFn, { type: 'object' });
  assert.equal(r.result, null);
});

test('Needle client normalizes cyclic and oversized schema failures', async () => {
  const cfg = { base: 'http://localhost', timeoutMs: 1000 };
  const cyclic: Record<string, unknown> = { type: 'object' }; cyclic.self = cyclic;
  await assert.rejects(() => completeNeedle(cfg, 'cycle-1', 'text', fetch, cyclic), /invalid Needle schema/);
  await assert.rejects(() => completeNeedle(cfg, 'large-1', 'text', fetch, { type: 'object', description: 'x'.repeat(4100) }), /invalid Needle schema/);
});


test('Needle client bounds response bytes and validates model metadata', async () => {
  const cfg = { base: 'http://localhost', timeoutMs: 1000 };
  const oversized: typeof fetch = async () => new Response(' '.repeat(65537), { status: 200 });
  await assert.rejects(() => completeNeedle(cfg, 'large-response', 'task', oversized), /size limit/);
  const emptyModel: typeof fetch = async () => new Response(JSON.stringify({
    request_id: 'empty-model', model: ' ', result: {},
  }), { status: 200 });
  await assert.rejects(() => completeNeedle(cfg, 'empty-model', 'task', emptyModel), /response shape/);
});
