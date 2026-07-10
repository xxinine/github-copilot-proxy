import type { MiddlewareHandler } from "hono"

import consola from "consola"

import { tenantContext } from "~/lib/state"

import { resolveTenant } from "./tenant-db"
import {
  getTenantCopilotToken,
  invalidateTenantCopilotToken,
} from "./tenant-tokens"

function extractKey(c: {
  req: { header: (n: string) => string | undefined }
}): string | undefined {
  const auth = c.req.header("authorization")
  if (auth) {
    const m = /^bearer\s+(.+)$/i.exec(auth.trim())
    if (m && m[1].trim()) return m[1].trim()
  }
  const x = c.req.header("x-api-key")?.trim()
  return x && x.length > 0 ? x : undefined
}

function fail(
  c: Parameters<MiddlewareHandler>[0],
  status: 401 | 403,
  message: string,
  type: string,
) {
  return c.json({ error: { message, type } }, status)
}

/**
 * Multi-tenant auth. Resolves the caller's cpx- key to a GitHub token, mints
 * (or reuses) that account's Copilot token, and runs the downstream handler
 * inside a tenant context so every state.githubToken / state.copilotToken read
 * in the vendored code resolves to this tenant.
 */
export const cpxAuth: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "OPTIONS") return next()

  const key = extractKey(c)
  if (!key) {
    return fail(c, 401, "missing API key", "authentication_error")
  }

  const tenant = resolveTenant(key)
  if (!tenant.ok) {
    return fail(c, tenant.status, tenant.message, tenant.type)
  }

  let copilotToken: string
  try {
    copilotToken = await getTenantCopilotToken(tenant.githubToken)
  } catch (error) {
    invalidateTenantCopilotToken(tenant.githubToken)
    consola.error("Failed to mint Copilot token for tenant:", error)
    return fail(
      c,
      403,
      "account is not ready (GitHub Copilot may be logged out)",
      "account_not_ready",
    )
  }

  return tenantContext.run(
    { githubToken: tenant.githubToken, copilotToken },
    () => next(),
  )
}
