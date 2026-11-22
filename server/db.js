import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, ROOT } from './config.js';

let db;
const cache = new Map();
export let hasFts = false;

function checkFts5(database) {
  try {
    database.exec('CREATE VIRTUAL TABLE IF NOT EXISTS _test_fts5 USING fts5(x); DROP TABLE IF EXISTS _test_fts5;');
    return true;
  } catch {
    return false;
  }
}

export function openDb(file = config.dbPath) {
  if (db) closeDb();
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  cache.clear();
  hasFts = checkFts5(db);
  migrate();
  return db;
}

export function closeDb() {
  cache.clear();
  if (db) {
    try { db.close(); } catch {}
    db = null;
  }
}

export function getDb() {
  if (!db) openDb();
  return db;
}

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  const dir = path.join(ROOT, 'server', 'migrations');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    db.exec('BEGIN');
    try {
      let sql = fs.readFileSync(path.join(dir, f), 'utf8');
      if (!hasFts) {
        sql = sql.replace(
          /CREATE\s+VIRTUAL\s+TABLE\s+listings_fts\s+USING\s+fts5\s*\([^;]+\);/i,
          'CREATE TABLE IF NOT EXISTS listings_fts (rowid INTEGER PRIMARY KEY, title TEXT, description TEXT, brand TEXT, model TEXT, category TEXT, city TEXT);'
        );
      }
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(f);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${f} failed: ${e.message}`);
    }
  }
}

function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = getDb().prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

const norm = (params) => params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p === undefined ? null : p));

export const q = {
  all: (sql, ...p) => stmt(sql).all(...norm(p)).map((r) => ({ ...r })),
  get: (sql, ...p) => {
    const r = stmt(sql).get(...norm(p));
    return r ? { ...r } : undefined;
  },
  run: (sql, ...p) => {
    const r = stmt(sql).run(...norm(p));
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  },
  val: (sql, ...p) => {
    const r = stmt(sql).get(...norm(p));
    return r ? Object.values(r)[0] : undefined;
  },
};

let depth = 0;
/** Run fn inside a transaction (nested calls join the outer one). */
export function tx(fn) {
  if (depth > 0) return fn();
  getDb().exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const out = fn();
    depth--;
    getDb().exec('COMMIT');
    return out;
  } catch (e) {
    depth--;
    getDb().exec('ROLLBACK');
    throw e;
  }
}

export const json = (s, d = null) => {
  if (s == null) return d;
  try { return JSON.parse(s); } catch { return d; }
};
