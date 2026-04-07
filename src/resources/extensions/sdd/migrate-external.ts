/**
 * SDD External State Migration
 *
 * Migrates legacy in-project `.sdd/` directories to the external
 * `~/.sdd/projects/<hash>/` state directory. After migration, a
 * symlink replaces the original directory so all paths remain valid.
 */

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, cpSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { externalSddRoot, isInsideWorktree } from "./repo-identity.js";
import { getErrorMessage } from "./error-utils.js";
import { hasGitTrackedSddFiles } from "./gitignore.js";
import { GIT_NO_PROMPT_ENV } from "./git-constants.js";

export interface MigrationResult {
  migrated: boolean;
  error?: string;
}

/**
 * Migrate a legacy in-project `.sdd/` directory to external storage.
 *
 * Algorithm:
 * 1. If `<project>/.sdd` is a symlink or doesn't exist -> skip
 * 2. If `<project>/.sdd` is a real directory:
 *    a. Compute external path from repoIdentity
 *    b. mkdir -p external dir
 *    c. Rename `.sdd` -> `.sdd.migrating` (atomic on same FS, acts as lock)
 *    d. Copy contents to external dir (skip `worktrees/` subdirectory)
 *    e. Create symlink `.sdd -> external path`
 *    f. Remove `.sdd.migrating`
 * 3. On failure: rename `.sdd.migrating` back to `.sdd` (rollback)
 */
export function migrateToExternalState(basePath: string): MigrationResult {
  // Worktrees get their .sdd via syncSddStateToWorktree(), not migration.
  // Migration inside a worktree would compute the same external hash as the
  // main repo (externalSddRoot hashes remoteUrl + gitRoot), creating a broken
  // junction and orphaning .sdd.migrating (#2970).
  if (isInsideWorktree(basePath)) {
    return { migrated: false };
  }

  const localSdd = join(basePath, ".sdd");

  // Skip if doesn't exist
  if (!existsSync(localSdd)) {
    return { migrated: false };
  }

  // Skip if already a symlink
  try {
    const stat = lstatSync(localSdd);
    if (stat.isSymbolicLink()) {
      return { migrated: false };
    }
    if (!stat.isDirectory()) {
      return { migrated: false, error: ".sdd exists but is not a directory or symlink" };
    }
  } catch (err) {
    return { migrated: false, error: `Cannot stat .sdd: ${getErrorMessage(err)}` };
  }

  // Skip if .sdd/ contains git-tracked files — the project intentionally
  // keeps .sdd/ in version control and migration would destroy that.
  if (hasGitTrackedSddFiles(basePath)) {
    return { migrated: false };
  }

  // Skip if .sdd/worktrees/ has active worktree directories (#1337).
  // On Windows, active git worktrees hold OS-level directory handles that
  // prevent rename/delete. Attempting migration causes EBUSY and data loss.
  const worktreesDir = join(localSdd, "worktrees");
  if (existsSync(worktreesDir)) {
    try {
      const entries = readdirSync(worktreesDir, { withFileTypes: true });
      if (entries.some(e => e.isDirectory())) {
        return { migrated: false };
      }
    } catch {
      // Can't read worktrees dir — skip migration to be safe
      return { migrated: false };
    }
  }

  const externalPath = externalSddRoot(basePath);
  const migratingPath = join(basePath, ".sdd.migrating");

  try {
    // mkdir -p the external dir
    mkdirSync(externalPath, { recursive: true });

    // Rename .sdd -> .sdd.migrating (atomic lock).
    // On Windows, NTFS may reject rename with EPERM if file descriptors are
    // open (VS Code watchers, antivirus on-access scan). Fall back to
    // copy+delete (#1292).
    try {
      renameSync(localSdd, migratingPath);
    } catch (renameErr: any) {
      if (renameErr?.code === "EPERM" || renameErr?.code === "EBUSY") {
        try {
          cpSync(localSdd, migratingPath, { recursive: true, force: true });
          rmSync(localSdd, { recursive: true, force: true });
        } catch (copyErr) {
          return { migrated: false, error: `Migration rename/copy failed: ${copyErr instanceof Error ? copyErr.message : String(copyErr)}` };
        }
      } else {
        throw renameErr;
      }
    }

    // Copy contents to external dir, skipping worktrees/
    const entries = readdirSync(migratingPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "worktrees") continue; // worktrees stay local

      const src = join(migratingPath, entry.name);
      const dst = join(externalPath, entry.name);

      try {
        if (entry.isDirectory()) {
          cpSync(src, dst, { recursive: true, force: true });
        } else {
          cpSync(src, dst, { force: true });
        }
      } catch {
        // Non-fatal: continue with other files
      }
    }

    // Create symlink .sdd -> external path
    symlinkSync(externalPath, localSdd, "junction");

    // Verify the symlink resolves correctly before removing the backup (#1377).
    // On Windows, junction creation can silently succeed but resolve to the wrong
    // target, or the external dir may not be accessible. If verification fails,
    // restore from the backup.
    try {
      const resolved = realpathSync(localSdd);
      const resolvedExternal = realpathSync(externalPath);
      if (resolved !== resolvedExternal) {
        // Symlink points to wrong target — restore backup
        try { rmSync(localSdd, { force: true }); } catch { /* may not exist */ }
        renameSync(migratingPath, localSdd);
        return { migrated: false, error: `Migration verification failed: symlink resolves to ${resolved}, expected ${resolvedExternal}` };
      }
      // Verify we can read through the symlink
      readdirSync(localSdd);
    } catch (verifyErr) {
      // Symlink broken or unreadable — restore backup
      try { rmSync(localSdd, { force: true }); } catch { /* may not exist */ }
      try { renameSync(migratingPath, localSdd); } catch { /* best-effort restore */ }
      return { migrated: false, error: `Migration verification failed: ${getErrorMessage(verifyErr)}` };
    }

    // Clean the git index — any .sdd/* files tracked before migration now
    // sit behind the symlink and git can't follow it, causing them to show
    // as deleted. Remove them from the index so the working tree stays clean.
    // --ignore-unmatch makes this a no-op on fresh projects with no tracked .sdd/.
    try {
      execFileSync("git", ["rm", "-r", "--cached", "--ignore-unmatch", ".sdd"], {
        cwd: basePath,
        stdio: ["ignore", "pipe", "ignore"],
        env: GIT_NO_PROMPT_ENV,
        timeout: 10_000,
      });
    } catch {
      // Non-fatal — git may be unavailable or nothing was tracked
    }

    // Remove .sdd.migrating only after symlink is verified and index is clean
    rmSync(migratingPath, { recursive: true, force: true });

    return { migrated: true };
  } catch (err) {
    // Rollback: rename .sdd.migrating back to .sdd
    try {
      if (existsSync(migratingPath) && !existsSync(localSdd)) {
        renameSync(migratingPath, localSdd);
      }
    } catch {
      // Rollback failed -- leave .sdd.migrating for doctor to detect
    }

    return {
      migrated: false,
      error: `Migration failed: ${getErrorMessage(err)}`,
    };
  }
}

/**
 * Recover from a failed migration (`.sdd.migrating` exists).
 * Moves `.sdd.migrating` back to `.sdd` if `.sdd` doesn't exist.
 */
export function recoverFailedMigration(basePath: string): boolean {
  const localSdd = join(basePath, ".sdd");
  const migratingPath = join(basePath, ".sdd.migrating");

  if (!existsSync(migratingPath)) return false;
  if (existsSync(localSdd)) return false; // both exist -- ambiguous, don't touch

  try {
    renameSync(migratingPath, localSdd);
    return true;
  } catch {
    return false;
  }
}
