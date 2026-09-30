// Language-model client for any OpenAI-compatible chat endpoint (llama.cpp server, Ollama, vLLM, hosted APIs).
// Constrained decoding is requested via response_format json_schema; support depends on the server, so the reply is validated again by the caller.
export interface LlmConfig { base: string; model: string; key?: string; timeoutMs: number }
export interface Msg { role: 'system' | 'user' | 'assistant'; content: string }

export function llmFromEnv(env: Record<string, string | undefined>): LlmConfig | null {
  if (!env.LLM_BASE_URL) return null;
  return { base: env.LLM_BASE_URL, model: env.LLM_MODEL ?? 'default', key: env.LLM_API_KEY || undefined, timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 60000) };
}

export async function complete(cfg: LlmConfig, messages: Msg[], schema: object, f: typeof fetch = fetch): Promise<{ text: string; tokens: number }> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
  try {
    const r = await f(cfg.base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', ...(cfg.key ? { authorization: 'Bearer ' + cfg.key } : {}) },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0, max_tokens: 700, response_format: { type: 'json_schema', json_schema: { name: 'turn', strict: true, schema } } }),
    });
    if (!r.ok) throw new Error('model returned HTTP ' + r.status);
    const j: any = await r.json();
    return { text: String(j?.choices?.[0]?.message?.content ?? ''), tokens: Number(j?.usage?.total_tokens ?? 0) };
  } finally { clearTimeout(timer); }
}
