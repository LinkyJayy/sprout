// Tiny database layer with one async API over two backends:
//   - PostgreSQL when DATABASE_URL is set (recommended on Railway)
//   - SQLite (better-sqlite3) otherwise, stored in DATA_DIR (default ./data)
// SQL is written with `?` placeholders and converted for Postgres.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = (pg) => {
  const id = pg ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  return [
    `CREATE TABLE IF NOT EXISTS users (
      id ${id},
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'reader',
      created_at TEXT NOT NULL
    )`,
    // Guarantees there can only ever be one owner (the first account).
    `CREATE UNIQUE INDEX IF NOT EXISTS users_single_owner ON users(role) WHERE role = 'owner'`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS articles (
      id ${id},
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      dek TEXT NOT NULL DEFAULT '',
      body_md TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'World',
      cover_image TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'original',
      source_name TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'published',
      published_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE INDEX IF NOT EXISTS articles_published ON articles(status, published_at)`,
    `CREATE TABLE IF NOT EXISTS summaries (
      article_id INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      body_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  ];
};

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function createPg(url) {
  const { default: pg } = await import("pg");
  const ssl =
    process.env.PGSSL === "disable" || /localhost|127\.0\.0\.1|\.railway\.internal/.test(url)
      ? false
      : { rejectUnauthorized: false };
  const pool = new pg.Pool({ connectionString: url, ssl, max: 10 });
  const db = {
    kind: "postgres",
    async all(sql, params = []) {
      return (await pool.query(toPg(sql), params)).rows;
    },
    async get(sql, params = []) {
      return (await pool.query(toPg(sql), params)).rows[0];
    },
    async run(sql, params = []) {
      const r = await pool.query(toPg(sql), params);
      return { changes: r.rowCount };
    },
  };
  for (const stmt of SCHEMA(true)) await pool.query(stmt);
  return db;
}

async function createSqlite() {
  const { default: Database } = await import("better-sqlite3");
  const dir = process.env.DATA_DIR || join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  const sqlite = new Database(join(dir, "sprout.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  for (const stmt of SCHEMA(false)) sqlite.exec(stmt);
  return {
    kind: "sqlite",
    async all(sql, params = []) {
      return sqlite.prepare(sql).all(...params);
    },
    async get(sql, params = []) {
      return sqlite.prepare(sql).get(...params);
    },
    async run(sql, params = []) {
      const r = sqlite.prepare(sql).run(...params);
      return { changes: r.changes };
    },
  };
}

export const db = process.env.DATABASE_URL
  ? await createPg(process.env.DATABASE_URL)
  : await createSqlite();

export const isUniqueViolation = (err) =>
  err?.code === "23505" || err?.code === "SQLITE_CONSTRAINT_UNIQUE";

export const now = () => new Date().toISOString();
