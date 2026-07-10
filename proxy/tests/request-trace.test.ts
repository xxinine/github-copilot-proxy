import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"

import { clearRequestTraces, requestTraceMiddleware } from "~/lib/request-trace"
import { debugRoutes } from "~/routes/debug/route"

beforeEach(() => {
  clearRequestTraces()
})

afterEach(() => {
  clearRequestTraces()
})

describe("requestTraceMiddleware", () => {
  test("adds request id headers and stores recent request metadata", async () => {
    const app = new Hono()
    app.use(requestTraceMiddleware)
    app.get("/ok", (c) => c.text("ok"))
    app.route("/debug", debugRoutes)

    const response = await app.request("/ok", {
      headers: { "x-client-request-id": "client-123" },
    })
    const debugResponse = await app.request("/debug/requests")
    const debugBody = (await debugResponse.json()) as {
      data: Array<{ id: string; method: string; path: string; status: number }>
    }

    expect(response.headers.get("x-request-id")).toBe("client-123")
    expect(response.headers.get("request-id")).toBe("client-123")
    expect(debugBody.data[0]).toMatchObject({
      id: "client-123",
      method: "GET",
      path: "/ok",
      status: 200,
    })
  })

  test("keeps only the most recent request traces", async () => {
    const app = new Hono()
    app.use(requestTraceMiddleware)
    app.get("/ok", (c) => c.text("ok"))
    app.route("/debug", debugRoutes)

    for (let index = 0; index < 105; index++) {
      await app.request(`/ok?index=${index}`, {
        headers: { "x-client-request-id": `request-${index}` },
      })
    }

    const debugResponse = await app.request("/debug/requests")
    const debugBody = (await debugResponse.json()) as {
      data: Array<{ id: string }>
    }

    expect(debugBody.data).toHaveLength(100)
    expect(debugBody.data[0].id).toBe("request-104")
    expect(debugBody.data.at(-1)?.id).toBe("request-5")
  })
})
