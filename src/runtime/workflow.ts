/**
 * DARLE workflow contract and deterministic executor.
 * Workflows contain data only; executable behavior is supplied by explicitly
 * registered connectors. No dynamic imports, eval, shell, or implicit network.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Step { id: string; connector: string; action: string; input: Record<string, Json> }
export interface Workflow { version: 1; id: string; steps: Step[] }
export interface RunContext { workflowId: string; runId: string; stepId: string; signal: AbortSignal }
export type Action = ((input: Readonly<Record<string, Json>>, context: RunContext) => Promise<Json>) & { readonly requiredPermissions?: readonly string[] };
export type ConnectorRegistry = ReadonlyMap<string, ReadonlyMap<string, Action>>;
export interface StepResult { stepId: string; status: 'succeeded' | 'failed'; output?: Json; error?: string }
export interface RunResult { workflowId: string; runId: string; status: 'succeeded' | 'failed'; steps: StepResult[] }

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const MAX_STEPS = 32, MAX_DEPTH = 8, MAX_NODES = 2048, MAX_STRING = 8192;
function validJson(value: unknown, depth = 0, budget = { n: 0 }): value is Json {
  if (++budget.n > MAX_NODES || depth > MAX_DEPTH) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= MAX_STRING;
  if (Array.isArray(value)) return value.length <= MAX_NODES && value.every(v => validJson(v, depth + 1, budget));
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value);
    return entries.length <= MAX_NODES && entries.every(([k, v]) => k.length <= 128 && k !== '__proto__' && k !== 'constructor' && k !== 'prototype' && validJson(v, depth + 1, budget));
  }
  return false;
}
function immutableJson(value: Json): Json {
  if (Array.isArray(value)) return Object.freeze(value.map(immutableJson)) as unknown as Json;
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, Json> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = immutableJson(item);
    return Object.freeze(copy);
  }
  return value;
}
export function validateWorkflow(value: unknown): Workflow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('workflow must be an object');
  const w = value as Record<string, unknown>;
  if (w.version !== 1 || typeof w.id !== 'string' || !ID.test(w.id)) throw new Error('invalid workflow identity or version');
  if (!Array.isArray(w.steps) || w.steps.length < 1 || w.steps.length > MAX_STEPS) throw new Error(`steps must contain 1-${MAX_STEPS} entries`);
  const seen = new Set<string>();
  const steps = w.steps.map((raw): Step => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('step must be an object');
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== 'string' || !ID.test(s.id) || seen.has(s.id)) throw new Error('invalid or duplicate step id');
    if (typeof s.connector !== 'string' || !NAME.test(s.connector) || typeof s.action !== 'string' || !NAME.test(s.action)) throw new Error('invalid connector or action name');
    if (!s.input || typeof s.input !== 'object' || Array.isArray(s.input) || !validJson(s.input)) throw new Error('step input must be bounded JSON data');
    seen.add(s.id);
    return { id: s.id, connector: s.connector, action: s.action, input: immutableJson(s.input as Record<string, Json>) as Record<string, Json> };
  });
  return { version: 1, id: w.id, steps };
}

/** Executes steps in order, fail-closed on missing connectors, exceptions, timeout, or cancellation. */
export async function executeWorkflow(
  workflow: Workflow,
  registry: ConnectorRegistry,
  options: { runId: string; signal?: AbortSignal; stepTimeoutMs?: number; grants?: ReadonlySet<string> }
): Promise<RunResult> {
  const w = validateWorkflow(workflow), steps: StepResult[] = [];
  const timeout = options.stepTimeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) throw new Error('step timeout must be 1-120000 ms');
  const signal = options.signal ?? new AbortController().signal;
  for (const step of w.steps) {
    if (signal.aborted) return { workflowId: w.id, runId: options.runId, status: 'failed', steps };
    const action = registry.get(step.connector)?.get(step.action);
    if (!action) {
      steps.push({ stepId: step.id, status: 'failed', error: 'connector action is not registered' });
      return { workflowId: w.id, runId: options.runId, status: 'failed', steps };
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: ((reason: Error) => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const onAbort = () => { abort(); rejectAbort?.(new Error('run cancelled')); };
    if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await Promise.race([
        action(step.input, { workflowId: w.id, runId: options.runId, stepId: step.id, signal: controller.signal }),
        cancelled,
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('step timed out')); }, timeout); })
      ]);
      if (!validJson(result)) throw new Error('connector returned invalid or oversized JSON');
      steps.push({ stepId: step.id, status: 'succeeded', output: immutableJson(result) });
    } catch (error) {
      steps.push({ stepId: step.id, status: 'failed', error: error instanceof Error ? error.message.slice(0, 300) : 'connector failed' });
      return { workflowId: w.id, runId: options.runId, status: 'failed', steps };
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      signal.removeEventListener('abort', onAbort);
    }
  }
  return { workflowId: w.id, runId: options.runId, status: 'succeeded', steps };
}