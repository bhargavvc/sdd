/**
 * gitignore-tracked-sdd.test.ts — Regression tests for #1364.
 *
 * Verifies that ensureGitignore() does NOT add ".sdd" to .gitignore
 * when .sdd/ contains git-tracked files, and that migrateToExternalState()
 * aborts migration for tracked .sdd/ directories.
 *
 * Uses real temporary git repos — no mocks.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ensureGitignore, hasGitTrackedSddFiles } from "../gitignore.ts";
import { migrateToExternalState } from "../migrate-external.ts";

// ─── Helpers ─────────────────────────────────────────────────────────

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, stdio: "pipe", encoding: "utf-8" }).trim();
}

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "sdd-gitignore-test-"));
  git(dir, "init");
  git(dir, "config", "user.email", "test@test.com");
  git(dir, "config", "user.name", "Test");
  writeFileSync(join(dir, "README.md"), "# init\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "init");
  git(dir, "branch", "-M", "main");
  return dir;
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ─── hasGitTrackedSddFiles ───────────────────────────────────────────

test("hasGitTrackedSddFiles returns false when .sdd/ does not exist", () => {
  const dir = makeTempRepo();
  try {
    assert.equal(hasGitTrackedSddFiles(dir), false);
  } finally {
    cleanup(dir);
  }
});

test("hasGitTrackedSddFiles returns true when .sdd/ has tracked files", () => {
  const dir = makeTempRepo();
  try {
    mkdirSync(join(dir, ".sdd", "milestones"), { recursive: true });
    writeFileSync(join(dir, ".sdd", "PROJECT.md"), "# Test Project\n");
    git(dir, "add", ".sdd/PROJECT.md");
    git(dir, "commit", "-m", "add sdd");
    assert.equal(hasGitTrackedSddFiles(dir), true);
  } finally {
    cleanup(dir);
  }
});

test("hasGitTrackedSddFiles returns false when .sdd/ exists but is untracked", () => {
  const dir = makeTempRepo();
  try {
    mkdirSync(join(dir, ".sdd"), { recursive: true });
    writeFileSync(join(dir, ".sdd", "STATE.md"), "state\n");
    // Not git-added — should return false
    assert.equal(hasGitTrackedSddFiles(dir), false);
  } finally {
    cleanup(dir);
  }
});

// ─── ensureGitignore — tracked .sdd/ protection ─────────────────────

test("ensureGitignore does NOT add .sdd when .sdd/ has tracked files (#1364)", () => {
  const dir = makeTempRepo();
  try {
    // Set up .sdd/ with tracked files
    mkdirSync(join(dir, ".sdd", "milestones"), { recursive: true });
    writeFileSync(join(dir, ".sdd", "PROJECT.md"), "# Test Project\n");
    writeFileSync(join(dir, ".sdd", "DECISIONS.md"), "# Decisions\n");
    git(dir, "add", ".sdd/");
    git(dir, "commit", "-m", "track sdd state");

    // Run ensureGitignore
    ensureGitignore(dir);

    // Verify .sdd is NOT in .gitignore
    const gitignore = readFileSync(join(dir, ".gitignore"), "utf-8");
    const lines = gitignore.split("\n").map((l) => l.trim());
    assert.ok(
      !lines.includes(".sdd"),
      `Expected .sdd NOT to appear in .gitignore, but it does:\n${gitignore}`,
    );

    // Other baseline patterns should still be present
    assert.ok(lines.includes(".DS_Store"), "Expected .DS_Store in .gitignore");
    assert.ok(lines.includes("node_modules/"), "Expected node_modules/ in .gitignore");
  } finally {
    cleanup(dir);
  }
});

test("ensureGitignore adds .sdd when .sdd/ has NO tracked files", () => {
  const dir = makeTempRepo();
  try {
    // Run ensureGitignore (no .sdd/ at all)
    ensureGitignore(dir);

    // Verify .sdd IS in .gitignore
    const gitignore = readFileSync(join(dir, ".gitignore"), "utf-8");
    const lines = gitignore.split("\n").map((l) => l.trim());
    assert.ok(
      lines.includes(".sdd"),
      `Expected .sdd in .gitignore, but it's missing:\n${gitignore}`,
    );
  } finally {
    cleanup(dir);
  }
});

test("ensureGitignore respects manageGitignore: false", () => {
  const dir = makeTempRepo();
  try {
    const result = ensureGitignore(dir, { manageGitignore: false });
    assert.equal(result, false);
    assert.ok(!existsSync(join(dir, ".gitignore")), "Should not create .gitignore");
  } finally {
    cleanup(dir);
  }
});

// ─── ensureGitignore — verify no tracked files become invisible ─────

test("ensureGitignore with tracked .sdd/ does not cause git to see files as deleted", () => {
  const dir = makeTempRepo();
  try {
    // Create tracked .sdd/ files
    mkdirSync(join(dir, ".sdd", "milestones", "M001"), { recursive: true });
    writeFileSync(join(dir, ".sdd", "PROJECT.md"), "# Project\n");
    writeFileSync(
      join(dir, ".sdd", "milestones", "M001", "M001-CONTEXT.md"),
      "# M001\n",
    );
    git(dir, "add", ".sdd/");
    git(dir, "commit", "-m", "track sdd state");

    // Run ensureGitignore
    ensureGitignore(dir);

    // git status should show NO deleted files under .sdd/
    const status = git(dir, "status", "--porcelain", ".sdd/");

    // Filter for deletions (lines starting with " D" or "D ")
    const deletions = status
      .split("\n")
      .filter((l) => l.match(/^\s*D\s/) || l.match(/^D\s/));

    assert.equal(
      deletions.length,
      0,
      `Expected no deleted .sdd/ files, but found:\n${deletions.join("\n")}`,
    );
  } finally {
    cleanup(dir);
  }
});

test("hasGitTrackedSddFiles returns true (fail-safe) when git is not available", () => {
  const dir = makeTempRepo();
  try {
    // Create and track .sdd/ files
    mkdirSync(join(dir, ".sdd"), { recursive: true });
    writeFileSync(join(dir, ".sdd", "PROJECT.md"), "# Project\n");
    git(dir, "add", ".sdd/");
    git(dir, "commit", "-m", "track sdd");

    // Corrupt the git index to simulate git failure
    const indexPath = join(dir, ".git", "index.lock");
    writeFileSync(indexPath, "locked");

    // Should fail safe — assume tracked rather than silently returning false
    // (The index lock causes git ls-files to fail; rev-parse also fails → true)
    const result = hasGitTrackedSddFiles(dir);
    assert.equal(result, true, "Should return true (fail-safe) when git is unavailable");
  } finally {
    cleanup(dir);
  }
});

// ─── migrateToExternalState — tracked .sdd/ protection ──────────────

test("migrateToExternalState aborts when .sdd/ has tracked files (#1364)", () => {
  const dir = makeTempRepo();
  try {
    // Create tracked .sdd/ files
    mkdirSync(join(dir, ".sdd", "milestones"), { recursive: true });
    writeFileSync(join(dir, ".sdd", "PROJECT.md"), "# Project\n");
    git(dir, "add", ".sdd/");
    git(dir, "commit", "-m", "track sdd state");

    // Attempt migration — should abort without moving anything
    const result = migrateToExternalState(dir);

    assert.equal(result.migrated, false, "Should NOT migrate tracked .sdd/");
    assert.equal(result.error, undefined, "Should not report an error — just skip");

    // .sdd/ should still be a real directory, not a symlink
    assert.ok(existsSync(join(dir, ".sdd", "PROJECT.md")), ".sdd/PROJECT.md should still exist");

    // No .sdd.migrating should exist
    assert.ok(
      !existsSync(join(dir, ".sdd.migrating")),
      ".sdd.migrating should not exist",
    );
  } finally {
    cleanup(dir);
  }
});

test("migrateToExternalState cleans git index so tracked files don't show as deleted (#1364 path 2)", () => {
  const dir = makeTempRepo();
  try {
    // Track .sdd/ files, then untrack them so migration proceeds
    mkdirSync(join(dir, ".sdd", "milestones", "M001"), { recursive: true });
    writeFileSync(join(dir, ".sdd", "PROJECT.md"), "# Project\n");
    writeFileSync(join(dir, ".sdd", "milestones", "M001", "PLAN.md"), "# Plan\n");
    git(dir, "add", ".sdd/");
    git(dir, "commit", "-m", "track sdd state");
    git(dir, "rm", "-r", "--cached", ".sdd/");
    git(dir, "commit", "-m", "untrack sdd (simulates pre-migration project)");

    const result = migrateToExternalState(dir);
    assert.equal(result.migrated, true, "Migration should succeed");

    // git status must show NO deleted files after migration
    const status = git(dir, "status", "--porcelain");
    const deletions = status.split("\n").filter((l) => /^\s*D\s/.test(l) || /^D\s/.test(l));
    assert.equal(
      deletions.length,
      0,
      `Expected no deleted files after migration, but found:\n${deletions.join("\n")}`,
    );
  } finally {
    cleanup(dir);
  }
});
