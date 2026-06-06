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
      path TEXT NOT NULL,
      model TEXT,
      status_code INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_logs(user_id);
  `);

  // Backfill: add users.status to databases created before this column existed.
  const cols = d.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'status')) {
    d.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  }
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
export function logUsage(
  userId: number,
  accountId: number,
  path: string,
  model: string | null,
  statusCode: number | null
): void {
  getDb()
    .prepare(
      'INSERT INTO usage_logs (user_id, account_id, path, model, status_code) VALUES (?, ?, ?, ?, ?)'
    )
    .run(userId, accountId, path, model, statusCode);
}
