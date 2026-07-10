// Usage metering middleware. Placed right after cpxAuth so it runs inside the
// tenant context (tenantContext holds userId/accountId/apiKeyId). It captures
// token usage at the HTTP response boundary WITHOUT touching the vendored
// translation layer:
//   - non-streaming JSON: clone the response and read `usage`
//   - streaming SSE: tee the body, parse usage from the stream on a side branch
//     while the original bytes flow to the client unchanged
//
// Everything is best-effort: metering never blocks or breaks a request.
import type { MiddlewareHandler } from "hono"

import consola from "consola"

import { tenantContext } from "~/lib/state"

import { insertUsage, type UsageRow } from "./usage"

type EndpointKind = "chat" | "responses" | "messages" | "embeddings"

function endpointKindFor(path: string): EndpointKind | undefined {
  if (path.endsWith("/chat/completions")) return "chat"
  if (path.endsWith("/responses")) return "responses"
  if (path.endsWith("/messages")) return "messages"
  if (path.endsWith("/embeddings")) return "embeddings"
  return undefined
}

interface NormalizedUsage {
  model?: string
  promptTokens?: number
  completionTokens?: number
  cachedTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  costNanoAiu?: number
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/**
 * Pull a normalized usage view out of any single parsed JSON object, tolerating
 * OpenAI chat (`prompt_tokens`), OpenAI responses (`input_tokens`) and Anthropic
 * (`input_tokens` + `cache_read_input_tokens`) shapes, whether the usage sits at
 * `obj.usage`, `obj.message.usage` (Anthropic message_start) or
 * `obj.response.usage` (Responses events).
 */
export function normalizeUsage(
  obj: Record<string, unknown>,
): NormalizedUsage | undefined {
  const message = obj.message as Record<string, unknown> | undefined
  const response = obj.response as Record<string, unknown> | undefined
  const usage = (obj.usage
    ?? message?.usage
    ?? response?.usage) as Record<string, unknown> | undefined

  const model =
    (obj.model as string | undefined)
    ?? (response?.model as string | undefined)
    ?? (message?.model as string | undefined)

  if (!usage) return model ? { model } : undefined

  const promptDetails = usage.prompt_tokens_details as
    | Record<string, unknown>
    | undefined
  const inputDetails = usage.input_tokens_details as
    | Record<string, unknown>
    | undefined
  const completionDetails = usage.completion_tokens_details as
    | Record<string, unknown>
    | undefined
  const outputDetails = usage.output_tokens_details as
    | Record<string, unknown>
    | undefined

  const promptTokens = num(usage.prompt_tokens) ?? num(usage.input_tokens)
  const completionTokens =
    num(usage.completion_tokens) ?? num(usage.output_tokens)
  const cachedTokens =
    num(promptDetails?.cached_tokens)
    ?? num(inputDetails?.cached_tokens)
    ?? num(usage.cache_read_input_tokens)
  const reasoningTokens =
    num(completionDetails?.reasoning_tokens)
    ?? num(outputDetails?.reasoning_tokens)
  const totalTokens =
    num(usage.total_tokens)
    ?? (promptTokens !== undefined || completionTokens !== undefined
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : undefined)

  const copilotUsage = obj.copilot_usage as Record<string, unknown> | undefined
  const costNanoAiu =
    num(copilotUsage?.nano_aiu) ?? num((usage as { nano_aiu?: unknown }).nano_aiu)

  return {
    model,
    promptTokens,
    completionTokens,
    cachedTokens,
    reasoningTokens,
    totalTokens,
    costNanoAiu,
  }
}

/** Merge b into a, preferring defined + larger token counts (they are cumulative). */
export function mergeUsage(a: NormalizedUsage, b: NormalizedUsage): NormalizedUsage {
  const maxDefined = (x?: number, y?: number): number | undefined => {
    if (x === undefined) return y
    if (y === undefined) return x
    return Math.max(x, y)
  }
  return {
    model: a.model ?? b.model,
    promptTokens: maxDefined(a.promptTokens, b.promptTokens),
    completionTokens: maxDefined(a.completionTokens, b.completionTokens),
    cachedTokens: maxDefined(a.cachedTokens, b.cachedTokens),
    reasoningTokens: maxDefined(a.reasoningTokens, b.reasoningTokens),
    totalTokens: maxDefined(a.totalTokens, b.totalTokens),
    costNanoAiu: maxDefined(a.costNanoAiu, b.costNanoAiu),
  }
}

function persist(
  base: Omit<UsageRow, keyof NormalizedUsage | "model">,
  usage: NormalizedUsage | undefined,
): void {
  try {
    insertUsage({
      ...base,
      model: usage?.model,
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
      cachedTokens: usage?.cachedTokens,
      reasoningTokens: usage?.reasoningTokens,
      totalTokens: usage?.totalTokens,
      costNanoAiu: usage?.costNanoAiu,
    })
  } catch (error) {
    consola.debug("Usage metering: persist failed:", error)
  }
}

export const usageMiddleware: MiddlewareHandler = async (c, next) => {
  const kind = endpointKindFor(c.req.path)
  const startedAt = Date.now()

  await next()

  // Only meter model-serving endpoints, and only for resolved tenants.
  if (!kind) return
  const tenant = tenantContext.getStore()
  if (!tenant?.userId || !tenant.accountId) return

  const res = c.res
  const base = {
    userId: tenant.userId,
    accountId: tenant.accountId,
    apiKeyId: tenant.apiKeyId,
    path: c.req.path,
    endpointKind: kind,
    statusCode: res.status,
  }

  const contentType = res.headers.get("content-type") ?? ""
  const isStream = contentType.includes("text/event-stream")

  // Errors: log a lightweight row (no tokens) and return.
  if (res.status >= 400) {
    persist(
      { ...base, stream: isStream, durationMs: Date.now() - startedAt, errorType: "http_error" },
      undefined,
    )
    return
  }

  if (!isStream) {
    // Non-streaming JSON: clone so the client still gets the body.
    if (!res.body || !contentType.includes("application/json")) return
    const clone = res.clone()
    void clone
      .json()
      .then((body: unknown) => {
        const usage =
          body && typeof body === "object"
            ? normalizeUsage(body as Record<string, unknown>)
            : undefined
        persist(
          { ...base, stream: false, durationMs: Date.now() - startedAt },
          usage,
        )
      })
      .catch((error: unknown) => {
        consola.debug("Usage metering: json parse failed:", error)
      })
    return
  }

  // Streaming SSE: tee the body — one branch to the client, one to the parser.
  if (!res.body) return
  const [toClient, toParser] = res.body.tee()
  c.res = new Response(toClient, {
    status: res.status,
    headers: res.headers,
  })

  void (async () => {
    const decoder = new TextDecoder()
    const reader = toParser.getReader()
    let buffer = ""
    let usage: NormalizedUsage = {}
    let ttfbMs: number | undefined
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (ttfbMs === undefined) ttfbMs = Date.now() - startedAt
        buffer += decoder.decode(value, { stream: true })
        let nl = buffer.indexOf("\n")
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          nl = buffer.indexOf("\n")
          if (!line.startsWith("data:")) continue
          const data = line.slice(5).trim()
          if (!data || data === "[DONE]") continue
          try {
            const obj = JSON.parse(data) as Record<string, unknown>
            const partial = normalizeUsage(obj)
            if (partial) usage = mergeUsage(usage, partial)
          } catch {
            // ignore non-JSON SSE payloads
          }
        }
      }
    } catch (error) {
      consola.debug("Usage metering: stream parse failed:", error)
    } finally {
      persist(
        {
          ...base,
          stream: true,
          durationMs: Date.now() - startedAt,
          ttfbMs,
        },
        usage,
      )
    }
  })()
}
