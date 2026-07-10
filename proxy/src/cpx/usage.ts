// Dedicated WRITE connection to the shared SQLite DB for usage metering.
// Kept separate from tenant-db.ts (which is strictly read-only): SQLite WAL
// mode — enabled by the control-plane on the same file — supports concurrent
// readers plus a single writer across processes, so the proxy can INSERT usage
// rows without a native better-sqlite3 addon.
//
// The canonical usage_logs schema (and its migrations) lives in the
// control-plane (shared/src/db.ts). Here we only INSERT; if a metering column
// is missing because the control-plane hasn't migrated yet, the insert fails
// and is logged once, never blocking the request path.
import { Database } from "bun:sqlite"

import consola from "consola"

function dbPath(): string {
  return process.env.CPX_DB_PATH || "/app/data/cpx.db"
}

let writeDb: Database | undefined
let schemaWarned = false

function getWriteDb(): Database | undefined {
  if (writeDb) return writeDb
  try {
    const db = new Database(dbPath(), { readwrite: true, create: true })
    db.exec("PRAGMA busy_timeout = 3000;")
    db.exec("PRAGMA journal_mode = WAL;")
    writeDb = db
    return writeDb
  } catch (error) {
    if (!schemaWarned) {
      consola.warn("Usage metering: cannot open write DB:", error)
      schemaWarned = true
    }
    return undefined
  }
}

export interface UsageRow {
  userId: number
  accountId: number
  apiKeyId?: number
  path: string
  endpointKind?: string
  model?: string
  statusCode?: number
  stream?: boolean
  promptTokens?: number
  completionTokens?: number
  cachedTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  costNanoAiu?: number
  durationMs?: number
  ttfbMs?: number
  errorType?: string
}

const COLUMNS = [
  "user_id",
  "account_id",
  "api_key_id",
  "path",
  "endpoint_kind",
  "model",
  "status_code",
  "stream",
  "prompt_tokens",
  "completion_tokens",
  "cached_tokens",
  "reasoning_tokens",
  "total_tokens",
  "cost_nano_aiu",
  "duration_ms",
  "ttfb_ms",
  "error_type",
] as const

const INSERT_SQL = `INSERT INTO usage_logs (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`

/**
 * Persist one usage row. Best-effort and synchronous-but-cheap (single INSERT);
 * callers should invoke it off the response hot path. Never throws.
 */
export function insertUsage(row: UsageRow): void {
  const db = getWriteDb()
  if (!db) return
  try {
    db.query(INSERT_SQL).run(
      row.userId,
      row.accountId,
      row.apiKeyId ?? null,
      row.path,
      row.endpointKind ?? null,
      row.model ?? null,
      row.statusCode ?? null,
      row.stream ? 1 : 0,
      row.promptTokens ?? null,
      row.completionTokens ?? null,
      row.cachedTokens ?? null,
      row.reasoningTokens ?? null,
      row.totalTokens ?? null,
      row.costNanoAiu ?? null,
      row.durationMs ?? null,
      row.ttfbMs ?? null,
      row.errorType ?? null,
    )
  } catch (error) {
    if (!schemaWarned) {
      consola.warn(
        "Usage metering: insert failed (control-plane migration pending?):",
        error,
      )
      schemaWarned = true
    }
  }
}
