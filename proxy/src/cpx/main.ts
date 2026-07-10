#!/usr/bin/env bun
// Multi-tenant entrypoint. Unlike the upstream `start` command, this does NOT
// authenticate a single GitHub account at boot. Instead every request carries a
// cpx- API key that the auth middleware resolves to a tenant's GitHub token
// (see src/cpx/*). Models are cached lazily on first authenticated request.
import consola from "consola"
import { serve, type ServerHandler } from "srvx"

import { ensurePaths } from "~/lib/paths"
import { initProxyFromEnv } from "~/lib/proxy"
import { state } from "~/lib/state"
import { cacheVSCodeVersion } from "~/lib/utils"

import { server } from "~/server"

async function mtStart(): Promise<void> {
  if (process.env.CPX_VERBOSE === "1") {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  if (process.env.CPX_PROXY_ENV === "1") {
    initProxyFromEnv()
  }

  const port = Number.parseInt(
    process.env.CPX_PROXY_PORT || process.env.PORT || "4141",
    10,
  )

  await ensurePaths()
  await cacheVSCodeVersion()

  consola.success(
    `Multi-tenant Copilot proxy listening on http://0.0.0.0:${port}`,
  )
  consola.info(`Account type: ${state.accountType}`)

  serve({
    fetch: server.fetch as ServerHandler,
    port,
    hostname: "0.0.0.0",
    // Copilot upstream can take 10-60s for large requests; disable Bun's
    // default 10s idle timeout so slow streams aren't torn down.
    bun: { idleTimeout: 0 },
  })
}

await mtStart()
