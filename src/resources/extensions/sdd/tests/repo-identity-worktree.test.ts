import { mkdtempSync, rmSync, writeFileSync, existsSync, lstatSync, realpathSync, mkdirSync, symlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

import { repoIdentity, externalSddRoot, ensureSddSymlink, validateProjectId, readRepoMeta, isInheritedRepo } from "../repo-identity.ts";
import { createTestContext } from "./test-helpers.ts";

const { assertEq, assertTrue, report } = createTestContext();

/**
 * Normalize a path for reliable comparison on Windows CI runners.
 * `os.tmpdir()` may return the 8.3 short-path form (e.g. `C:\Users\RUNNER~1`)
 * while `realpathSync` and git resolve to the long form (`C:\Users\runneradmin`).
 * Apply `realpathSync` and lowercase on Windows to eliminate both discrepancies.
 */
function normalizePath(p: string): string {
  const resolved = process.platform === "win32" ? realpathSync.native(p) : realpathSync(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function run(command: string, cwd: string): string {
  return execSync(command, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" }).trim();
}

async function main(): Promise<void> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "sdd-repo-identity-")));
  const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "sdd-state-")));

  try {
    process.env.SDD_STATE_DIR = stateDir;

    run("git init -b main", base);
    run('git config user.name "Pi Test"', base);
    run('git config user.email "pi@example.com"', base);
    run('git remote add origin git@github.com:example/repo.git', base);
    writeFileSync(join(base, "README.md"), "# Test Repo\n", "utf-8");
    run("git add README.md", base);
    run('git commit -m "chore: init"', base);

    const worktreePath = join(base, ".sdd", "worktrees", "M001");
    run(`git worktree add -b milestone/M001 ${worktreePath}`, base);

    console.log("\n=== ensureSddSymlink points worktree at main repo external state dir ===");
    const expectedExternalState = externalSddRoot(base);
    const mainState = ensureSddSymlink(base);
    assertEq(mainState, realpathSync(join(base, ".sdd")), "ensureSddSymlink(base) returns the current main repo .sdd target");
    const worktreeState = ensureSddSymlink(worktreePath);
    assertEq(worktreeState, expectedExternalState, "worktree symlink target matches main repo external state dir");
    assertTrue(existsSync(join(worktreePath, ".sdd")), "worktree .sdd exists");
    assertTrue(lstatSync(join(worktreePath, ".sdd")).isSymbolicLink(), "worktree .sdd is a symlink");
    assertEq(realpathSync(join(worktreePath, ".sdd")), realpathSync(expectedExternalState), "worktree .sdd symlink resolves to main repo external state dir");

    console.log("\n=== ensureSddSymlink heals stale worktree symlinks ===");
    const staleState = join(stateDir, "projects", "stale-worktree-state");
    mkdirSync(staleState, { recursive: true });
    rmSync(join(worktreePath, ".sdd"), { recursive: true, force: true });
    symlinkSync(staleState, join(worktreePath, ".sdd"), "junction");
    const healedState = ensureSddSymlink(worktreePath);
    assertEq(healedState, expectedExternalState, "stale worktree symlink is repaired to canonical external state dir");
    assertEq(realpathSync(join(worktreePath, ".sdd")), realpathSync(expectedExternalState), "healed worktree symlink resolves to canonical external state dir");

    console.log("\n=== ensureSddSymlink preserves worktree .sdd directories ===");
    rmSync(join(worktreePath, ".sdd"), { recursive: true, force: true });
    mkdirSync(join(worktreePath, ".sdd", "milestones"), { recursive: true });
    writeFileSync(join(worktreePath, ".sdd", "milestones", "stale.txt"), "stale\n", "utf-8");
    const preservedDirState = ensureSddSymlink(worktreePath);
    assertEq(preservedDirState, join(worktreePath, ".sdd"), "worktree .sdd directory is left in place for sync-based refresh");
    assertTrue(lstatSync(join(worktreePath, ".sdd")).isDirectory(), "worktree .sdd directory remains a directory");
    assertTrue(existsSync(join(worktreePath, ".sdd", "milestones", "stale.txt")), "existing worktree .sdd directory contents remain available for sync logic");

    console.log("\n=== SDD_PROJECT_ID overrides computed repo hash ===");
    process.env.SDD_PROJECT_ID = "my-project";
    assertEq(repoIdentity(base), "my-project", "repoIdentity returns SDD_PROJECT_ID when set");
    assertEq(externalSddRoot(base), join(stateDir, "projects", "my-project"), "externalSddRoot uses SDD_PROJECT_ID");
    delete process.env.SDD_PROJECT_ID;

    console.log("\n=== SDD_PROJECT_ID falls back to hash when unset ===");
    const hashIdentity = repoIdentity(base);
    assertTrue(/^[0-9a-f]{12}$/.test(hashIdentity), "repoIdentity returns 12-char hex hash when SDD_PROJECT_ID is unset");

    console.log("\n=== readRepoMeta returns null for malformed metadata ===");
    {
      const malformedPath = join(stateDir, "projects", "malformed");
      mkdirSync(malformedPath, { recursive: true });
      writeFileSync(join(malformedPath, "repo-meta.json"), JSON.stringify({ version: 1 }) + "\n", "utf-8");
      assertEq(readRepoMeta(malformedPath), null, "malformed repo-meta.json is treated as unknown metadata");
    }

    console.log("\n=== ensureSddSymlink refreshes repo-meta gitRoot after repo move with fixed project id ===");
    {
      const moveRepo = realpathSync(mkdtempSync(join(tmpdir(), "sdd-repo-identity-move-")));
      run("git init -b main", moveRepo);
      run('git config user.name "Pi Test"', moveRepo);
      run('git config user.email "pi@example.com"', moveRepo);
      writeFileSync(join(moveRepo, "README.md"), "# Move Test Repo\n", "utf-8");
      run("git add README.md", moveRepo);
      run('git commit -m "chore: init move repo"', moveRepo);

      process.env.SDD_PROJECT_ID = "fixed-project";
      const fixedExternal = ensureSddSymlink(moveRepo);
      const before = readRepoMeta(fixedExternal);
      assertTrue(before !== null, "repo metadata exists before repo move");
      assertEq(normalizePath(before!.gitRoot), normalizePath(moveRepo), "repo metadata tracks current git root before move");

      const movedBaseRaw = join(tmpdir(), `sdd-repo-identity-moved-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      renameSync(moveRepo, movedBaseRaw);
      const movedBase = realpathSync(movedBaseRaw);
      const movedExternal = ensureSddSymlink(movedBase);
      assertEq(realpathSync(movedExternal), realpathSync(fixedExternal), "fixed project id keeps the same external state dir");

      const after = readRepoMeta(movedExternal);
      assertTrue(after !== null, "repo metadata exists after repo move");
      assertEq(normalizePath(after!.gitRoot), normalizePath(movedBase), "repo metadata gitRoot is refreshed to moved repo path");
      assertEq(after!.createdAt, before!.createdAt, "repo metadata preserves createdAt on refresh");

      rmSync(movedBase, { recursive: true, force: true });
      delete process.env.SDD_PROJECT_ID;
    }

    console.log("\n=== isInheritedRepo detects subdirectory of parent repo without .sdd (#1639) ===");
    {
      const parentRepo = realpathSync(mkdtempSync(join(tmpdir(), "sdd-inherited-parent-")));
      run("git init -b main", parentRepo);
      run('git config user.name "Pi Test"', parentRepo);
      run('git config user.email "pi@example.com"', parentRepo);
      writeFileSync(join(parentRepo, "README.md"), "# Parent\n", "utf-8");
      run("git add README.md", parentRepo);
      run('git commit -m "init"', parentRepo);

      // Create a subdirectory — no .sdd at parent
      const subdir = join(parentRepo, "newproject");
      mkdirSync(subdir, { recursive: true });
      assertTrue(isInheritedRepo(subdir), "subdirectory of parent repo without .sdd is inherited");

      // After adding .sdd at parent, subdirectory is a legitimate child
      mkdirSync(join(parentRepo, ".sdd"), { recursive: true });
      assertTrue(!isInheritedRepo(subdir), "subdirectory of parent repo WITH .sdd is NOT inherited");

      // The git root itself is never inherited
      assertTrue(!isInheritedRepo(parentRepo), "git root is not inherited");

      // A standalone repo (not a subdir) is not inherited
      const standaloneRepo = realpathSync(mkdtempSync(join(tmpdir(), "sdd-inherited-standalone-")));
      run("git init -b main", standaloneRepo);
      run('git config user.name "Pi Test"', standaloneRepo);
      run('git config user.email "pi@example.com"', standaloneRepo);
      assertTrue(!isInheritedRepo(standaloneRepo), "standalone repo is not inherited");

      rmSync(parentRepo, { recursive: true, force: true });
      rmSync(standaloneRepo, { recursive: true, force: true });
    }

    console.log("\n=== subdirectory of parent repo gets unique identity after git init (#1639) ===");
    {
      const parentRepo = realpathSync(mkdtempSync(join(tmpdir(), "sdd-identity-parent-")));
      run("git init -b main", parentRepo);
      run('git config user.name "Pi Test"', parentRepo);
      run('git config user.email "pi@example.com"', parentRepo);
      run('git remote add origin git@github.com:example/parent-project.git', parentRepo);
      writeFileSync(join(parentRepo, "README.md"), "# Parent\n", "utf-8");
      run("git add README.md", parentRepo);
      run('git commit -m "init"', parentRepo);

      const subdir = join(parentRepo, "childproject");
      mkdirSync(subdir, { recursive: true });

      // Before git init, subdirectory shares parent's identity
      const parentIdentity = repoIdentity(parentRepo);
      const subdirIdentityBefore = repoIdentity(subdir);
      assertEq(subdirIdentityBefore, parentIdentity, "subdirectory shares parent identity before its own git init");

      // After git init, subdirectory gets its own identity
      run("git init -b main", subdir);
      const subdirIdentityAfter = repoIdentity(subdir);
      assertTrue(subdirIdentityAfter !== parentIdentity, "subdirectory gets unique identity after git init");

      rmSync(parentRepo, { recursive: true, force: true });
    }

    console.log("\n=== validateProjectId rejects invalid values ===");
    for (const invalid of ["has spaces", "path/traversal", "dot..dot", "back\\slash"]) {
      assertTrue(!validateProjectId(invalid), `validateProjectId rejects invalid value: "${invalid}"`);
    }

    console.log("\n=== validateProjectId accepts valid values ===");
    for (const valid of ["my-project", "foo_bar", "abc123", "A-Z_0-9"]) {
      assertTrue(validateProjectId(valid), `validateProjectId accepts valid value: "${valid}"`);
    }
  } finally {
    delete process.env.SDD_PROJECT_ID;
    delete process.env.SDD_STATE_DIR;
    rmSync(base, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
    report();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
