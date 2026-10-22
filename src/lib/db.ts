import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config";

/**
 * SQLite is shared by the Next.js server and the render worker (separate
 * processes). WAL mode lets the UI read while the worker writes.
 * All SQL lives in this module and the repositories that import it, so a
 * later move to PostgreSQL only touches the data layer.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  job_id TEXT,
  version_id TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('upload','output')),
  media_type TEXT NOT NULL CHECK (media_type IN ('video','image')),
  original_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  thumb_key TEXT,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  duration REAL,
  width INTEGER,
  height INTEGER,
  has_audio INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_conv ON assets(conversation_id);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_version_id TEXT,
  spec TEXT NOT NULL,
  plan_info TEXT NOT NULL DEFAULT '{}',
  timeline TEXT,
  state TEXT NOT NULL,
  stages TEXT NOT NULL,
  error TEXT,
  output_version_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  heartbeat_at INTEGER,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_conv ON jobs(conversation_id, updated_at);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  parent_version_id TEXT,
  number INTEGER NOT NULL,
  asset_id TEXT NOT NULL,
  spec TEXT NOT NULL,
  duration REAL NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_conv ON versions(conversation_id, number);

CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  conversation_id TEXT,
  render_ms INTEGER NOT NULL,
  cpu_ms INTEGER,
  input_bytes INTEGER NOT NULL,
  output_bytes INTEGER NOT NULL,
  output_seconds REAL NOT NULL,
  external_ai_calls INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL,
  succeeded INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

type GlobalWithDb = typeof globalThis & { __januxDb?: Database.Database; __januxDbPath?: string };

export function getDb(): Database.Database {
  const g = globalThis as GlobalWithDb;
  const { dbPath } = getConfig();
  if (g.__januxDb && g.__januxDbPath === dbPath) return g.__januxDb;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  g.__januxDb = db;
  g.__januxDbPath = dbPath;
  return db;
}

/** Used by tests to point at a fresh data directory. */
export function closeDb() {
  const g = globalThis as GlobalWithDb;
  g.__januxDb?.close();
  g.__januxDb = undefined;
  g.__januxDbPath = undefined;
}

export function now() {
  return Date.now();
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
