/** Client for the private DARLE Needle sidecar. This only obtains proposals;
 * it does not execute model-proposed function calls. */
export interface NeedleConfig {
  base: string;
  token?: string;
  timeoutMs: number;
}
export interface NeedleResponse {
  request_id: string;
  model: string;
  result: Record<string, unknown> | null;
}
export async function completeNeedle(
  cfg: NeedleConfig,
  requestId: string,
  text: string,
  fetchFn: typeof fetch = fetch,
  schema?: Record<string, unknown>,
): Promise<NeedleResponse> {
  if (!cfg.base || !Number.isFinite(cfg.timeoutMs) || cfg.timeoutMs <= 0) {
    throw new Error('invalid Needle configuration');
  }
  if (!requestId || requestId.length > 128 || !text.trim() || text.length > 8192) {
    throw new Error('invalid Needle request');
  }
  if (schema) {
    let encoded: string;
    try { encoded = JSON.stringify(schema); } catch { throw new Error('invalid Needle schema'); }
    if (schema.type !== 'object' || typeof encoded !== 'string' || encoded.length > 4096) {
      throw new Error('invalid Needle schema');
    }
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
  try {
    const response = await fetchFn(cfg.base.replace(/\/$/, '') + (schema ? '/v1/extract' : '/v1/complete'), {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'content-type': 'application/json',
        ...(cfg.token ? { authorization: 'Bearer ' + cfg.token } : {}),
      },
      body: JSON.stringify({ request_id: requestId, text, ...(schema ? { schema } : { max_new_tokens: 256 }) }),
    });
    if (!response.ok) throw new Error('Needle adapter returned HTTP ' + response.status);
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null && (!/^\\d+$/.test(declaredLength) || Number(declaredLength) > 65536)) {
      throw new Error('Needle response exceeds size limit');
    }
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > 65536) throw new Error('Needle response exceeds size limit');
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { throw new Error('invalid Needle response JSON'); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid Needle response');
    const data = raw as Record<string, unknown>;
    if (data.request_id !== requestId || typeof data.model !== 'string' || !data.model.trim() || data.model.length > 128 ||
        (data.result !== null && (typeof data.result !== 'object' || Array.isArray(data.result)))) {
      throw new Error('invalid Needle response shape');
    }
    return data as unknown as NeedleResponse;
  } finally {
    clearTimeout(timer);
  }
}
