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
