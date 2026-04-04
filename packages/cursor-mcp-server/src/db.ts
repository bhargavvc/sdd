/**
 * DB layer for @bhargavvc/sdd-cursor
 *
 * Standalone SQLite abstraction — no imports from main SDD package.
 * Uses the same schema as sdd-db.ts (schema v14) so data is fully
 * compatible with the SDD CLI.
 *
 * Provider fallback: node:sqlite (Node 22+) → better-sqlite3 → error
 * Connection pool: one open DB per project dir (keyed by resolved path)
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const _require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DbStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

export interface DbAdapter {
  exec(sql: string): void;
  prepare(sql: string): DbStatement;
  close(): void;
  path: string;
}

type ProviderName = 'node:sqlite' | 'better-sqlite3';

// ---------------------------------------------------------------------------
// Provider loading (lazy, once)
// ---------------------------------------------------------------------------

let providerName: ProviderName | null = null;
let providerModule: unknown = null;
let loadAttempted = false;

function suppressSqliteWarning(): void {
  const origEmit = process.emit;
  // @ts-expect-error overriding process.emit
  process.emit = function (event: string, ...args: unknown[]): boolean {
    if (
      event === 'warning' &&
      args[0] &&
      typeof args[0] === 'object' &&
      'name' in args[0] &&
      (args[0] as { name: string }).name === 'ExperimentalWarning' &&
      'message' in args[0] &&
      typeof (args[0] as { message: string }).message === 'string' &&
      (args[0] as { message: string }).message.includes('SQLite')
    ) return false;
    return origEmit.apply(process, [event, ...args] as Parameters<typeof process.emit>) as unknown as boolean;
  };
}

function loadProvider(): void {
  if (loadAttempted) return;
  loadAttempted = true;

  try {
    suppressSqliteWarning();
    const mod = _require('node:sqlite');
    if (mod.DatabaseSync) { providerModule = mod; providerName = 'node:sqlite'; return; }
  } catch { /* unavailable */ }

  try {
    const mod = _require('better-sqlite3');
    if (typeof mod === 'function' || (mod && mod.default)) {
      providerModule = mod.default || mod; providerName = 'better-sqlite3'; return;
    }
  } catch { /* unavailable */ }

  throw new Error(
    `sdd-cursor-mcp: No SQLite provider available. ` +
    `Node ${process.versions.node} — requires Node >=22 for built-in SQLite, ` +
    `or install better-sqlite3: npm install -g better-sqlite3`
  );
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

function normalizeRow(row: unknown): Record<string, unknown> | undefined {
  if (row == null) return undefined;
  if (Object.getPrototypeOf(row) === null) return { ...(row as Record<string, unknown>) };
  return row as Record<string, unknown>;
}

function createAdapter(rawDb: unknown, dbPath: string): DbAdapter {
  const db = rawDb as {
    exec(sql: string): void;
    prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] };
    close(): void;
  };

  const stmtCache = new Map<string, DbStatement>();

  function wrapStmt(raw: { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] }): DbStatement {
    return {
      run: (...params) => raw.run(...params),
      get: (...params) => normalizeRow(raw.get(...params)),
      all: (...params) => (raw.all(...params) as unknown[]).map(r => normalizeRow(r)!),
    };
  }

  return {
    path: dbPath,
    exec(sql) { db.exec(sql); },
    prepare(sql) {
      let cached = stmtCache.get(sql);
      if (!cached) { cached = wrapStmt(db.prepare(sql)); stmtCache.set(sql, cached); }
      return cached;
    },
    close() { stmtCache.clear(); db.close(); },
  };
}

function openRawDb(path: string): unknown {
  loadProvider();
  if (providerName === 'node:sqlite') {
    const { DatabaseSync } = providerModule as { DatabaseSync: new (p: string) => unknown };
    return new DatabaseSync(path);
  }
  const Database = providerModule as new (p: string) => unknown;
  return new Database(path);
}

// ---------------------------------------------------------------------------
// Schema (matches sdd-db.ts v14)
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 14;

function initSchema(db: DbAdapter): void {
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA busy_timeout=5000');
  db.exec('PRAGMA synchronous=NORMAL');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('PRAGMA temp_store=MEMORY');

  db.exec('BEGIN');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied_at TEXT NOT NULL)`);

    db.exec(`CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      depends_on TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT DEFAULT NULL,
      vision TEXT NOT NULL DEFAULT '',
      success_criteria TEXT NOT NULL DEFAULT '[]',
      key_risks TEXT NOT NULL DEFAULT '[]',
      proof_strategy TEXT NOT NULL DEFAULT '[]',
      verification_contract TEXT NOT NULL DEFAULT '',
      verification_integration TEXT NOT NULL DEFAULT '',
      verification_operational TEXT NOT NULL DEFAULT '',
      verification_uat TEXT NOT NULL DEFAULT '',
      definition_of_done TEXT NOT NULL DEFAULT '[]',
      requirement_coverage TEXT NOT NULL DEFAULT '',
      boundary_map_markdown TEXT NOT NULL DEFAULT ''
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS slices (
      milestone_id TEXT NOT NULL,
      id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      risk TEXT NOT NULL DEFAULT 'medium',
      depends TEXT NOT NULL DEFAULT '[]',
      demo TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT DEFAULT NULL,
      full_summary_md TEXT NOT NULL DEFAULT '',
      full_uat_md TEXT NOT NULL DEFAULT '',
      goal TEXT NOT NULL DEFAULT '',
      success_criteria TEXT NOT NULL DEFAULT '',
      proof_level TEXT NOT NULL DEFAULT '',
      integration_closure TEXT NOT NULL DEFAULT '',
      observability_impact TEXT NOT NULL DEFAULT '',
      sequence INTEGER DEFAULT 0,
      replan_triggered_at TEXT DEFAULT NULL,
      PRIMARY KEY (milestone_id, id),
      FOREIGN KEY (milestone_id) REFERENCES milestones(id)
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS tasks (
      milestone_id TEXT NOT NULL,
      slice_id TEXT NOT NULL,
      id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      one_liner TEXT NOT NULL DEFAULT '',
      narrative TEXT NOT NULL DEFAULT '',
      verification_result TEXT NOT NULL DEFAULT '',
      duration TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT DEFAULT NULL,
      blocker_discovered INTEGER DEFAULT 0,
      deviations TEXT NOT NULL DEFAULT '',
      known_issues TEXT NOT NULL DEFAULT '',
      key_files TEXT NOT NULL DEFAULT '[]',
      key_decisions TEXT NOT NULL DEFAULT '[]',
      full_summary_md TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      estimate TEXT NOT NULL DEFAULT '',
      files TEXT NOT NULL DEFAULT '[]',
      verify TEXT NOT NULL DEFAULT '',
      inputs TEXT NOT NULL DEFAULT '[]',
      expected_output TEXT NOT NULL DEFAULT '[]',
      observability_impact TEXT NOT NULL DEFAULT '',
      full_plan_md TEXT NOT NULL DEFAULT '',
      sequence INTEGER DEFAULT 0,
      PRIMARY KEY (milestone_id, slice_id, id),
      FOREIGN KEY (milestone_id, slice_id) REFERENCES slices(milestone_id, id)
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS verification_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL DEFAULT '',
      slice_id TEXT NOT NULL DEFAULT '',
      milestone_id TEXT NOT NULL DEFAULT '',
      command TEXT NOT NULL DEFAULT '',
      exit_code INTEGER DEFAULT 0,
      verdict TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ''
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS decisions (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      when_context TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT '',
      decision TEXT NOT NULL DEFAULT '',
      choice TEXT NOT NULL DEFAULT '',
      rationale TEXT NOT NULL DEFAULT '',
      revisable TEXT NOT NULL DEFAULT '',
      made_by TEXT NOT NULL DEFAULT 'agent',
      superseded_by TEXT DEFAULT NULL
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY,
      class TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      why TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      primary_owner TEXT NOT NULL DEFAULT '',
      supporting_slices TEXT NOT NULL DEFAULT '',
      validation TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      full_content TEXT NOT NULL DEFAULT '',
      superseded_by TEXT DEFAULT NULL
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS quality_gates (
      milestone_id TEXT NOT NULL,
      slice_id TEXT NOT NULL,
      gate_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'slice',
      task_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      verdict TEXT NOT NULL DEFAULT '',
      rationale TEXT NOT NULL DEFAULT '',
      findings TEXT NOT NULL DEFAULT '',
      evaluated_at TEXT DEFAULT NULL,
      PRIMARY KEY (milestone_id, slice_id, gate_id, task_id)
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS replan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      milestone_id TEXT NOT NULL DEFAULT '',
      slice_id TEXT DEFAULT NULL,
      task_id TEXT DEFAULT NULL,
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    )`);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_active ON tasks(milestone_id, slice_id, status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_slices_active ON slices(milestone_id, status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_milestones_status ON milestones(status)`);

    const existing = db.prepare('SELECT count(*) as cnt FROM schema_version').get();
    if (existing && (existing['cnt'] as number) === 0) {
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(SCHEMA_VERSION, new Date().toISOString());
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Connection pool — one DB per resolved project dir
// ---------------------------------------------------------------------------

const pool = new Map<string, DbAdapter>();

process.on('exit', () => {
  for (const db of pool.values()) {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
    try { db.close(); } catch { /* ignore */ }
  }
});

/**
 * Get (or open) the DB for a project directory.
 * Creates .sdd/sdd.db if it doesn't exist.
 */
export function getDb(projectDir: string): DbAdapter {
  const absDir = resolve(projectDir);
  const sddDir = join(absDir, '.sdd');
  const dbPath = join(sddDir, 'sdd.db');

  const cached = pool.get(dbPath);
  if (cached) return cached;

  if (!existsSync(sddDir)) mkdirSync(sddDir, { recursive: true });

  const rawDb = openRawDb(dbPath);
  const adapter = createAdapter(rawDb, dbPath);
  initSchema(adapter);
  pool.set(dbPath, adapter);
  return adapter;
}

/** Close DB for a project dir (optional — pool auto-closes on exit). */
export function closeDb(projectDir: string): void {
  const dbPath = join(resolve(projectDir), '.sdd', 'sdd.db');
  const db = pool.get(dbPath);
  if (db) { try { db.close(); } catch { /* ignore */ } pool.delete(dbPath); }
}

// ---------------------------------------------------------------------------
// Transaction helper
// ---------------------------------------------------------------------------

export function transaction<T>(db: DbAdapter, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Typed row helpers (read from DB, cast to known shapes)
// ---------------------------------------------------------------------------

export interface MilestoneRow {
  id: string;
  title: string;
  status: string;
  depends_on: string;
  created_at: string;
  completed_at: string | null;
  vision: string;
  success_criteria: string;
  key_risks: string;
  proof_strategy: string;
  verification_contract: string;
  verification_integration: string;
  verification_operational: string;
  verification_uat: string;
  definition_of_done: string;
  requirement_coverage: string;
  boundary_map_markdown: string;
}

export interface SliceRow {
  milestone_id: string;
  id: string;
  title: string;
  status: string;
  risk: string;
  depends: string;
  demo: string;
  created_at: string;
  completed_at: string | null;
  goal: string;
  success_criteria: string;
  proof_level: string;
  integration_closure: string;
  observability_impact: string;
  sequence: number;
}

export interface TaskRow {
  milestone_id: string;
  slice_id: string;
  id: string;
  title: string;
  status: string;
  one_liner: string;
  description: string;
  estimate: string;
  verify: string;
  completed_at: string | null;
  blocker_discovered: number;
  sequence: number;
}

export function getMilestone(db: DbAdapter, id: string): MilestoneRow | null {
  const row = db.prepare('SELECT * FROM milestones WHERE id = ?').get(id);
  return (row as MilestoneRow | undefined) ?? null;
}

export function getMilestones(db: DbAdapter): MilestoneRow[] {
  return db.prepare('SELECT * FROM milestones ORDER BY created_at').all() as unknown as MilestoneRow[];
}

export function getSlices(db: DbAdapter, milestoneId: string): SliceRow[] {
  return db.prepare('SELECT * FROM slices WHERE milestone_id = ? ORDER BY sequence, id').all(milestoneId) as unknown as SliceRow[];
}

export function getSlice(db: DbAdapter, milestoneId: string, sliceId: string): SliceRow | null {
  const row = db.prepare('SELECT * FROM slices WHERE milestone_id = ? AND id = ?').get(milestoneId, sliceId);
  return (row as SliceRow | undefined) ?? null;
}

export function getTasks(db: DbAdapter, milestoneId: string, sliceId: string): TaskRow[] {
  return db.prepare('SELECT * FROM tasks WHERE milestone_id = ? AND slice_id = ? ORDER BY sequence, id').all(milestoneId, sliceId) as unknown as TaskRow[];
}

export function getTask(db: DbAdapter, milestoneId: string, sliceId: string, taskId: string): TaskRow | null {
  const row = db.prepare('SELECT * FROM tasks WHERE milestone_id = ? AND slice_id = ? AND id = ?').get(milestoneId, sliceId, taskId);
  return (row as TaskRow | undefined) ?? null;
}
