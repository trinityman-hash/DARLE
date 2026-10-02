import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeWorkflow, validateWorkflow, type Workflow } from '../src/runtime/workflow.ts';

const wf: Workflow = { version: 1, id: 'sample', steps: [
  { id: 'first', connector: 'core', action: 'echo', input: { message: 'safe' } },
  { id: 'second', connector: 'core', action: 'echo', input: { count: 2 } }
] };
const registry = new Map([['core', new Map([['echo', async (input: Readonly<Record<string, import('../src/runtime/workflow.ts').Json>>) => input.message ?? null]])]]);

test('validates data-only workflows and rejects duplicate IDs', () => {
  assert.equal(validateWorkflow(wf).steps.length, 2);
  assert.throws(() => validateWorkflow({ ...wf, steps: [wf.steps[0], wf.steps[0]] }), /duplicate/);
  assert.throws(() => validateWorkflow({ ...wf, steps: [{ ...wf.steps[0], input: { constructor: 'unsafe' } }] }), /bounded JSON/);
  assert.throws(() => validateWorkflow({ ...wf, steps: [{ ...wf.steps[0], input: { n: Infinity } }] }), /bounded JSON/);
});
test('executes registered actions in order and returns bounded run records', async () => {
  const result = await executeWorkflow(wf, registry, { runId: 'run-1' });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.steps.map(s => s.stepId), ['first', 'second']);
});
test('fails closed on unknown action and does not execute later steps', async () => {
  let called = 0;
  const result = await executeWorkflow(wf, new Map(), { runId: 'run-2' });
  assert.equal(result.status, 'failed');
  assert.equal(result.steps.length, 1);
  assert.equal(called, 0);
});
test('rejects invalid timeout configuration', async () => {
  await assert.rejects(executeWorkflow(wf, registry, { runId: 'run-3', stepTimeoutMs: 0 }), /timeout/);
});
test('aborts before executing when caller cancels', async () => {
  const controller = new AbortController(); controller.abort();
  const result = await executeWorkflow(wf, registry, { runId: 'run-4', signal: controller.signal });
  assert.equal(result.status, 'failed'); assert.equal(result.steps.length, 0);
});
