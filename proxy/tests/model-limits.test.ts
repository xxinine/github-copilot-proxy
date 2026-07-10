import { describe, expect, test } from "bun:test"

import {
  DEFAULT_PROMPT_TOKENS,
  getKnownModelPromptLimit,
  getModelContextLimit,
  getModelPromptLimit,
  ONE_M_CONTEXT_TOKENS,
  ONE_M_PROMPT_TOKENS,
} from "~/lib/model-limits"

describe("model limit helpers", () => {
  test("prefers live max_prompt_tokens over model-name fallback", () => {
    expect(
      getModelPromptLimit("claude-opus-4.7-1m-internal", {
        max_context_window_tokens: 1_000_000,
        max_prompt_tokens: 168_000,
      }),
    ).toBe(168_000)
  })

  test("uses 1m prompt fallback when metadata is missing", () => {
    expect(getModelPromptLimit("claude-opus-4.7-1m-internal")).toBe(
      ONE_M_PROMPT_TOKENS,
    )
  })

  test("uses live context limit before 1m context fallback", () => {
    expect(
      getModelContextLimit("claude-opus-4.7-1m-internal", {
        max_context_window_tokens: 200_000,
      }),
    ).toBe(200_000)
  })

  test("uses 1m context fallback when metadata is missing", () => {
    expect(getModelContextLimit("claude-opus-4.7-1m-internal")).toBe(
      ONE_M_CONTEXT_TOKENS,
    )
  })

  test("uses default prompt limit for non-1m models without metadata", () => {
    expect(getModelPromptLimit("claude-opus-4.7")).toBe(DEFAULT_PROMPT_TOKENS)
  })

  test("returns undefined for fitting when no real or fallback prompt limit exists", () => {
    expect(getKnownModelPromptLimit("unknown-model")).toBeUndefined()
  })
})
