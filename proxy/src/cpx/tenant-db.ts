// Read-only access to the shared control-plane SQLite DB, used to resolve an
// incoming cpx- API key to the tenant's (decrypted) GitHub token. Uses Bun's
// built-in sqlite so the proxy stays free of the native better-sqlite3 addon.
import { Database } from "bun:sqlite"

import { decryptSecret, hashApiKey } from "./crypto"

function dbPath(): string {
  return process.env.CPX_DB_PATH || "/app/data/cpx.db"
}

let db: Database | undefined
function getDb(): Database {
  if (!db) {
    db = new Database(dbPath(), { readonly: true })
    db.exec("PRAGMA busy_timeout = 3000;")
  }
  return db
}

export type TenantResolution =
  | { ok: true; githubToken: string; userId: number; accountId: number }
  | { ok: false; status: 401 | 403; message: string; type: string }

interface KeyRow {
  user_id: number
  user_status: string
  account_id: number | null
  gh_token_enc: string | null
  account_status: string | null
}

/**
 * Resolve a cpx- API key to the owning tenant's GitHub token.
 * Errors mirror the previous gateway's contract (401 auth, 403 unbound/disabled).
 */
export function resolveTenant(apiKey: string): TenantResolution {
  const row = getDb()
    .query<KeyRow, [string]>(
      `SELECT k.user_id        AS user_id,
              u.status         AS user_status,
              a.id             AS account_id,
              a.gh_token_enc   AS gh_token_enc,
              a.status         AS account_status
         FROM api_keys k
         JOIN users u    ON u.id = k.user_id
         LEFT JOIN accounts a ON a.user_id = k.user_id
        WHERE k.key_hash = ? AND k.status = 'active'
        LIMIT 1`,
    )
    .get(hashApiKey(apiKey))

  if (!row) {
    return {
      ok: false,
      status: 401,
      message: "invalid API key",
      type: "authentication_error",
    }
  }
  if (row.user_status === "disabled") {
    return {
      ok: false,
      status: 403,
      message: "account is disabled",
      type: "account_disabled",
    }
  }
  if (!row.account_id || !row.gh_token_enc) {
    return {
      ok: false,
      status: 403,
      message: "no Copilot account bound to this key",
      type: "account_unbound",
    }
  }

  let githubToken: string
  try {
    githubToken = decryptSecret(row.gh_token_enc)
  } catch {
    return {
      ok: false,
      status: 403,
      message: "account token could not be decrypted",
      type: "account_error",
    }
  }

  return {
    ok: true,
    githubToken,
    userId: row.user_id,
    accountId: row.account_id,
  }
}
