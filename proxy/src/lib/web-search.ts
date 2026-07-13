import consola from "consola"

/**
 * Web search integration (webiq / api.microsoft.ai).
 *
 * GitHub Copilot's Claude models have no native server-side web search, so the
 * Anthropic `web_search_20250305` server tool would normally be forwarded as a
 * plain client-side function tool (the model just emits a `tool_use` and stops).
 *
 * This module lets the proxy execute those searches itself, so from the
 * client's perspective the model appears to natively support web search
 * (single request in → answer grounded in live web results out).
 */

const DEFAULT_SEARCH_URL = "https://api.microsoft.ai/v3/search/web"
const DEFAULT_MAX_RESULTS = 5
const SEARCH_TIMEOUT_MS = 20_000

export interface WebSearchResult {
  title: string
  url: string
  /** Plain-text snippet / page excerpt returned by the provider. */
  content: string
  /** Freshness hint (provider `lastUpdatedAt`), surfaced as Anthropic `page_age`. */
  pageAge?: string
}

interface WebiqResponse {
  webResults?: Array<{
    title?: string
    url?: string
    content?: string
    lastUpdatedAt?: string
  }>
}

export function isWebSearchConfigured(): boolean {
  return Boolean(process.env.WEBIQ_X_APIKEY)
}

function searchUrl(): string {
  return process.env.WEBIQ_SEARCH_URL || DEFAULT_SEARCH_URL
}

function defaultMaxResults(): number {
  const raw = Number(process.env.WEBIQ_MAX_RESULTS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_RESULTS
}

/**
 * Execute a single web search against the configured provider.
 * Returns a normalized result list; throws on transport/HTTP errors so the
 * caller can surface a tool error to the model.
 */
export async function executeWebSearch(
  query: string,
  options?: { maxResults?: number },
): Promise<Array<WebSearchResult>> {
  const apiKey = process.env.WEBIQ_X_APIKEY
  if (!apiKey) throw new Error("Web search not configured (WEBIQ_X_APIKEY)")

  const maxResults = options?.maxResults ?? defaultMaxResults()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)

  try {
    const response = await fetch(searchUrl(), {
      method: "POST",
      headers: {
        "x-apikey": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query,
        maxResults,
        contentFormat: "text",
        maxLength: 2000,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(
        `Web search failed: ${response.status} ${response.statusText} ${body.slice(0, 200)}`,
      )
    }

    const data = (await response.json()) as WebiqResponse
    const results = (data.webResults ?? [])
      .filter((r) => r.url)
      .slice(0, maxResults)
      .map<WebSearchResult>((r) => ({
        title: r.title ?? r.url ?? "",
        url: r.url ?? "",
        content: (r.content ?? "").trim(),
        pageAge: r.lastUpdatedAt,
      }))

    consola.info(
      `[web-search] "${query.slice(0, 80)}" → ${results.length} results`,
    )
    return results
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Render results as plain text to feed back to the model as a tool result.
 * The model reads these to compose its grounded answer.
 */
export function formatResultsForModel(
  results: Array<WebSearchResult>,
): string {
  if (results.length === 0) return "No results found."
  return results
    .map((r, i) => {
      const age = r.pageAge ? ` (updated ${r.pageAge})` : ""
      return `[${i + 1}] ${r.title}${age}\n${r.url}\n${r.content}`.trim()
    })
    .join("\n\n")
}
