import { describe, expect, test } from "bun:test"

import {
  fitUnknownModelContext,
  UNKNOWN_MODEL_PAYLOAD_BYTES,
} from "~/lib/context-manager"
import { type ChatCompletionsPayload } from "~/services/copilot/create-chat-completions"

describe("context manager", () => {
  test("conservatively fits unknown custom model aliases", () => {
    const payload: ChatCompletionsPayload = {
      model: "ultracode",
      max_tokens: 100,
      messages: [
        { role: "user", content: "old-1\n" + "x".repeat(900_000) },
        { role: "assistant", content: "old-2\n" + "x".repeat(900_000) },
        { role: "user", content: "old-3\n" + "x".repeat(900_000) },
        { role: "assistant", content: "old-4\n" + "x".repeat(900_000) },
        { role: "user", content: "latest task" },
      ],
    }

    const fitted = fitUnknownModelContext(payload)

    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(
      UNKNOWN_MODEL_PAYLOAD_BYTES,
    )
    expect(fitted.messages.at(-1)?.content).toBe("latest task")
    expect(fitted.messages.length).toBeLessThan(payload.messages.length)
  })
})
