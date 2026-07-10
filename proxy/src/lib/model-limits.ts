import type { Model } from "~/services/copilot/get-models"

export const DEFAULT_PROMPT_TOKENS = 200_000
export const ONE_M_PROMPT_TOKENS = 936_000
export const ONE_M_CONTEXT_TOKENS = 1_000_000

export function getModelPromptLimit(
  modelId: string,
  limits?: Model["capabilities"]["limits"],
): number {
  return getKnownModelPromptLimit(modelId, limits) ?? DEFAULT_PROMPT_TOKENS
}

export function getKnownModelPromptLimit(
  modelId: string,
  limits?: Model["capabilities"]["limits"],
): number | undefined {
  if (limits?.max_prompt_tokens) return limits.max_prompt_tokens
  if (isOneMillionContextModel(modelId)) return ONE_M_PROMPT_TOKENS
  return limits?.max_context_window_tokens
}

export function getModelContextLimit(
  modelId: string,
  limits?: Model["capabilities"]["limits"],
): number {
  if (limits?.max_context_window_tokens) return limits.max_context_window_tokens
  if (isOneMillionContextModel(modelId)) return ONE_M_CONTEXT_TOKENS
  return DEFAULT_PROMPT_TOKENS
}

function isOneMillionContextModel(modelId: string): boolean {
  return /(?:^|[-_.])1m(?:$|[-_.])/i.test(modelId)
}
