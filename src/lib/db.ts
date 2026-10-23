import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config";

/**
 * One async data layer, two engines:
 * - SQLite (default, local development): a file under the data directory,
 *   shared by the web server and the worker through WAL mode.
 * - PostgreSQL (production, e.g. AWS RDS): set DATABASE_URL=postgres://...
 *   Tests can use an embedded Postgres with DATABASE_URL=pglite://memory.
 * Queries are written once with `?` placeholders and portable SQL.
 */

export type Row = Record<string, unknown>;

export interface Queryable {
  get<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
}

export interface Db extends Queryable {
  dialect: "sqlite" | "postgres";
  /** Runs `fn` in a transaction that serialises with other writers (SQLite IMMEDIATE / Postgres row locks). */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

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

/** Columns added after the first release, applied to both engines. */
const ADDED_COLUMNS: { table: string; column: string; type: string; backfill?: string }[] = [
  { table: "messages", column: "updated_at", type: "INTEGER NOT NULL DEFAULT 0", backfill: "UPDATE messages SET updated_at = created_at" },
  { table: "agent_runs", column: "pid", type: "INTEGER" },
  { table: "jobs", column: "kind", type: "TEXT NOT NULL DEFAULT 'edit'" },
];
const LATE_INDEXES = ["CREATE INDEX IF NOT EXISTS idx_messages_updated ON messages(conversation_id, updated_at)"];

// ---- SQLite -------------------------------------------------------------

type SqliteDatabase = import("better-sqlite3").Database;

function migrateSqlite(db: SqliteDatabase) {
  db.exec(SCHEMA);
  const cols = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  for (const c of ADDED_COLUMNS) {
    if (!cols(c.table).includes(c.column)) {
      db.exec(`ALTER TABLE ${c.table} ADD COLUMN ${c.column} ${c.type}`);
      if (c.backfill) db.exec(c.backfill);
    }
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
  for (const sql of LATE_INDEXES) db.exec(sql);
}

function sqliteDb(dbPath: string): Db {
  // Loaded lazily so a Postgres deployment never needs the native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  migrateSqlite(db);

  // better-sqlite3 is synchronous; a transaction spanning awaits must keep
  // other async callers in this process off the connection until it ends.
  let lock: Promise<unknown> = Promise.resolve();
  let inTx = false;
  const raw: Queryable = {
    async get<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).get(...(params as never[])) as T | undefined;
    },
    async all<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
    async run(sql: string, params: unknown[] = []) {
      return { changes: db.prepare(sql).run(...(params as never[])).changes };
    },
  };
  const outside = <K extends keyof Queryable>(k: K) =>
    (async (sql: string, params?: unknown[]) => {
      if (inTx) await lock;
      return (raw[k] as (s: string, p?: unknown[]) => Promise<unknown>)(sql, params);
    }) as Queryable[K];
  return {
    dialect: "sqlite",
    get: outside("get"),
    all: outside("all"),
    run: outside("run"),
    async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
      const prev = lock;
      let release!: () => void;
      lock = new Promise<void>((r) => (release = r));
      await prev;
      inTx = true;
      db.exec("BEGIN IMMEDIATE");
      try {
        const out = await fn(raw);
        db.exec("COMMIT");
        return out;
      } catch (err) {
        if (db.inTransaction) db.exec("ROLLBACK");
        throw err;
      } finally {
        inTx = false;
        release();
      }
    },
    async close() {
      db.close();
    },
  };
}

// ---- PostgreSQL ---------------------------------------------------------

/** `?` → `$1, $2, ...`, skipping anything inside quotes. */
export function toPgPlaceholders(sql: string): string {
  let n = 0;
  let out = "";
  let quote: string | null = null;
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === "?") {
      out += `$${++n}`;
    } else out += ch;
  }
  return out;
}

/** Millisecond timestamps overflow 32-bit INTEGER, and REAL is single precision in Postgres. */
export function pgSchema(sql: string): string {
  return sql.replace(/\bINTEGER\b/g, "BIGINT").replace(/\bREAL\b/g, "DOUBLE PRECISION");
}

type PgRunner = (sql: string, params: unknown[]) => Promise<{ rows: Row[]; rowCount: number }>;

function pgQueryable(query: PgRunner): Queryable {
  return {
    async get<T>(sql: string, params: unknown[] = []) {
      return (await query(toPgPlaceholders(sql), params)).rows[0] as T | undefined;
    },
    async all<T>(sql: string, params: unknown[] = []) {
      return (await query(toPgPlaceholders(sql), params)).rows as T[];
    },
    async run(sql: string, params: unknown[] = []) {
      return { changes: (await query(toPgPlaceholders(sql), params)).rowCount };
    },
  };
}

async function migratePg(query: PgRunner) {
  // One process migrates at a time.
  await query("SELECT pg_advisory_lock(727274)", []);
  try {
    for (const stmt of pgSchema(SCHEMA).split(";").map((s) => s.replace(/--.*$/gm, "").trim()).filter(Boolean)) await query(stmt, []);
    for (const c of ADDED_COLUMNS) {
      const exists = (await query("SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2", [c.table, c.column])).rows.length > 0;
      if (exists) continue;
      await query(`ALTER TABLE ${c.table} ADD COLUMN ${c.column} ${pgSchema(c.type)}`, []);
      if (c.backfill) await query(c.backfill, []);
    }
    for (const sql of LATE_INDEXES) await query(sql, []);
  } finally {
    await query("SELECT pg_advisory_unlock(727274)", []);
  }
}

function postgresDb(url: string): Db {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pg = require("pg") as typeof import("pg");
  const types = {
    getTypeParser: ((oid: number, format?: string) => {
      // BIGINT (20) and NUMERIC (1700) arrive as strings; our values fit in a JS number.
      if (oid === 20 || oid === 1700) return (v: string) => Number(v);
      return pg.types.getTypeParser(oid, format as "text");
    }) as typeof pg.types.getTypeParser,
  };
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    ssl: /sslmode=(require|verify)/.test(url) || process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== "true" } : undefined,
    types,
  });
  const run: PgRunner = async (sql, params) => {
    const r = await pool.query(sql, params);
    return { rows: r.rows, rowCount: r.rowCount ?? 0 };
  };
  const ready = migratePg(run);
  const q = pgQueryable(async (sql, params) => {
    await ready;
    return run(sql, params);
  });
  return {
    dialect: "postgres",
    ...q,
    async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
      await ready;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(pgQueryable(async (sql, params) => {
          const r = await client.query(sql, params);
          return { rows: r.rows, rowCount: r.rowCount ?? 0 };
        }));
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

/** Embedded Postgres (WASM) for tests: real Postgres semantics, no server. */
function pgliteDb(url: string): Db {
  const dir = url.replace(/^pglite:\/\//, "");
  let tail: Promise<unknown> = Promise.resolve();
  const instance = (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = await PGlite.create(dir === "memory" ? undefined : dir, { parsers: { 20: (v: string) => Number(v), 1700: (v: string) => Number(v) } });
    return db;
  })();
  // PGlite is single-connection: queue every statement and transaction.
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = tail.then(fn, fn);
    tail = p.catch(() => undefined);
    return p;
  };
  const exec = async (sql: string, params: unknown[]) => {
    const db = await instance;
    const r = await db.query<Row>(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  const ready = instance.then(() => serial(() => migratePg(exec)));
  const q = pgQueryable(async (sql, params) => {
    await ready;
    return serial(() => exec(sql, params));
  });
  return {
    dialect: "postgres",
    ...q,
    async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
      await ready;
      return serial(async () => {
        await exec("BEGIN", []);
        try {
          const out = await fn(pgQueryable(exec));
          await exec("COMMIT", []);
          return out;
        } catch (err) {
          await exec("ROLLBACK", []).catch(() => undefined);
          throw err;
        }
      });
    },
    async close() {
      await ready.catch(() => undefined);
      await (await instance).close();
    },
  };
}

// ---- Selection ----------------------------------------------------------

type GlobalWithDb = typeof globalThis & { __januxDb?: Db; __januxDbKey?: string };

export function getDb(): Db {
  const g = globalThis as GlobalWithDb;
  const url = process.env.DATABASE_URL?.trim() || "";
  // The data directory is part of the key so tests get a fresh database per temp directory.
  const key = `${url}|${getConfig().dbPath}`;
  if (g.__januxDb && g.__januxDbKey === key) return g.__januxDb;
  const db = url.startsWith("postgres://") || url.startsWith("postgresql://") ? postgresDb(url) : url.startsWith("pglite://") ? pgliteDb(url) : sqliteDb(getConfig().dbPath);
  g.__januxDb = db;
  g.__januxDbKey = key;
  return db;
}

/** Used by tests to point at a fresh data directory or database. */
export async function closeDb() {
  const g = globalThis as GlobalWithDb;
  const db = g.__januxDb;
  g.__januxDb = undefined;
  g.__januxDbKey = undefined;
  await db?.close();
}

let lastNow = 0;
/** Milliseconds, strictly increasing within a process so rows created together keep their order. */
export function now() {
  lastNow = Math.max(Date.now(), lastNow + 1);
  return lastNow;
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
