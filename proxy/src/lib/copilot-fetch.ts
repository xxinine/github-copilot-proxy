import consola from "consola"

import { sleep } from "./utils"

const DEFAULT_ATTEMPTS = 3
const RETRY_DELAY_MS = 250
const LARGE_PAYLOAD_CONTEXT_OVERFLOW_BYTES = 2_000_000

export interface CopilotFetchOptions extends RequestInit {
  attempts?: number
  retryDelayMs?: number
}

export async function copilotFetch(
  url: string,
  options: CopilotFetchOptions,
): Promise<Response> {
  const {
    attempts = DEFAULT_ATTEMPTS,
    retryDelayMs = RETRY_DELAY_MS,
    ...init
  } = options
  const bodyLength = typeof init.body === "string" ? init.body.length : 0
  const requestLabel = formatRequestLabel(url, init.method)

  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, init)
      if (!shouldRetryResponse(response, bodyLength) || attempt === attempts) {
        return response
      }

      consola.warn(
        `Copilot ${requestLabel} returned ${response.status}; retrying (${attempt}/${attempts})`,
      )
    } catch (error) {
      lastError = error
      if (
        attempt === attempts
        || isLikelyContextOverflowTimeout(error, bodyLength)
      ) {
        throw error
      }
      consola.warn(
        `Copilot ${requestLabel} failed (${formatErrorMessage(error)}); retrying (${attempt}/${attempts})`,
      )
    }

    await sleep(retryDelayMs * attempt)
  }

  throw lastError instanceof Error ? lastError : (
      new Error("Copilot request failed")
    )
}

function formatRequestLabel(url: string, method: string | undefined): string {
  const verb = method?.toUpperCase() ?? "GET"

  try {
    const parsed = new URL(url)
    return `${verb} ${parsed.pathname}`
  } catch {
    return `${verb} ${url}`
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return "unknown error"
}

function shouldRetryResponse(response: Response, bodyLength: number): boolean {
  if (
    response.status >= 500
    && bodyLength > LARGE_PAYLOAD_CONTEXT_OVERFLOW_BYTES
  ) {
    return false
  }

  return (
    response.status === 408
    || response.status === 409
    || response.status === 425
    || response.status === 429
    || response.status === 499
    || response.status === 500
    || response.status === 502
    || response.status === 503
    || response.status === 504
  )
}

export function isLikelyContextOverflowTimeout(
  error: unknown,
  bodyLength: number,
): boolean {
  return (
    bodyLength > LARGE_PAYLOAD_CONTEXT_OVERFLOW_BYTES
    && error instanceof Error
    && /operation timed out|timed out/i.test(error.message)
  )
}
