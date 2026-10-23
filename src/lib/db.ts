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
  media_type TEXT NOT NULL CHECK (media_type IN ('video','image','audio')),
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

CREATE TABLE IF NOT EXISTS brand_kit (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- My Kit: fonts, LUTs, logos, overlays, sounds and saved styles the user imports.
CREATE TABLE IF NOT EXISTS kit_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  file TEXT,
  notes TEXT NOT NULL DEFAULT '',
  credit TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  size INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  state TEXT NOT NULL,
  provider TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_state ON agent_runs(state, created_at);
`;

/**
 * Additive migrations for databases created by earlier versions. Each step
 * is idempotent so it is safe to run on every start.
 */
function migrate(db: Database.Database) {
  const cols = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  if (!cols("messages").includes("updated_at")) {
    db.exec("ALTER TABLE messages ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0; UPDATE messages SET updated_at = created_at;");
  }
  if (!cols("agent_runs").includes("pid")) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN pid INTEGER");
  }
  if (!cols("jobs").includes("kind")) {
    db.exec("ALTER TABLE jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'edit'");
  }
  // v1 assets only allowed video/image; rebuild the table to allow audio.
  const assetsSql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'assets'").get() as { sql: string } | undefined)?.sql ?? "";
  if (assetsSql && !assetsSql.includes("'audio'")) {
    db.pragma("foreign_keys = OFF");
    db.transaction(() => {
      db.exec("ALTER TABLE assets RENAME TO assets_v1");
      db.exec(SCHEMA.slice(SCHEMA.indexOf("CREATE TABLE IF NOT EXISTS assets"), SCHEMA.indexOf("CREATE INDEX IF NOT EXISTS idx_assets_conv")));
      db.exec("INSERT INTO assets SELECT * FROM assets_v1; DROP TABLE assets_v1;");
      db.exec("CREATE INDEX IF NOT EXISTS idx_assets_conv ON assets(conversation_id)");
    })();
    db.pragma("foreign_keys = ON");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_updated ON messages(conversation_id, updated_at)");
}

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
  migrate(db);
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
