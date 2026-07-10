// Per-tenant Copilot token cache. Each bound GitHub account has its own
// short-lived Copilot token (minted from its GitHub OAuth token). We cache one
// per GitHub token, refresh shortly before expiry, and de-duplicate concurrent
// mint requests. Replaces the upstream's single global `state.copilotToken`.
import { getCopilotToken } from "~/services/github/get-copilot-token"
import { tenantContext } from "~/lib/state"

import { hashApiKey } from "./crypto"

interface CachedToken {
  copilotToken: string
  expiresAtMs: number
}

const cache = new Map<string, CachedToken>()
const inflight = new Map<string, Promise<string>>()

// Refresh a bit early so we never hand out an about-to-expire token.
const EARLY_REFRESH_MS = 60_000

async function mint(githubToken: string): Promise<string> {
  // getCopilotToken() reads state.githubToken via the api-config headers, so we
  // run it inside a tenant scope carrying this account's GitHub token.
  const { token, refresh_in } = await tenantContext.run({ githubToken }, () =>
    getCopilotToken(),
  )
  const ttlMs = Math.max(0, refresh_in * 1000 - EARLY_REFRESH_MS)
  cache.set(githubToken, {
    copilotToken: token,
    expiresAtMs: Date.now() + ttlMs,
  })
  return token
}

/** Return a valid Copilot token for the given GitHub token, minting if needed. */
export async function getTenantCopilotToken(
  githubToken: string,
): Promise<string> {
  const cached = cache.get(githubToken)
  if (cached && cached.expiresAtMs > Date.now()) return cached.copilotToken

  const key = hashApiKey(githubToken)
  const existing = inflight.get(key)
  if (existing) return existing

  const p = mint(githubToken).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/** Drop a cached token (e.g. after an upstream 401) to force a re-mint. */
export function invalidateTenantCopilotToken(githubToken: string): void {
  cache.delete(githubToken)
}
