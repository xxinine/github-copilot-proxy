import { afterEach, describe, expect, test } from "bun:test"

import { state } from "~/lib/state"
import { translateToOpenAI } from "~/routes/messages/non-stream-translation"

function addModel(id: string) {
  state.models ??= { object: "list", data: [] }
  state.models.data.push({
    id,
    object: "model",
    name: id,
    model_picker_enabled: true,
    preview: false,
    vendor: "anthropic",
    version: id,
    capabilities: {
      family: id,
      limits: {},
      object: "model_capabilities",
      supports: {},
      tokenizer: "cl100k_base",
      type: "chat",
    },
  })
}

afterEach(() => {
  state.models = undefined
})

describe("model name translation", () => {
  test("maps integer Claude versions like Sonnet 5 to Copilot model ids", () => {
    addModel("claude-sonnet-4.6")
    addModel("claude-sonnet-5")

    const result = translateToOpenAI({
      model: "claude-sonnet-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "x" }],
    })

    expect(result.model).toBe("claude-sonnet-5")
  })

  test("uses Sonnet 5 for the short sonnet alias", () => {
    const result = translateToOpenAI({
      model: "sonnet",
      max_tokens: 1,
      messages: [{ role: "user", content: "x" }],
    })

    expect(result.model).toBe("claude-sonnet-5")
  })

  test("uses Opus 4.8 for the short opus alias", () => {
    const result = translateToOpenAI({
      model: "opus",
      max_tokens: 1,
      messages: [{ role: "user", content: "x" }],
    })

    expect(result.model).toBe("claude-opus-4.8")
  })

  test("does not pass through Anthropic hyphenated version ids", () => {
    const result = translateToOpenAI({
      model: "claude-opus-4-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "x" }],
    })

    expect(result.model).toBe("claude-opus-4.8")
  })

  test("does not pass through bare legacy major-version ids", () => {
    const result = translateToOpenAI({
      model: "claude-opus-4",
      max_tokens: 1,
      messages: [{ role: "user", content: "x" }],
    })

    expect(result.model).toBe("claude-opus-4.8")
  })
})
