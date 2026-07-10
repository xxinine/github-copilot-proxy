import { AsyncLocalStorage } from "node:async_hooks"

import type { ModelsResponse } from "~/services/copilot/get-models"

export interface State {
  githubToken?: string
  copilotToken?: string

  accountType: string
  models?: ModelsResponse
  vsCodeVersion?: string

  manualApprove: boolean
  rateLimitWait: boolean
  showToken: boolean
  localApiKeys: Array<string>

  // Rate limiting configuration
  rateLimitSeconds?: number
  lastRequestTimestamp?: number
}

/**
 * Per-request tenant override. In the multi-tenant fork there is no single
 * global GitHub/Copilot token: the auth middleware resolves the caller's
 * cpx- API key to their GitHub token, mints (or reuses) that account's Copilot
 * token, and runs the downstream handler inside `tenantContext.run(...)`.
 *
 * The exported `state` below is a Proxy: reads of `githubToken` / `copilotToken`
 * / `accountType` transparently return the current tenant's values when a
 * request is in flight, and fall back to the shared base state otherwise. This
 * keeps every existing `state.copilotToken` read across the vendored codebase
 * tenant-aware without touching the translation layer.
 */
export interface TenantOverride {
  githubToken?: string
  copilotToken?: string
  accountType?: string
}

export const tenantContext = new AsyncLocalStorage<TenantOverride>()

const baseState: State = {
  accountType: "individual",
  manualApprove: false,
  rateLimitWait: false,
  showToken: false,
  localApiKeys: [],
}

const TENANT_KEYS = new Set<PropertyKey>([
  "githubToken",
  "copilotToken",
  "accountType",
])

export const state: State = new Proxy(baseState, {
  get(target, prop, receiver) {
    if (TENANT_KEYS.has(prop)) {
      const override = tenantContext.getStore()
      if (override) {
        const value = override[prop as keyof TenantOverride]
        if (value !== undefined) return value
      }
    }
    return Reflect.get(target, prop, receiver)
  },
})
