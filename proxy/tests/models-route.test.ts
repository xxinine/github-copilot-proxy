import { afterEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"

import type { ModelsResponse } from "~/services/copilot/get-models"

import { state } from "~/lib/state"
import { modelRoutes } from "~/routes/models/route"

afterEach(() => {
  state.models = undefined
})

function createApp(): Hono {
  const app = new Hono()
  app.route("/v1/models", modelRoutes)
  return app
}

describe("models route", () => {
  test("advertises Claude Code effort and thinking capabilities", async () => {
    state.models = {
      object: "list",
      data: [
        {
          id: "claude-opus-4.8",
          object: "model",
          name: "Claude Opus 4.8",
          model_picker_enabled: true,
          preview: false,
          vendor: "anthropic",
          version: "1",
          supported_endpoints: ["/chat/completions"],
          capabilities: {
            family: "claude-opus-4.8",
            limits: {},
            object: "model_capabilities",
            supports: {
              adaptive_thinking: true,
              reasoning_effort: ["low", "medium", "high", "xhigh", "max"],
            },
            tokenizer: "cl100k_base",
            type: "chat",
          },
        },
      ],
    } satisfies ModelsResponse

    const response = await createApp().request("/v1/models")
    const body = (await response.json()) as {
      data: Array<{
        capabilities: unknown
        supported_capabilities: Array<string>
      }>
    }

    expect(response.status).toBe(200)
    expect(body.data[0].capabilities).toEqual(state.models.data[0].capabilities)
    expect(body.data[0].supported_capabilities).toEqual([
      "effort",
      "xhigh_effort",
      "max_effort",
      "thinking",
      "adaptive_thinking",
      "interleaved_thinking",
    ])
  })
})
