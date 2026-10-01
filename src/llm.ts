// Language-model client for OpenAI-compatible chat endpoints.
export interface LlmConfig { base: string; model: string; key?: string; timeoutMs: number }
export interface Msg { role: 'system' | 'user' | 'assistant'; content: string }

export function llmFromEnv(env: Record<string, string | undefined>): LlmConfig | null {
  if (!env.LLM_BASE_URL) return null;
  return { base: env.LLM_BASE_URL, model: env.LLM_MODEL ?? 'default', key: env.LLM_API_KEY || undefined, timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 60000) };
}

export async function complete(cfg: LlmConfig, messages: Msg[], schema: object, f: typeof fetch = fetch): Promise<{ text: string; tokens: number }> {
  let endpoint: URL;
  try { endpoint = new URL(cfg.base); } catch { throw new Error('invalid language model configuration'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
      !cfg.model.trim() || !Number.isFinite(cfg.timeoutMs) || cfg.timeoutMs <= 0 ||
      !Array.isArray(messages) || messages.some(m => !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string') ||
      !schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('invalid language model configuration');
  }
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
  try {
    const r = await f(cfg.base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', ...(cfg.key ? { authorization: 'Bearer ' + cfg.key } : {}) },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0, max_tokens: 700, response_format: { type: 'json_schema', json_schema: { name: 'turn', strict: true, schema } } }),
    });
    if (!r.ok) throw new Error('model returned HTTP ' + r.status);
    let j: unknown;
    try { j = await r.json(); } catch { throw new Error('invalid language model response'); }
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('invalid language model response');
    const data = j as Record<string, any>, choice = data.choices?.[0], text = choice?.message?.content;
    const tokens = data.usage?.total_tokens ?? 0;
    if (!Array.isArray(data.choices) || !choice || !choice.message || typeof text !== 'string' ||
        typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0) {
      throw new Error('invalid language model response');
    }
    return { text, tokens };
  } finally { clearTimeout(timer); }
}
