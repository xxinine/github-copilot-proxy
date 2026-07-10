import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"

import { optionalLocalAuth, parseLocalApiKeys } from "~/lib/local-auth"
import { state } from "~/lib/state"

function createProtectedApp(): Hono {
  const app = new Hono()
  app.use(optionalLocalAuth)
  app.get("/protected", (c) => c.json({ ok: true }))
  app.post("/protected", (c) => c.json({ ok: true }))
  return app
}

beforeEach(() => {
  state.localApiKeys = []
})

afterEach(() => {
  state.localApiKeys = []
})

describe("parseLocalApiKeys", () => {
  test("trims comma-separated API keys", () => {
    expect(parseLocalApiKeys(" alpha, beta ,, gamma ")).toEqual([
      "alpha",
      "beta",
      "gamma",
    ])
  })

  test("returns empty list for missing config", () => {
    expect(parseLocalApiKeys(undefined)).toEqual([])
    expect(parseLocalApiKeys("")).toEqual([])
  })
})

describe("optionalLocalAuth", () => {
  test("allows requests when no local API keys are configured", async () => {
    const app = createProtectedApp()

    const response = await app.request("/protected")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  test("rejects requests without credentials when API keys are configured", async () => {
    state.localApiKeys = ["secret"]
    const app = createProtectedApp()

    const response = await app.request("/protected")

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: {
        message: "Missing or invalid API key",
        type: "authentication_error",
      },
    })
  })

  test("accepts a matching bearer token", async () => {
    state.localApiKeys = ["secret"]
    const app = createProtectedApp()

    const response = await app.request("/protected", {
      headers: { authorization: "Bearer secret" },
    })

    expect(response.status).toBe(200)
  })

  test("accepts a matching x-api-key header", async () => {
    state.localApiKeys = ["secret"]
    const app = createProtectedApp()

    const response = await app.request("/protected", {
      headers: { "x-api-key": "secret" },
    })

    expect(response.status).toBe(200)
  })

  test("rejects non-matching credentials", async () => {
    state.localApiKeys = ["secret"]
    const app = createProtectedApp()

    const response = await app.request("/protected", {
      headers: { authorization: "Bearer wrong" },
    })

    expect(response.status).toBe(401)
  })

  test("allows preflight requests when API keys are configured", async () => {
    state.localApiKeys = ["secret"]
    const app = createProtectedApp()

    const response = await app.request("/protected", { method: "OPTIONS" })

    expect(response.status).not.toBe(401)
  })
})
