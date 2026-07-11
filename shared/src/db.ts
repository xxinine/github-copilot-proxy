import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Account, ApiKey, User } from './types.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const path = process.env.CPX_DB_PATH || './data/cpx.db';
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_hash TEXT UNIQUE NOT NULL,
      key_prefix TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      gh_token_enc TEXT NOT NULL,
      gh_login TEXT,
      container_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      api_key_id INTEGER,
      path TEXT NOT NULL,
      endpoint_kind TEXT,
      model TEXT,
      status_code INTEGER,
      stream INTEGER NOT NULL DEFAULT 0,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      cached_tokens INTEGER,
      cache_write_tokens INTEGER,
      reasoning_tokens INTEGER,
      total_tokens INTEGER,
      cost_nano_aiu INTEGER,
      duration_ms INTEGER,
      ttfb_ms INTEGER,
      error_type TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_user_ts ON usage_logs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_logs(model);
  `);

  // Backfill: add users.status to databases created before this column existed.
  const userCols = d.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!userCols.some((c) => c.name === 'status')) {
    d.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  }

  // Backfill: add usage_logs metering columns to databases created before they
  // existed. The proxy writes these; keep the canonical schema here as the
  // single source of truth.
  const usageCols = new Set(
    (d.prepare("PRAGMA table_info(usage_logs)").all() as Array<{ name: string }>).map(
      (c) => c.name
    )
  );
  const usageAdditions: Array<[string, string]> = [
    ['api_key_id', 'INTEGER'],
    ['endpoint_kind', 'TEXT'],
    ['stream', 'INTEGER NOT NULL DEFAULT 0'],
    ['prompt_tokens', 'INTEGER'],
    ['completion_tokens', 'INTEGER'],
    ['cached_tokens', 'INTEGER'],
    ['cache_write_tokens', 'INTEGER'],
    ['reasoning_tokens', 'INTEGER'],
    ['total_tokens', 'INTEGER'],
    ['cost_nano_aiu', 'INTEGER'],
    ['duration_ms', 'INTEGER'],
    ['ttfb_ms', 'INTEGER'],
    ['error_type', 'TEXT'],
  ];
  for (const [name, type] of usageAdditions) {
    if (!usageCols.has(name)) {
      d.exec(`ALTER TABLE usage_logs ADD COLUMN ${name} ${type}`);
    }
  }
  d.exec(`
    CREATE INDEX IF NOT EXISTS idx_usage_user_ts ON usage_logs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_logs(model);
  `);
}

// --- users ---
export function getUserByName(username: string): User | undefined {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
}

export function getUserById(id: number): User | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
}

export function listUsers(): User[] {
  return getDb().prepare('SELECT * FROM users ORDER BY id').all() as User[];
}

export function createUser(username: string, passwordHash: string, isAdmin = false): User {
  const info = getDb()
    .prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)')
    .run(username, passwordHash, isAdmin ? 1 : 0);
  return getUserById(Number(info.lastInsertRowid))!;
}

export function setUserStatus(id: number, status: User['status']): void {
  getDb().prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
}

export function deleteUser(id: number): void {
  // api_keys and accounts cascade via ON DELETE CASCADE.
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
}

// --- api keys ---
export function listApiKeys(userId: number): ApiKey[] {
  return getDb()
    .prepare('SELECT * FROM api_keys WHERE user_id = ? ORDER BY id DESC')
    .all(userId) as ApiKey[];
}

export function createApiKey(userId: number, keyHash: string, prefix: string, name: string): void {
  getDb()
    .prepare('INSERT INTO api_keys (user_id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?)')
    .run(userId, keyHash, prefix, name);
}

export function revokeApiKey(id: number, userId: number): void {
  getDb()
    .prepare("UPDATE api_keys SET status = 'revoked' WHERE id = ? AND user_id = ?")
    .run(id, userId);
}

/** Permanently delete a single key, but only if it is already revoked. */
export function deleteRevokedApiKey(id: number, userId: number): void {
  getDb()
    .prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ? AND status = 'revoked'")
    .run(id, userId);
}

/** Permanently delete all of a user's revoked keys. Returns the number removed. */
export function deleteRevokedApiKeys(userId: number): number {
  const info = getDb()
    .prepare("DELETE FROM api_keys WHERE user_id = ? AND status = 'revoked'")
    .run(userId);
  return info.changes;
}

export function findActiveKeyByHash(keyHash: string): ApiKey | undefined {
  return getDb()
    .prepare("SELECT * FROM api_keys WHERE key_hash = ? AND status = 'active'")
    .get(keyHash) as ApiKey | undefined;
}

// --- accounts ---
export function getAccountByUser(userId: number): Account | undefined {
  return getDb().prepare('SELECT * FROM accounts WHERE user_id = ?').get(userId) as Account | undefined;
}

export function getAccountById(id: number): Account | undefined {
  return getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Account | undefined;
}

export function listAccounts(): Account[] {
  return getDb().prepare('SELECT * FROM accounts ORDER BY id').all() as Account[];
}

export function upsertAccount(
  userId: number,
  tokenEnc: string,
  ghLogin: string | null,
  containerName: string
): Account {
  const existing = getAccountByUser(userId);
  if (existing) {
    getDb()
      .prepare(
        "UPDATE accounts SET gh_token_enc = ?, gh_login = ?, container_name = ?, status = 'pending', last_error = NULL WHERE user_id = ?"
      )
      .run(tokenEnc, ghLogin, containerName, userId);
  } else {
    getDb()
      .prepare(
        'INSERT INTO accounts (user_id, gh_token_enc, gh_login, container_name) VALUES (?, ?, ?, ?)'
      )
      .run(userId, tokenEnc, ghLogin, containerName);
  }
  return getAccountByUser(userId)!;
}

export function setAccountStatus(id: number, status: Account['status'], error?: string): void {
  getDb()
    .prepare('UPDATE accounts SET status = ?, last_error = ? WHERE id = ?')
    .run(status, error ?? null, id);
}

export function deleteAccount(userId: number): void {
  getDb().prepare('DELETE FROM accounts WHERE user_id = ?').run(userId);
}

// --- usage ---
export interface UsageInsert {
  user_id: number;
  account_id: number;
  api_key_id?: number | null;
  path: string;
  endpoint_kind?: string | null;
  model?: string | null;
  status_code?: number | null;
  stream?: boolean;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  cached_tokens?: number | null;
  cache_write_tokens?: number | null;
  reasoning_tokens?: number | null;
  total_tokens?: number | null;
  cost_nano_aiu?: number | null;
  duration_ms?: number | null;
  ttfb_ms?: number | null;
  error_type?: string | null;
}

export function logUsage(entry: UsageInsert): void {
  getDb()
    .prepare(
      `INSERT INTO usage_logs (
        user_id, account_id, api_key_id, path, endpoint_kind, model, status_code,
        stream, prompt_tokens, completion_tokens, cached_tokens, cache_write_tokens,
        reasoning_tokens, total_tokens, cost_nano_aiu, duration_ms, ttfb_ms, error_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.user_id,
      entry.account_id,
      entry.api_key_id ?? null,
      entry.path,
      entry.endpoint_kind ?? null,
      entry.model ?? null,
      entry.status_code ?? null,
      entry.stream ? 1 : 0,
      entry.prompt_tokens ?? null,
      entry.completion_tokens ?? null,
      entry.cached_tokens ?? null,
      entry.cache_write_tokens ?? null,
      entry.reasoning_tokens ?? null,
      entry.total_tokens ?? null,
      entry.cost_nano_aiu ?? null,
      entry.duration_ms ?? null,
      entry.ttfb_ms ?? null,
      entry.error_type ?? null
    );
}

// --- usage aggregation (Phase 2 dashboards) ---
export interface UsageSummary {
  requests: number;
  errors: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  cost_nano_aiu: number;
}

export interface UsageDay {
  day: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
}

export interface UsageByModel {
  model: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
}

export interface UsageByUser {
  user_id: number;
  username: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  cost_nano_aiu: number;
}

export interface RecentUsage {
  id: number;
  created_at: string;
  endpoint_kind: string | null;
  model: string | null;
  status_code: number | null;
  stream: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cached_tokens: number | null;
  cache_write_tokens: number | null;
  total_tokens: number | null;
  duration_ms: number | null;
}

// Window helper: only whole positive day counts are interpolated into SQL, so
// there is no injection surface (value is coerced to an integer). `col` lets
// callers qualify the column (e.g. `l.created_at`) in joined queries where
// `created_at` would otherwise be ambiguous.
function sinceClause(sinceDays: number, col = 'created_at'): string {
  const n = Math.max(1, Math.floor(sinceDays));
  return `${col} >= datetime('now', '-${n} days')`;
}

export function usageSummary(userId: number | null, sinceDays = 30): UsageSummary {
  const where = userId == null ? sinceClause(sinceDays) : `user_id = ? AND ${sinceClause(sinceDays)}`;
  const params = userId == null ? [] : [userId];
  return getDb()
    .prepare(
      `SELECT
         COUNT(*)                                            AS requests,
         COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) AS errors,
         COALESCE(SUM(prompt_tokens), 0)                     AS prompt_tokens,
         COALESCE(SUM(completion_tokens), 0)                 AS completion_tokens,
         COALESCE(SUM(cached_tokens), 0)                     AS cached_tokens,
         COALESCE(SUM(cache_write_tokens), 0)                AS cache_write_tokens,
         COALESCE(SUM(total_tokens), 0)                      AS total_tokens,
         COALESCE(SUM(cost_nano_aiu), 0)                     AS cost_nano_aiu
       FROM usage_logs WHERE ${where}`
    )
    .get(...params) as UsageSummary;
}

export function usageTimeseries(userId: number | null, sinceDays = 30): UsageDay[] {
  const where = userId == null ? sinceClause(sinceDays) : `user_id = ? AND ${sinceClause(sinceDays)}`;
  const params = userId == null ? [] : [userId];
  const rows = getDb()
    .prepare(
      `SELECT
         substr(created_at, 1, 10)            AS day,
         COUNT(*)                             AS requests,
         COALESCE(SUM(prompt_tokens), 0)      AS prompt_tokens,
         COALESCE(SUM(completion_tokens), 0)  AS completion_tokens,
         COALESCE(SUM(cached_tokens), 0)      AS cached_tokens,
         COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
         COALESCE(SUM(total_tokens), 0)       AS total_tokens
       FROM usage_logs WHERE ${where}
       GROUP BY day ORDER BY day`
    )
    .all(...params) as UsageDay[];

  // Zero-fill the full window so charts/tables always show every day (UTC),
  // matching the ?days=7|30|90 selector even when most days have no traffic.
  const n = Math.max(1, Math.floor(sinceDays));
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: UsageDay[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)
    );
    const day = d.toISOString().slice(0, 10);
    out.push(
      byDay.get(day) ?? {
        day,
        requests: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        cached_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 0,
      }
    );
  }
  return out;
}

export function usageByModel(userId: number | null, sinceDays = 30): UsageByModel[] {
  const where = userId == null ? sinceClause(sinceDays) : `user_id = ? AND ${sinceClause(sinceDays)}`;
  const params = userId == null ? [] : [userId];
  return getDb()
    .prepare(
      `SELECT
         COALESCE(model, '(unknown)')         AS model,
         COUNT(*)                             AS requests,
         COALESCE(SUM(prompt_tokens), 0)      AS prompt_tokens,
         COALESCE(SUM(completion_tokens), 0)  AS completion_tokens,
         COALESCE(SUM(cached_tokens), 0)      AS cached_tokens,
         COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
         COALESCE(SUM(total_tokens), 0)       AS total_tokens
       FROM usage_logs WHERE ${where}
       GROUP BY model ORDER BY total_tokens DESC, requests DESC`
    )
    .all(...params) as UsageByModel[];
}

export function usageByUser(sinceDays = 30): UsageByUser[] {
  return getDb()
    .prepare(
      `SELECT
         l.user_id                            AS user_id,
         COALESCE(u.username, '(deleted)')    AS username,
         COUNT(*)                             AS requests,
         COALESCE(SUM(l.prompt_tokens), 0)    AS prompt_tokens,
         COALESCE(SUM(l.completion_tokens), 0) AS completion_tokens,
         COALESCE(SUM(l.cached_tokens), 0)    AS cached_tokens,
         COALESCE(SUM(l.cache_write_tokens), 0) AS cache_write_tokens,
         COALESCE(SUM(l.total_tokens), 0)     AS total_tokens,
         COALESCE(SUM(l.cost_nano_aiu), 0)    AS cost_nano_aiu
       FROM usage_logs l
       LEFT JOIN users u ON u.id = l.user_id
       WHERE ${sinceClause(sinceDays, 'l.created_at')}
       GROUP BY l.user_id ORDER BY total_tokens DESC, requests DESC`
    )
    .all() as UsageByUser[];
}

export function recentUsage(userId: number | null, limit = 50): RecentUsage[] {
  const n = Math.max(1, Math.min(500, Math.floor(limit)));
  const where = userId == null ? '1=1' : 'user_id = ?';
  const params = userId == null ? [] : [userId];
  return getDb()
    .prepare(
      `SELECT id, created_at, endpoint_kind, model, status_code, stream,
              prompt_tokens, completion_tokens, cached_tokens, cache_write_tokens,
              total_tokens, duration_ms
       FROM usage_logs WHERE ${where}
       ORDER BY id DESC LIMIT ${n}`
    )
    .all(...params) as RecentUsage[];
}
