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

test('freezes nested input and isolates it from the caller workflow', async () => {
  const input = { nested: { value: 'original' } };
  const workflow: Workflow = { version: 1, id: 'immutable', steps: [{ id: 'only', connector: 'core', action: 'inspect', input }] };
  let frozen = false;
  const actions = new Map([['core', new Map([['inspect', async (data: Readonly<Record<string, import('../src/runtime/workflow.ts').Json>>) => {
    frozen = Object.isFrozen(data) && Object.isFrozen(data.nested);
    return (data.nested as Record<string, import('../src/runtime/workflow.ts').Json>).value;
  }]])]]);
  const result = await executeWorkflow(workflow, actions, { runId: 'run-5' });
  assert.equal(frozen, true);
  assert.equal(input.nested.value, 'original');
  assert.equal(result.status, 'succeeded');
});
test('cancels an active action and records failure', async () => {
  const controller = new AbortController();
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const actions = new Map([['core', new Map([['echo', async (_input: Readonly<Record<string, import('../src/runtime/workflow.ts').Json>>, context: import('../src/runtime/workflow.ts').RunContext) => {
    markStarted();
    return new Promise<import('../src/runtime/workflow.ts').Json>(resolve => context.signal.addEventListener('abort', () => resolve(null), { once: true }));
  }]])]]);
  const running = executeWorkflow(wf, actions, { runId: 'run-6', signal: controller.signal });
  await started;
  controller.abort();
  const result = await running;
  assert.equal(result.status, 'failed');
  assert.match(result.steps[0].error ?? '', /cancelled/);
});
test('times out a stalled action and never starts the next step', async () => {
  let calls = 0;
  const actions = new Map([['core', new Map([['echo', async () => {
    calls++;
    return new Promise<import('../src/runtime/workflow.ts').Json>(() => {});
  }]])]]);
  const result = await executeWorkflow(wf, actions, { runId: 'run-7', stepTimeoutMs: 10 });
  assert.equal(result.status, 'failed');
  assert.match(result.steps[0].error ?? '', /timed out/);
  assert.equal(calls, 1);
});
test('rejects non-JSON connector output', async () => {
  const actions = new Map([['core', new Map([['echo', async () => Infinity as import('../src/runtime/workflow.ts').Json]])]]);
  const result = await executeWorkflow(wf, actions, { runId: 'run-8' });
  assert.equal(result.status, 'failed');
  assert.match(result.steps[0].error ?? '', /invalid or oversized JSON/);
});


test('denies actions with undeclared run grants and permits explicit grants', async () => {
  let calls = 0;
  const send = Object.assign(async () => { calls++; return { sent: true }; }, { requiredPermissions: ['network_send'] as const });
  const actions = new Map([['chat', new Map([['send', send]])]]);
  const workflow: Workflow = { version: 1, id: 'permissioned', steps: [
    { id: 'send', connector: 'chat', action: 'send', input: {} }
  ] };
  const denied = await executeWorkflow(workflow, actions, { runId: 'run-denied' });
  assert.equal(denied.status, 'failed');
  assert.match(denied.steps[0].error ?? '', /permission was not granted/);
  assert.equal(calls, 0);
  const allowed = await executeWorkflow(workflow, actions, { runId: 'run-allowed', grants: [{ workflowId: 'permissioned', connector: 'chat', action: 'send', permission: 'network_send' }] });
  assert.equal(allowed.status, 'succeeded');
  assert.equal(calls, 1);
});

test('rejects malformed connector permission declarations', async () => {
  const action = Object.assign(async () => null, { requiredPermissions: ['Network Send'] });
  const actions = new Map([['chat', new Map([['send', action]])]]);
  const workflow: Workflow = { version: 1, id: 'badpermission', steps: [
    { id: 'send', connector: 'chat', action: 'send', input: {} }
  ] };
  const result = await executeWorkflow(workflow, actions, { runId: 'run-badpermission', grants: [{ workflowId: 'badpermission', connector: 'chat', action: 'send', permission: 'Network Send' }] });
  assert.equal(result.status, 'failed');
  assert.match(result.steps[0].error ?? '', /declaration is invalid/);
});


test('permission grants are scoped to the exact workflow, connector, and action', async () => {
  let calls = 0;
  const action = Object.assign(async () => { calls++; return null; }, { requiredPermissions: ['network_send'] as const });
  const actions = new Map([['chat', new Map([['send', action]])]]);
  const workflow: Workflow = { version: 1, id: 'scoped', steps: [
    { id: 'send', connector: 'chat', action: 'send', input: {} }
  ] };
  const mismatched = await executeWorkflow(workflow, actions, { runId: 'scope-1', grants: [
    { workflowId: 'other', connector: 'chat', action: 'send', permission: 'network_send' }
  ] });
  assert.equal(mismatched.status, 'failed');
  assert.equal(calls, 0);
  const matched = await executeWorkflow(workflow, actions, { runId: 'scope-2', grants: [
    { workflowId: 'scoped', connector: 'chat', action: 'send', permission: 'network_send' }
  ] });
  assert.equal(matched.status, 'succeeded');
  assert.equal(calls, 1);
});
