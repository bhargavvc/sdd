/**
 * sddroot-worktree-detection.test.ts — Regression test for #2594.
 *
 * sddRoot() must return the worktree's own .sdd directory when the basePath
 * is inside a .sdd/worktrees/<name>/ structure, not walk up to the project
 * root's .sdd via the git-root probe.
 *
 * The bug: when a git worktree lives at /project/.sdd/worktrees/M008/,
 * probeSddRoot() runs `git rev-parse --show-toplevel` which can return the
 * main project root (not the worktree root) depending on git version and
 * worktree setup. The walk-up then finds /project/.sdd and returns that
 * instead of the worktree's own .sdd path.
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { sddRoot, _clearSddRootCache } from "../paths.ts";

describe("sddRoot() worktree detection (#2594)", () => {
  let projectRoot: string;
  let projectSdd: string;

  beforeEach(() => {
    _clearSddRootCache();
    // Create a temporary project with a git repo to simulate real conditions.
    // realpathSync handles macOS /tmp -> /private/tmp.
    projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "sddroot-wt-")));
    projectSdd = join(projectRoot, ".sdd");
    mkdirSync(projectSdd, { recursive: true });

    // Initialize a git repo in the project root so git rev-parse works
    spawnSync("git", ["init", "--initial-branch=main"], {
      cwd: projectRoot,
      stdio: "ignore",
    });
    spawnSync("git", ["config", "user.email", "test@test.com"], {
      cwd: projectRoot,
      stdio: "ignore",
    });
    spawnSync("git", ["config", "user.name", "Test"], {
      cwd: projectRoot,
      stdio: "ignore",
    });
    // Create an initial commit so we have a HEAD
    writeFileSync(join(projectRoot, "README.md"), "# Test");
    spawnSync("git", ["add", "."], { cwd: projectRoot, stdio: "ignore" });
    spawnSync("git", ["commit", "-m", "init"], {
      cwd: projectRoot,
      stdio: "ignore",
    });
  });

  afterEach(() => {
    _clearSddRootCache();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test("returns worktree .sdd when basePath is a worktree with its own .sdd (fast path)", () => {
    // Simulates a worktree that already had copyPlanningArtifacts() run,
    // so it has its own .sdd/ directory.
    const worktreeBase = join(projectSdd, "worktrees", "M008");
    const worktreeSdd = join(worktreeBase, ".sdd");
    mkdirSync(worktreeSdd, { recursive: true });

    const result = sddRoot(worktreeBase);
    assert.equal(
      result,
      worktreeSdd,
      `Expected worktree .sdd (${worktreeSdd}), got ${result}. ` +
        "sddRoot() should use the fast path for an existing worktree .sdd.",
    );
  });

  test("returns worktree .sdd path (not project root .sdd) when worktree .sdd does not exist yet", () => {
    // This is the core #2594 bug: the worktree directory exists but its .sdd
    // subdirectory hasn't been created yet. Without the fix, probeSddRoot()
    // walks up from the worktree path, finds /project/.sdd, and returns it.
    // With the fix, it detects the .sdd/worktrees/<name>/ pattern and returns
    // the worktree-local .sdd path as the creation fallback.
    const worktreeBase = join(projectSdd, "worktrees", "M008");
    mkdirSync(worktreeBase, { recursive: true });
    // NOTE: no .sdd/ inside worktreeBase

    const result = sddRoot(worktreeBase);
    const expected = join(worktreeBase, ".sdd");

    // Without the fix, this returns projectSdd (/project/.sdd) because the
    // walk-up from worktreeBase finds it. With the fix, it returns the
    // worktree-local path.
    assert.notEqual(
      result,
      projectSdd,
      "sddRoot() must NOT return the project root .sdd when basePath is inside .sdd/worktrees/",
    );
    assert.equal(
      result,
      expected,
      `Expected worktree-local .sdd (${expected}), got ${result}.`,
    );
  });

  test("returns worktree .sdd when basePath is a real git worktree inside .sdd/worktrees/", () => {
    // Create a real git worktree at .sdd/worktrees/M010
    const worktreeName = "M010";
    const worktreeBase = join(projectSdd, "worktrees", worktreeName);

    // Use git worktree add to create a real worktree
    const result = spawnSync(
      "git",
      ["worktree", "add", "-b", `milestone/${worktreeName}`, worktreeBase],
      { cwd: projectRoot, encoding: "utf-8" },
    );

    if (result.status !== 0) {
      // If git worktree add fails, skip the test gracefully
      assert.ok(true, "Skipped: git worktree add not available");
      return;
    }

    // The real git worktree exists at worktreeBase but has NO .sdd/ subdir yet
    const sddResult = sddRoot(worktreeBase);
    const expected = join(worktreeBase, ".sdd");

    assert.notEqual(
      sddResult,
      projectSdd,
      "sddRoot() must NOT escape to project root .sdd from inside a git worktree",
    );
    assert.equal(
      sddResult,
      expected,
      `Expected worktree-local .sdd (${expected}), got ${sddResult}`,
    );

    // Cleanup worktree
    spawnSync("git", ["worktree", "remove", "--force", worktreeBase], {
      cwd: projectRoot,
      stdio: "ignore",
    });
  });

  test("still returns project .sdd for normal (non-worktree) basePath", () => {
    const result = sddRoot(projectRoot);
    assert.equal(result, projectSdd);
  });

  test("still returns project .sdd for a subdirectory of the project", () => {
    const subdir = join(projectRoot, "src", "lib");
    mkdirSync(subdir, { recursive: true });

    const result = sddRoot(subdir);
    assert.equal(
      result,
      projectSdd,
      "Non-worktree subdirectories should still resolve to project .sdd",
    );
  });
});
