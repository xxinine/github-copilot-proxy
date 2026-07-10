import { describe, expect, test } from "bun:test"

import { mergeUsage, normalizeUsage } from "~/cpx/usage-middleware"

describe("normalizeUsage", () => {
  test("OpenAI chat/completions shape (prompt_tokens + details)", () => {
    const usage = normalizeUsage({
      model: "gpt-4o",
      usage: {
        prompt_tokens: 100,
        completion_tokens: 40,
        total_tokens: 140,
        prompt_tokens_details: { cached_tokens: 80 },
        completion_tokens_details: { reasoning_tokens: 12 },
      },
    })
    expect(usage).toEqual({
      model: "gpt-4o",
      promptTokens: 100,
      completionTokens: 40,
      cachedTokens: 80,
      reasoningTokens: 12,
      totalTokens: 140,
      costNanoAiu: undefined,
    })
  })

  test("OpenAI Responses shape (input_tokens nested under response)", () => {
    const usage = normalizeUsage({
      type: "response.completed",
      response: {
        model: "gpt-5.5",
        usage: {
          input_tokens: 200,
          output_tokens: 60,
          total_tokens: 260,
          input_tokens_details: { cached_tokens: 150 },
          output_tokens_details: { reasoning_tokens: 25 },
        },
      },
    })
    expect(usage).toMatchObject({
      model: "gpt-5.5",
      promptTokens: 200,
      completionTokens: 60,
      cachedTokens: 150,
      reasoningTokens: 25,
      totalTokens: 260,
    })
  })

  test("Anthropic message_start shape (message.usage + cache_read_input_tokens)", () => {
    const usage = normalizeUsage({
      type: "message_start",
      message: {
        model: "claude-opus-4.8",
        usage: { input_tokens: 12, cache_read_input_tokens: 12825 },
      },
    })
    expect(usage).toMatchObject({
      model: "claude-opus-4.8",
      promptTokens: 12,
      cachedTokens: 12825,
    })
  })

  test("computes total when missing", () => {
    const usage = normalizeUsage({
      usage: { prompt_tokens: 30, completion_tokens: 10 },
    })
    expect(usage?.totalTokens).toBe(40)
  })

  test("returns model-only when no usage object present", () => {
    expect(normalizeUsage({ model: "gpt-4o" })).toEqual({ model: "gpt-4o" })
  })

  test("returns undefined for objects without usage or model", () => {
    expect(normalizeUsage({ type: "content_block_delta" })).toBeUndefined()
  })
})

describe("mergeUsage", () => {
  test("merges Anthropic input (message_start) with later output (message_delta)", () => {
    const start = normalizeUsage({
      type: "message_start",
      message: {
        model: "claude-opus-4.8",
        usage: { input_tokens: 12, cache_read_input_tokens: 12825 },
      },
    })!
    const delta = normalizeUsage({
      type: "message_delta",
      usage: { output_tokens: 77 },
    })!
    const merged = mergeUsage(start, delta)
    expect(merged).toMatchObject({
      model: "claude-opus-4.8",
      promptTokens: 12,
      cachedTokens: 12825,
      completionTokens: 77,
    })
  })

  test("keeps the larger cumulative token counts", () => {
    const a = { completionTokens: 10 }
    const b = { completionTokens: 42 }
    expect(mergeUsage(a, b).completionTokens).toBe(42)
    expect(mergeUsage(b, a).completionTokens).toBe(42)
  })
})
