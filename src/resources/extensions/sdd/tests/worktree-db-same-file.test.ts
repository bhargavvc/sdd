/**
 * worktree-db-same-file.test.ts — Regression test for #2823.
 *
 * Verifies that reconcileWorktreeDb() does not ATTACH a WAL-mode DB file
 * to itself when the worktree DB path resolves to the same physical file
 * as the main DB path (shared-WAL / symlink layout).
 *
 * Also verifies that the auto-loop classifies "database disk image is
 * malformed" as an infrastructure error to prevent wasting retries.
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  openDatabase,
  closeDatabase,
  reconcileWorktreeDb,
  insertDecision,
} from "../sdd-db.ts";
import { isInfrastructureError } from "../auto/infra-errors.ts";

// ─── Fix 1 & 2: reconcileWorktreeDb same-file guard ─────────────────

describe("#2823: reconcileWorktreeDb same-file guard", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sdd-2823-"));
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns zero result when both paths resolve to the same file", () => {
    const mainSdd = join(tmpDir, "main", ".sdd");
    mkdirSync(mainSdd, { recursive: true });
    const mainDbPath = join(mainSdd, "sdd.db");

    // Create a real DB at mainDbPath
    openDatabase(mainDbPath);
    insertDecision({
      id: "D001",
      when_context: "2026-01-01",
      scope: "M001",
      decision: "Test decision",
      choice: "Test choice",
      rationale: "Test rationale",
      revisable: "yes",
      made_by: "agent",
      superseded_by: null,
    });

    // Create a worktree path that resolves to the same file via symlink
    const wtSdd = join(tmpDir, "worktree", ".sdd");
    mkdirSync(join(tmpDir, "worktree"), { recursive: true });
    symlinkSync(mainSdd, wtSdd, "junction");
    const worktreeDbPath = join(wtSdd, "sdd.db");

    // Both paths exist and resolve to the same physical file
    assert.ok(existsSync(mainDbPath), "main DB exists");
    assert.ok(existsSync(worktreeDbPath), "worktree DB path exists (via symlink)");

    // This should NOT attempt ATTACH — should return zero result
    const result = reconcileWorktreeDb(mainDbPath, worktreeDbPath);

    assert.equal(result.decisions, 0, "no decisions reconciled");
    assert.equal(result.requirements, 0, "no requirements reconciled");
    assert.equal(result.artifacts, 0, "no artifacts reconciled");
    assert.equal(result.conflicts.length, 0, "no conflicts");
  });

  test("returns zero result when both paths are identical strings", () => {
    const mainSdd = join(tmpDir, "project", ".sdd");
    mkdirSync(mainSdd, { recursive: true });
    const dbPath = join(mainSdd, "sdd.db");

    openDatabase(dbPath);
    insertDecision({
      id: "D001",
      when_context: "2026-01-01",
      scope: "M001",
      decision: "Test",
      choice: "Test",
      rationale: "Test",
      revisable: "yes",
      made_by: "agent",
      superseded_by: null,
    });

    // Same exact path — should bail immediately
    const result = reconcileWorktreeDb(dbPath, dbPath);

    assert.equal(result.decisions, 0);
    assert.equal(result.conflicts.length, 0);
  });

  test("still reconciles when paths are genuinely different files", () => {
    // Main DB
    const mainSdd = join(tmpDir, "main", ".sdd");
    mkdirSync(mainSdd, { recursive: true });
    const mainDbPath = join(mainSdd, "sdd.db");

    openDatabase(mainDbPath);
    insertDecision({
      id: "D001",
      when_context: "2026-01-01",
      scope: "M001",
      decision: "Main decision",
      choice: "Main choice",
      rationale: "Main rationale",
      revisable: "yes",
      made_by: "agent",
      superseded_by: null,
    });
    closeDatabase();

    // Create a separate worktree DB with different data
    const wtSdd = join(tmpDir, "worktree", ".sdd");
    mkdirSync(wtSdd, { recursive: true });
    const worktreeDbPath = join(wtSdd, "sdd.db");

    openDatabase(worktreeDbPath);
    insertDecision({
      id: "D002",
      when_context: "2026-01-01",
      scope: "M001",
      decision: "WT decision",
      choice: "WT choice",
      rationale: "WT rationale",
      revisable: "yes",
      made_by: "agent",
      superseded_by: null,
    });
    closeDatabase();

    // Re-open main and reconcile — should work normally
    openDatabase(mainDbPath);
    const result = reconcileWorktreeDb(mainDbPath, worktreeDbPath);

    assert.ok(
      result.decisions > 0,
      "should reconcile decisions from a genuinely different DB",
    );
  });
});

// ─── Fix 3: infrastructure error classification ─────────────────────

describe("#2823: malformed DB classified as infrastructure error", () => {
  test("database disk image is malformed is detected as infra error", () => {
    const err = new Error("database disk image is malformed");
    const code = isInfrastructureError(err);
    assert.ok(code !== null, "should be classified as infrastructure error");
    assert.equal(code, "SQLITE_CORRUPT");
  });

  test("other SQLite errors are not falsely classified", () => {
    const err = new Error("SQLITE_BUSY: database is locked");
    const code = isInfrastructureError(err);
    assert.equal(code, null, "SQLITE_BUSY should not be infra error (it's transient)");
  });
});
