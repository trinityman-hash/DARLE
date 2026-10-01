/**
 * DARLE workload classification for the multi-model router.
 *
 * This module classifies task shape only. It does not assert that a provider is
 * installed, supported, or capable. Provider availability and authorization
 * must be checked separately before inference or tool execution.
 */
export type Workload = 'deterministic' | 'needle' | 'trm' | 'language';

export interface RouteHint {
  workload: Workload;
  reason: string;
}

/**
 * Prefer deterministic handling, then narrowly supported structured domains.
 * TRM is intentionally restricted to explicit grid/puzzle inputs: it is not a
 * general natural-language or code-reasoning model.
 */
export function classifyWorkload(input: string): RouteHint {
  const text = input.trim();
  if (!text) return { workload: 'language', reason: 'empty-or-unclassified-input' };

  const arithmetic = text
    .replace(/^(what is|what's|calculate|compute)\s+/i, '')
    .replace(/[?=\s]+$/, '');
  if (/^[\d\s+\-*/%^().]+$/.test(arithmetic) && /\d/.test(arithmetic) && /[-+*/%^]/.test(arithmetic)) {
    return { workload: 'deterministic', reason: 'arithmetic-expression' };
  }

  // These patterns are deliberately explicit; free prose mentioning "grid"
  // alone must not trigger a specialist model.
  if (/^(solve|complete|fill)\s+(this\s+)?(sudoku|maze|arc[- ]agi|grid puzzle)\b/i.test(text) ||
      /^(sudoku|maze)\s*:\s*[.0-9#x\s,;|]+$/i.test(text) ||
      /^arc[- ]agi\s+(input|task)\s*:/i.test(text)) {
    return { workload: 'trm', reason: 'explicit-supported-structured-puzzle' };
  }

  if (/\b(extract|classify|parse|select|route|which tool|tool call|structured output|json schema)\b/i.test(text) &&
      text.length <= 4000) {
    return { workload: 'needle', reason: 'bounded-structured-action-or-extraction' };
  }

  return { workload: 'language', reason: 'general-language-or-unclassified-task' };
}
