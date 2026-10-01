import type { Workload } from './model-routing.ts';

export type ModelRole = 'needle' | 'trm' | 'language';

export interface ModelProvider {
  id: string;
  role: ModelRole;
  endpoint: string;
  model: string;
  available: boolean;
  maxInputChars: number;
}

export interface ModelSelection {
  provider: ModelProvider | null;
  requested: Workload;
  selected: ModelRole | 'deterministic' | 'none';
  reason: string;
}

/**
 * Selects only explicitly configured and available providers. This is policy
 * metadata, not model inference; callers must still validate outputs and
 * authorize any proposed side effects.
 */
export function selectModel(
  requested: Workload,
  providers: readonly ModelProvider[],
  inputChars: number,
): ModelSelection {
  if (requested === 'deterministic') {
    return { provider: null, requested, selected: 'deterministic', reason: 'deterministic-route' };
  }
  const role: ModelRole = requested === 'needle' || requested === 'trm' ? requested : 'language';
  const eligible = providers.find(p =>
    p.role === role && p.available && inputChars <= p.maxInputChars &&
    p.id.trim().length > 0 && p.endpoint.trim().length > 0 && p.model.trim().length > 0
  );
  if (eligible) return { provider: eligible, requested, selected: role, reason: 'configured-provider' };

  if (role !== 'language') {
    const fallback = providers.find(p =>
      p.role === 'language' && p.available && inputChars <= p.maxInputChars &&
      p.id.trim().length > 0 && p.endpoint.trim().length > 0 && p.model.trim().length > 0
    );
    if (fallback) return {
      provider: fallback, requested, selected: 'language',
      reason: role + '-provider-unavailable-language-fallback',
    };
  }
  return { provider: null, requested, selected: 'none', reason: 'no-eligible-provider' };
}
