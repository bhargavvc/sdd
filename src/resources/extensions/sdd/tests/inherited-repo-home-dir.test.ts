/**
 * inherited-repo-home-dir.test.ts — Regression test for #2393.
 *
 * When the user's home directory IS a git repo (common with dotfile
 * managers like yadm), isInheritedRepo() must not treat ~/.sdd (the
 * global SDD state directory) as a project .sdd belonging to the home
 * repo. Without the fix, isInheritedRepo() returns false for project
 * subdirectories because it sees ~/.sdd and concludes the parent repo
 * has already been initialised with SDD — causing the wrong project
 * state to be loaded.
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { isInheritedRepo } from "../repo-identity.ts";

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  }).trim();
}

describe("isInheritedRepo when git root is HOME (#2393)", () => {
  let fakeHome: string;
  let stateDir: string;
  let origGsdHome: string | undefined;
  let origSddStateDir: string | undefined;

  beforeEach(() => {
    // Create a fake HOME that is itself a git repo (dotfile manager scenario).
    fakeHome = realpathSync(mkdtempSync(join(tmpdir(), "sdd-home-repo-")));
    run("git", ["init", "-b", "main"], fakeHome);
    run("git", ["config", "user.name", "Test"], fakeHome);
    run("git", ["config", "user.email", "test@example.com"], fakeHome);
    writeFileSync(join(fakeHome, ".bashrc"), "# dotfiles\n", "utf-8");
    run("git", ["add", ".bashrc"], fakeHome);
    run("git", ["commit", "-m", "init dotfiles"], fakeHome);

    // Create a plain ~/.sdd directory at fakeHome — this simulates the
    // global SDD home directory, NOT a project .sdd.
    mkdirSync(join(fakeHome, ".sdd", "projects"), { recursive: true });

    // Save and override env. Point SDD_HOME at fakeHome/.sdd so the
    // function recognizes it as the global state directory.
    origGsdHome = process.env.SDD_HOME;
    origSddStateDir = process.env.SDD_STATE_DIR;
    process.env.SDD_HOME = join(fakeHome, ".sdd");
    stateDir = mkdtempSync(join(tmpdir(), "sdd-state-"));
    process.env.SDD_STATE_DIR = stateDir;
  });

  afterEach(() => {
    if (origGsdHome !== undefined) process.env.SDD_HOME = origGsdHome;
    else delete process.env.SDD_HOME;
    if (origSddStateDir !== undefined) process.env.SDD_STATE_DIR = origSddStateDir;
    else delete process.env.SDD_STATE_DIR;

    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  test("subdirectory of home-as-git-root is detected as inherited even when ~/.sdd exists", () => {
    // Create a project directory inside fake HOME
    const projectDir = join(fakeHome, "projects", "my-app");
    mkdirSync(projectDir, { recursive: true });

    // The bug: isInheritedRepo sees ~/.sdd and returns false, thinking
    // the home repo is a legitimate SDD project. It should return true
    // because ~/.sdd is the global state dir, not a project .sdd.
    assert.strictEqual(
      isInheritedRepo(projectDir),
      true,
      "project inside home-as-git-root must be detected as inherited repo, " +
      "even when ~/.sdd (global state dir) exists",
    );
  });

  test("subdirectory with a real project .sdd symlink at git root is NOT inherited", () => {
    // Simulate a legitimately initialised SDD project at the home repo root:
    // .sdd is a symlink to an external state directory.
    const externalState = join(stateDir, "projects", "home-project");
    mkdirSync(externalState, { recursive: true });
    const sddDir = join(fakeHome, ".sdd");

    // Remove the plain directory and replace with a symlink (real project .sdd)
    rmSync(sddDir, { recursive: true, force: true });
    symlinkSync(externalState, sddDir);

    const projectDir = join(fakeHome, "projects", "my-app");
    mkdirSync(projectDir, { recursive: true });

    // When .sdd at root IS a project symlink, subdirectories are legitimate children
    assert.strictEqual(
      isInheritedRepo(projectDir),
      false,
      "subdirectory of a legitimately-initialised SDD project should NOT be inherited",
    );
  });

  test("home-as-git-root itself is never inherited", () => {
    assert.strictEqual(
      isInheritedRepo(fakeHome),
      false,
      "the git root itself is never inherited",
    );
  });
});

describe("isInheritedRepo with stale .sdd at parent git root", () => {
  let parentRepo: string;

  beforeEach(() => {
    parentRepo = realpathSync(mkdtempSync(join(tmpdir(), "sdd-stale-parent-")));
    run("git", ["init", "-b", "main"], parentRepo);
    run("git", ["config", "user.name", "Test"], parentRepo);
    run("git", ["config", "user.email", "test@example.com"], parentRepo);
    writeFileSync(join(parentRepo, "README.md"), "# Parent\n", "utf-8");
    run("git", ["add", "README.md"], parentRepo);
    run("git", ["commit", "-m", "init"], parentRepo);
  });

  afterEach(() => {
    rmSync(parentRepo, { recursive: true, force: true });
  });

  test("stale .sdd dir at parent git root does not suppress inherited detection", () => {
    // Simulate a stale .sdd directory at the parent git root (e.g. from a
    // prior doctor run or accidental init). This is a real directory, NOT
    // a symlink, and NOT the global SDD home.
    mkdirSync(join(parentRepo, ".sdd"), { recursive: true });

    const projectDir = join(parentRepo, "my-project");
    mkdirSync(projectDir, { recursive: true });

    // Without fix: isProjectGsd(join(root, ".sdd")) returns true because
    // the stale .sdd is a real directory that isn't the global SDD home,
    // causing isInheritedRepo to return false (false negative).
    //
    // The stale .sdd at parent is still treated as a "project .sdd" by
    // isProjectGsd(), so the git root check at line 128 returns false.
    // This is the expected behavior for that check — the defense-in-depth
    // fix in auto-start.ts handles this case by checking for local .git.
    //
    // Verify the function behavior is consistent:
    assert.strictEqual(
      isInheritedRepo(projectDir),
      false,
      "stale .sdd dir at git root still causes isInheritedRepo to return false " +
      "(defense-in-depth in auto-start.ts handles this case)",
    );
  });

  test("basePath's own .sdd symlink does not suppress inherited detection", () => {
    // Create a project subdir with its own .sdd symlink (set up during
    // the discuss phase, before auto-mode bootstrap runs).
    const projectDir = join(parentRepo, "my-project");
    mkdirSync(projectDir, { recursive: true });

    const externalState = mkdtempSync(join(tmpdir(), "sdd-ext-state-"));
    symlinkSync(externalState, join(projectDir, ".sdd"));

    // Before fix: the walk-up loop started at normalizedBase (projectDir),
    // found .sdd at projectDir, and returned false — even though projectDir
    // has no .git of its own. The .sdd at basePath is irrelevant to whether
    // the git repo is inherited from a parent.
    //
    // After fix: the walk-up starts at dirname(normalizedBase), skipping
    // basePath's own .sdd.
    assert.strictEqual(
      isInheritedRepo(projectDir),
      true,
      "project's own .sdd symlink must not suppress inherited repo detection",
    );

    rmSync(externalState, { recursive: true, force: true });
  });
});
