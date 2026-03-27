/**
 * SDD Auto-Worktree -- lifecycle management for auto-mode worktrees.
 *
 * Auto-mode creates worktrees with `milestone/<MID>` branches (distinct from
 * manual `/worktree` which uses `worktree/<name>` branches). This module
 * manages create, enter, detect, and teardown for auto-mode worktrees.
 */

import {
  existsSync,
  cpSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  lstatSync as lstatSyncFn,
} from "node:fs";
import { isAbsolute, join, sep as pathSep } from "node:path";
import { homedir } from "node:os";
import { SDDError, SDD_IO_ERROR, SDD_GIT_ERROR } from "./errors.js";
import {
  reconcileWorktreeDb,
  isDbAvailable,
  getMilestone,
  getMilestoneSlices,
} from "./sdd-db.js";
import { atomicWriteSync } from "./atomic-write.js";
import { execFileSync } from "node:child_process";
import { safeCopy, safeCopyRecursive } from "./safe-fs.js";
import { sddRoot } from "./paths.js";
import {
  createWorktree,
  removeWorktree,
  resolveGitDir,
  worktreePath,
} from "./worktree-manager.js";
import {
  detectWorktreeName,
  resolveGitHeadPath,
  nudgeGitBranchCache,
} from "./worktree.js";
import { MergeConflictError, readIntegrationBranch, RUNTIME_EXCLUSION_PATHS } from "./git-service.js";
import { debugLog } from "./debug-logger.js";
import { logWarning } from "./workflow-logger.js";
import { loadEffectiveSDDPreferences } from "./preferences.js";
import {
  nativeGetCurrentBranch,
  nativeDetectMainBranch,
  nativeWorkingTreeStatus,
  nativeAddAllWithExclusions,
  nativeCommit,
  nativeCheckoutBranch,
  nativeMergeSquash,
  nativeConflictFiles,
  nativeCheckoutTheirs,
  nativeAddPaths,
  nativeRmForce,
  nativeBranchDelete,
  nativeBranchExists,
  nativeDiffNumstat,
  nativeUpdateRef,
  nativeIsAncestor,
} from "./native-git-bridge.js";

const gsdHome = process.env.SDD_HOME || join(homedir(), ".sdd");

// ─── Shared Constants & Helpers ─────────────────────────────────────────────

/**
 * Root-level .sdd/ state files synced between worktree and project root.
 * Single source of truth — used by syncSddStateToWorktree, syncWorktreeStateBack,
 * and the dispatch-level sync functions.
 */
const ROOT_STATE_FILES = [
  "DECISIONS.md",
  "REQUIREMENTS.md",
  "PROJECT.md",
  "KNOWLEDGE.md",
  "OVERRIDES.md",
  "QUEUE.md",
  "completed-units.json",
  "metrics.json",
  // NOTE: preferences.md is intentionally NOT in ROOT_STATE_FILES.
  // Forward-sync (main → worktree) is handled explicitly in syncSddStateToWorktree().
  // Back-sync (worktree → main) must NEVER overwrite the project root's copy
  // because the project root is authoritative for preferences (#2684).
] as const;

/**
 * Check if two filesystem paths resolve to the same real location.
 * Returns false if either path cannot be resolved (e.g. doesn't exist).
 */
function isSamePath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

// ─── Module State ──────────────────────────────────────────────────────────

/** Original project root before chdir into auto-worktree. */
let originalBase: string | null = null;

function clearProjectRootStateFiles(basePath: string, milestoneId: string): void {
  const sddDir = sddRoot(basePath);
  const transientFiles = [
    join(sddDir, "STATE.md"),
    join(sddDir, "auto.lock"),
    join(sddDir, "milestones", milestoneId, `${milestoneId}-META.json`),
  ];

  for (const file of transientFiles) {
    try {
      unlinkSync(file);
    } catch {
      /* non-fatal — file may not exist */
    }
  }

  // Clean up entire synced milestone directory and runtime/units.
  // syncStateToProjectRoot() copies these into the project root during
  // execution.  If they remain as untracked files when we attempt
  // `git merge --squash`, git rejects the merge with "local changes would
  // be overwritten", causing silent data loss (#1738).
  const syncedDirs = [
    join(sddDir, "milestones", milestoneId),
    join(sddDir, "runtime", "units"),
  ];

  for (const dir of syncedDirs) {
    try {
      if (existsSync(dir)) {
        // Only remove files that are untracked by git — tracked files are
        // managed by the branch checkout and should not be deleted.
        const untrackedOutput = execFileSync(
          "git",
          ["ls-files", "--others", "--exclude-standard", dir],
          { cwd: basePath, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" },
        ).trim();
        if (untrackedOutput) {
          for (const f of untrackedOutput.split("\n").filter(Boolean)) {
            try {
              unlinkSync(join(basePath, f));
            } catch {
              /* non-fatal */
            }
          }
        }
      }
    } catch {
      /* non-fatal — git command may fail if not in repo */
    }
  }
}

// ─── Build Artifact Auto-Resolve ─────────────────────────────────────────────

/** Patterns for machine-generated build artifacts that can be safely
 * auto-resolved by accepting --theirs during merge. These files are
 * regenerable and never contain meaningful manual edits. */
export const SAFE_AUTO_RESOLVE_PATTERNS: RegExp[] = [
  /\.tsbuildinfo$/,
  /\.pyc$/,
  /\/__pycache__\//,
  /\.DS_Store$/,
  /\.map$/,
];

/** Returns true if the file path is safe to auto-resolve during merge.
 * Covers `.sdd/` state files and common build artifacts. */
export const isSafeToAutoResolve = (filePath: string): boolean =>
  filePath.startsWith(".sdd/") ||
  SAFE_AUTO_RESOLVE_PATTERNS.some((re) => re.test(filePath));

// ─── Dispatch-Level Sync (project root ↔ worktree) ──────────────────────────

/**
 * Sync milestone artifacts from project root INTO worktree before deriveState.
 * Covers the case where the LLM wrote artifacts to the main repo filesystem
 * (e.g. via absolute paths) but the worktree has stale data. Also deletes
 * sdd.db in the worktree so it rebuilds from fresh disk state (#853).
 * Non-fatal — sync failure should never block dispatch.
 */
export function syncProjectRootToWorktree(
  projectRoot: string,
  worktreePath_: string,
  milestoneId: string | null,
): void {
  if (!worktreePath_ || !projectRoot || worktreePath_ === projectRoot) return;
  if (!milestoneId) return;

  const prSdd = join(projectRoot, ".sdd");
  const wtSdd = join(worktreePath_, ".sdd");

  // Copy milestone directory from project root to worktree — additive only.
  // force:false prevents cpSync from overwriting existing worktree files.
  // Without this, worktree-authoritative files (e.g. VALIDATION.md written
  // by validate-milestone) get clobbered by stale project root copies,
  // causing an infinite re-validation loop (#1886).
  safeCopyRecursive(
    join(prSdd, "milestones", milestoneId),
    join(wtSdd, "milestones", milestoneId),
    { force: false },
  );

  // Forward-sync completed-units.json from project root to worktree.
  // Project root is authoritative for completion state after crash recovery;
  // without this, the worktree re-dispatches already-completed units (#1886).
  safeCopy(
    join(prSdd, "completed-units.json"),
    join(wtSdd, "completed-units.json"),
    { force: true },
  );

  // Delete worktree sdd.db so it rebuilds from the freshly synced files.
  // Stale DB rows are the root cause of the infinite skip loop (#853).
  try {
    const wtDb = join(wtSdd, "sdd.db");
    if (existsSync(wtDb)) {
      unlinkSync(wtDb);
    }
  } catch {
    /* non-fatal */
  }
}

/**
 * Sync dispatch-critical .sdd/ state files from worktree to project root.
 * Only runs when inside an auto-worktree (worktreePath differs from projectRoot).
 * Copies: STATE.md + active milestone directory (roadmap, slice plans, task summaries).
 * Non-fatal — sync failure should never block dispatch.
 */
export function syncStateToProjectRoot(
  worktreePath_: string,
  projectRoot: string,
  milestoneId: string | null,
): void {
  if (!worktreePath_ || !projectRoot || worktreePath_ === projectRoot) return;
  if (!milestoneId) return;

  const wtSdd = join(worktreePath_, ".sdd");
  const prSdd = join(projectRoot, ".sdd");

  // 1. STATE.md — the quick-glance status used by initial deriveState()
  safeCopy(join(wtSdd, "STATE.md"), join(prSdd, "STATE.md"), { force: true });

  // 2. Milestone directory — ROADMAP, slice PLANs, task summaries
  // Copy the entire milestone .sdd subtree so deriveState reads current checkboxes
  safeCopyRecursive(
    join(wtSdd, "milestones", milestoneId),
    join(prSdd, "milestones", milestoneId),
    { force: true },
  );

  // 3. metrics.json — session cost/token tracking (#2313).
  // Without this, metrics accumulated in the worktree are invisible from the
  // project root and never appear in the dashboard or skill-health reports.
  safeCopy(join(wtSdd, "metrics.json"), join(prSdd, "metrics.json"), { force: true });

  // 4. Runtime records — unit dispatch state used by selfHealRuntimeRecords().
  // Without this, a crash during a unit leaves the runtime record only in the
  // worktree. If the next session resolves basePath before worktree re-entry,
  // selfHeal can't find or clear the stale record (#769).
  safeCopyRecursive(
    join(wtSdd, "runtime", "units"),
    join(prSdd, "runtime", "units"),
    { force: true },
  );
}

// ─── Resource Staleness ───────────────────────────────────────────────────

/**
 * Read the resource version (semver) from the managed-resources manifest.
 * Uses sddVersion instead of syncedAt so that launching a second session
 * doesn't falsely trigger staleness (#804).
 */
export function readResourceVersion(): string | null {
  const agentDir =
    process.env.SDD_CODING_AGENT_DIR || join(gsdHome, "agent");
  const manifestPath = join(agentDir, "managed-resources.json");
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    return typeof manifest?.sddVersion === "string"
      ? manifest.sddVersion
      : null;
  } catch {
    return null;
  }
}

/**
 * Check if managed resources have been updated since session start.
 * Returns a warning message if stale, null otherwise.
 */
export function checkResourcesStale(
  versionOnStart: string | null,
): string | null {
  if (versionOnStart === null) return null;
  const current = readResourceVersion();
  if (current === null) return null;
  if (current !== versionOnStart) {
    return "SDD resources were updated since this session started. Restart sdd to load the new code.";
  }
  return null;
}

// ─── Stale Worktree Escape ────────────────────────────────────────────────

/**
 * Detect and escape a stale worktree cwd (#608).
 *
 * After milestone completion + merge, the worktree directory is removed but
 * the process cwd may still point inside `.sdd/worktrees/<MID>/`.
 * When a new session starts, `process.cwd()` is passed as `base` to startAuto
 * and all subsequent writes land in the wrong directory. This function detects
 * that scenario and chdir back to the project root.
 *
 * Returns the corrected base path.
 */
export function escapeStaleWorktree(base: string): string {
  // Direct layout: /.sdd/worktrees/
  const directMarker = `${pathSep}.sdd${pathSep}worktrees${pathSep}`;
  let idx = base.indexOf(directMarker);
  if (idx === -1) {
    // Symlink-resolved layout: /.sdd/projects/<hash>/worktrees/
    const symlinkRe = new RegExp(
      `\\${pathSep}\\.sdd\\${pathSep}projects\\${pathSep}[a-f0-9]+\\${pathSep}worktrees\\${pathSep}`,
    );
    const match = base.match(symlinkRe);
    if (!match || match.index === undefined) return base;
    idx = match.index;
  }

  // base is inside .sdd/worktrees/<something> — extract the project root
  const projectRoot = base.slice(0, idx);

  // Guard: If the candidate project root's .sdd IS the user-level ~/.sdd,
  // the string-slice heuristic matched the wrong /.sdd/ boundary. This happens
  // when .sdd is a symlink into ~/.sdd/projects/<hash> and process.cwd()
  // resolved through the symlink. Returning ~ would be catastrophic (#1676).
  const candidateSdd = join(projectRoot, ".sdd").replaceAll("\\", "/");
  const gsdHomePath = gsdHome.replaceAll("\\", "/");
  if (candidateSdd === gsdHomePath || candidateSdd.startsWith(gsdHomePath + "/")) {
    // Don't chdir to home — return base unchanged.
    // resolveProjectRoot() in worktree.ts has the full git-file-based recovery
    // and will be called by the caller (startAuto → projectRoot()).
    return base;
  }

  try {
    process.chdir(projectRoot);
  } catch {
    // If chdir fails, return the original — caller will handle errors downstream
    return base;
  }
  return projectRoot;
}

/**
 * Clean stale runtime unit files for completed milestones.
 *
 * After restart, stale runtime/units/*.json from prior milestones can
 * cause deriveState to resume the wrong milestone (#887). Removes files
 * for milestones that have a SUMMARY (fully complete).
 */
export function cleanStaleRuntimeUnits(
  sddRootPath: string,
  hasMilestoneSummary: (mid: string) => boolean,
): number {
  const runtimeUnitsDir = join(sddRootPath, "runtime", "units");
  if (!existsSync(runtimeUnitsDir)) return 0;

  let cleaned = 0;
  try {
    for (const file of readdirSync(runtimeUnitsDir)) {
      if (!file.endsWith(".json")) continue;
      const midMatch = file.match(/(M\d+(?:-[a-z0-9]{6})?)/);
      if (!midMatch) continue;
      if (hasMilestoneSummary(midMatch[1])) {
        try {
          unlinkSync(join(runtimeUnitsDir, file));
          cleaned++;
        } catch {
          /* non-fatal */
        }
      }
    }
  } catch {
    /* non-fatal */
  }
  return cleaned;
}

// ─── Worktree ↔ Main Repo Sync (#1311) ──────────────────────────────────────

/**
 * Sync .sdd/ state from the main repo into the worktree.
 *
 * When .sdd/ is a symlink to the external state directory, both the main
 * repo and worktree share the same directory — no sync needed.
 *
 * When .sdd/ is a real directory (e.g., git-tracked or manage_gitignore:false),
 * the worktree has its own copy that may be stale. This function copies
 * missing milestones, CONTEXT, ROADMAP, DECISIONS, REQUIREMENTS, and
 * PROJECT files from the main repo's .sdd/ into the worktree's .sdd/.
 *
 * Only adds missing content — never overwrites existing files in the worktree
 * (the worktree's execution state is authoritative for in-progress work).
 */
export function syncSddStateToWorktree(
  mainBasePath: string,
  worktreePath_: string,
): { synced: string[] } {
  const mainSdd = sddRoot(mainBasePath);
  const wtSdd = sddRoot(worktreePath_);
  const synced: string[] = [];

  // If both resolve to the same directory (symlink), no sync needed
  if (isSamePath(mainSdd, wtSdd)) return { synced };

  if (!existsSync(mainSdd) || !existsSync(wtSdd)) return { synced };

  // Sync root-level .sdd/ files (DECISIONS, REQUIREMENTS, PROJECT, KNOWLEDGE, etc.)
  for (const f of ROOT_STATE_FILES) {
    const src = join(mainSdd, f);
    const dst = join(wtSdd, f);
    if (existsSync(src) && !existsSync(dst)) {
      try {
        cpSync(src, dst);
        synced.push(f);
      } catch {
        /* non-fatal */
      }
    }
  }

  // Forward-sync preferences.md from project root to worktree (additive only).
  // NOT in ROOT_STATE_FILES because syncWorktreeStateBack() must never overwrite
  // the project root's preferences — the project root is authoritative (#2684).
  {
    const src = join(mainSdd, "preferences.md");
    const dst = join(wtSdd, "preferences.md");
    if (existsSync(src) && !existsSync(dst)) {
      try {
        cpSync(src, dst);
        synced.push("preferences.md");
      } catch {
        /* non-fatal */
      }
    }
  }

  // Sync milestones: copy entire milestone directories that are missing
  const mainMilestonesDir = join(mainSdd, "milestones");
  const wtMilestonesDir = join(wtSdd, "milestones");
  if (existsSync(mainMilestonesDir)) {
    try {
      mkdirSync(wtMilestonesDir, { recursive: true });
      const mainMilestones = readdirSync(mainMilestonesDir, {
        withFileTypes: true,
      })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const mid of mainMilestones) {
        const srcDir = join(mainMilestonesDir, mid);
        const dstDir = join(wtMilestonesDir, mid);

        if (!existsSync(dstDir)) {
          // Entire milestone missing from worktree — copy it
          try {
            cpSync(srcDir, dstDir, { recursive: true });
            synced.push(`milestones/${mid}/`);
          } catch {
            /* non-fatal */
          }
        } else {
          // Milestone directory exists but may be missing files (stale snapshot).
          // Sync individual top-level milestone files (CONTEXT, ROADMAP, RESEARCH, etc.)
          try {
            const srcFiles = readdirSync(srcDir).filter(
              (f) => f.endsWith(".md") || f.endsWith(".json"),
            );
            for (const f of srcFiles) {
              const srcFile = join(srcDir, f);
              const dstFile = join(dstDir, f);
              if (!existsSync(dstFile)) {
                try {
                  const srcStat = lstatSyncFn(srcFile);
                  if (srcStat.isFile()) {
                    cpSync(srcFile, dstFile);
                    synced.push(`milestones/${mid}/${f}`);
                  }
                } catch {
                  /* non-fatal */
                }
              }
            }

            // Sync slices directory if it exists in main but not in worktree
            const srcSlicesDir = join(srcDir, "slices");
            const dstSlicesDir = join(dstDir, "slices");
            if (existsSync(srcSlicesDir) && !existsSync(dstSlicesDir)) {
              try {
                cpSync(srcSlicesDir, dstSlicesDir, { recursive: true });
                synced.push(`milestones/${mid}/slices/`);
              } catch {
                /* non-fatal */
              }
            } else if (existsSync(srcSlicesDir) && existsSync(dstSlicesDir)) {
              // Both exist — sync missing slice directories
              const srcSlices = readdirSync(srcSlicesDir, {
                withFileTypes: true,
              })
                .filter((d) => d.isDirectory())
                .map((d) => d.name);
              for (const sid of srcSlices) {
                const srcSlice = join(srcSlicesDir, sid);
                const dstSlice = join(dstSlicesDir, sid);
                if (!existsSync(dstSlice)) {
                  try {
                    cpSync(srcSlice, dstSlice, { recursive: true });
                    synced.push(`milestones/${mid}/slices/${sid}/`);
                  } catch {
                    /* non-fatal */
                  }
                }
              }
            }
          } catch {
            /* non-fatal */
          }
        }
      }
    } catch {
      /* non-fatal */
    }
  }

  return { synced };
}

/**
 * Sync milestone artifacts from worktree back to the main external state directory.
 * Called before milestone merge to ensure completion artifacts (SUMMARY, VALIDATION,
 * updated ROADMAP) are visible from the project root (#1412).
 *
 * Syncs:
 *   1. Root-level .sdd/ files (REQUIREMENTS, PROJECT, DECISIONS, KNOWLEDGE,
 *      OVERRIDES) — the worktree's versions overwrite main's because the
 *      worktree is the authoritative execution context.
 *   2. ALL milestone directories found in the worktree — not just the
 *      current milestoneId. The complete-milestone unit may create artifacts
 *      for the *next* milestone (CONTEXT, ROADMAP, new requirements) which
 *      must survive worktree teardown.
 *
 * History: Originally only synced milestones/<milestoneId>/ and assumed
 * root-level files would be carried by the squash merge. In practice,
 * .sdd/ files are often untracked (gitignored or never committed), so the
 * squash merge carries nothing. This caused next-milestone artifacts and
 * updated REQUIREMENTS/PROJECT to be silently lost on teardown.
 */
export function syncWorktreeStateBack(
  mainBasePath: string,
  worktreePath: string,
  milestoneId: string,
): { synced: string[] } {
  const mainSdd = sddRoot(mainBasePath);
  const wtSdd = sddRoot(worktreePath);
  const synced: string[] = [];

  // If both resolve to the same directory (symlink), no sync needed
  if (isSamePath(mainSdd, wtSdd)) return { synced };

  if (!existsSync(wtSdd) || !existsSync(mainSdd)) return { synced };

  // ── 0. Pre-upgrade worktree DB reconciliation ────────────────────────
  // If the worktree has its own sdd.db (copied before the WAL transition),
  // reconcile its hierarchy data into the project root DB before syncing
  // files. This handles in-flight worktrees that were created before the
  // upgrade to shared WAL mode.
  const wtLocalDb = join(wtSdd, "sdd.db");
  const mainDb = join(mainSdd, "sdd.db");
  if (existsSync(wtLocalDb) && existsSync(mainDb)) {
    try {
      reconcileWorktreeDb(mainDb, wtLocalDb);
      synced.push("sdd.db (pre-upgrade reconcile)");
    } catch {
      // Non-fatal — file sync below is the fallback
    }
  }

  // ── 1. Sync root-level .sdd/ files back ──────────────────────────────
  // The worktree is authoritative — complete-milestone updates REQUIREMENTS,
  // PROJECT, etc. These must overwrite main's copies so they survive teardown.
  // Also includes QUEUE.md, completed-units.json, and metrics.json which are
  // written during milestone closeout and lost on teardown without explicit sync
  // (#1787, #2313).
  for (const f of ROOT_STATE_FILES) {
    const src = join(wtSdd, f);
    const dst = join(mainSdd, f);
    if (existsSync(src)) {
      try {
        cpSync(src, dst, { force: true });
        synced.push(f);
      } catch {
        /* non-fatal */
      }
    }
  }

  // ── 2. Sync ALL milestone directories ────────────────────────────────
  // The complete-milestone unit may create next-milestone artifacts (e.g.
  // M007 setup while closing M006). We must sync every milestone directory
  // in the worktree, not just the current one.
  const wtMilestonesDir = join(wtSdd, "milestones");
  if (!existsSync(wtMilestonesDir)) return { synced };

  try {
    const wtMilestones = readdirSync(wtMilestonesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const mid of wtMilestones) {
      syncMilestoneDir(wtSdd, mainSdd, mid, synced);
    }
  } catch {
    /* non-fatal */
  }

  return { synced };
}

/**
 * Sync a single milestone directory from worktree to main.
 * Copies milestone-level .md files, slice-level files, and task summaries.
 */
/** Copy matching files from srcDir to dstDir (non-fatal per file). */
function syncDirFiles(
  srcDir: string,
  dstDir: string,
  filter: (name: string) => boolean,
  synced: string[],
  prefix: string,
): void {
  try {
    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
      if (!entry.isFile() || !filter(entry.name)) continue;
      try {
        cpSync(join(srcDir, entry.name), join(dstDir, entry.name), { force: true });
        synced.push(`${prefix}${entry.name}`);
      } catch {
        /* non-fatal */
      }
    }
  } catch {
    /* non-fatal — srcDir may not be readable */
  }
}

function syncMilestoneDir(
  wtSdd: string,
  mainSdd: string,
  mid: string,
  synced: string[],
): void {
  const wtMilestoneDir = join(wtSdd, "milestones", mid);
  const mainMilestoneDir = join(mainSdd, "milestones", mid);

  if (!existsSync(wtMilestoneDir)) return;
  mkdirSync(mainMilestoneDir, { recursive: true });

  const isMd = (name: string): boolean => name.endsWith(".md");

  // Sync milestone-level files (SUMMARY, VALIDATION, ROADMAP, CONTEXT)
  syncDirFiles(wtMilestoneDir, mainMilestoneDir, isMd, synced, `milestones/${mid}/`);

  // Sync slice-level files (summaries, UATs) and task summaries (#1678)
  const wtSlicesDir = join(wtMilestoneDir, "slices");
  const mainSlicesDir = join(mainMilestoneDir, "slices");
  if (!existsSync(wtSlicesDir)) return;

  try {
    for (const sliceEntry of readdirSync(wtSlicesDir, { withFileTypes: true })) {
      if (!sliceEntry.isDirectory()) continue;
      const sid = sliceEntry.name;
      const wtSliceDir = join(wtSlicesDir, sid);
      const mainSliceDir = join(mainSlicesDir, sid);
      mkdirSync(mainSliceDir, { recursive: true });

      syncDirFiles(wtSliceDir, mainSliceDir, isMd, synced, `milestones/${mid}/slices/${sid}/`);

      const wtTasksDir = join(wtSliceDir, "tasks");
      const mainTasksDir = join(mainSliceDir, "tasks");
      if (existsSync(wtTasksDir)) {
        mkdirSync(mainTasksDir, { recursive: true });
        syncDirFiles(wtTasksDir, mainTasksDir, isMd, synced, `milestones/${mid}/slices/${sid}/tasks/`);
      }
    }
  } catch {
    /* non-fatal */
  }
}
// ─── Worktree Post-Create Hook (#597) ────────────────────────────────────────

/**
 * Run the user-configured post-create hook script after worktree creation.
 * The script receives SOURCE_DIR and WORKTREE_DIR as environment variables.
 * Failure is non-fatal — returns the error message or null on success.
 *
 * Reads the hook path from git.worktree_post_create in preferences.
 * Pass hookPath directly to bypass preference loading (useful for testing).
 */
export function runWorktreePostCreateHook(
  sourceDir: string,
  worktreeDir: string,
  hookPath?: string,
): string | null {
  if (hookPath === undefined) {
    const prefs = loadEffectiveSDDPreferences()?.preferences?.git;
    hookPath = prefs?.worktree_post_create;
  }
  if (!hookPath) return null;

  // Resolve relative paths against the source project root.
  // On Windows, convert 8.3 short paths (e.g. RUNNER~1) to long paths
  // so execFileSync can locate the file correctly.
  let resolved = isAbsolute(hookPath) ? hookPath : join(sourceDir, hookPath);
  if (!existsSync(resolved)) {
    return `Worktree post-create hook not found: ${resolved}`;
  }
  if (process.platform === "win32") {
    try { resolved = realpathSync.native(resolved); } catch { /* keep original */ }
  }

  try {
    // .bat/.cmd files on Windows require shell mode — execFileSync cannot
    // spawn them directly (EINVAL).
    const needsShell = process.platform === "win32" && /\.(bat|cmd)$/i.test(resolved);
    execFileSync(resolved, [], {
      cwd: worktreeDir,
      env: {
        ...process.env,
        SOURCE_DIR: sourceDir,
        WORKTREE_DIR: worktreeDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 30_000, // 30 second timeout
      shell: needsShell,
    });
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Worktree post-create hook failed: ${msg}`;
  }
}

// ─── Auto-Worktree Branch Naming ───────────────────────────────────────────

export function autoWorktreeBranch(milestoneId: string): string {
  return `milestone/${milestoneId}`;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Create a new auto-worktree for a milestone, chdir into it, and store
 * the original base path for later teardown.
 *
 * Atomic: chdir + originalBase update happen in the same try block
 * to prevent split-brain.
 */

/**
 * Forward-merge plan checkbox state from the project root into a freshly
 * re-attached worktree (#778).
 *
 * When auto-mode stops via crash (not graceful stop), the milestone branch
 * HEAD may be behind the filesystem state at the project root because
 * syncStateToProjectRoot() runs after every task completion but the final
 * git commit may not have happened before the crash. On restart the worktree
 * is re-attached to the branch HEAD, which has [ ] for the crashed task,
 * causing verifyExpectedArtifact() to fail and triggering an infinite
 * dispatch/skip loop.
 *
 * Fix: after re-attaching, read every *.md plan file in the milestone
 * directory at the project root and apply any [x] checkbox states that are
 * ahead of the worktree version (forward-only: never downgrade [x] → [ ]).
 *
 * This is safe because syncStateToProjectRoot() is the authoritative source
 * of post-task state at the project root — it writes the same [x] the LLM
 * produced, then the auto-commit follows. If the commit never happened, the
 * filesystem copy is still valid and correct.
 */
function reconcilePlanCheckboxes(
  projectRoot: string,
  wtPath: string,
  milestoneId: string,
): void {
  const srcMilestone = join(projectRoot, ".sdd", "milestones", milestoneId);
  const dstMilestone = join(wtPath, ".sdd", "milestones", milestoneId);
  if (!existsSync(srcMilestone) || !existsSync(dstMilestone)) return;

  // Walk all markdown files in the milestone directory (plans, summaries, etc.)
  function walkMd(dir: string): string[] {
    const results: string[] = [];
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...walkMd(full));
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          results.push(full);
        }
      }
    } catch {
      /* non-fatal */
    }
    return results;
  }

  for (const srcFile of walkMd(srcMilestone)) {
    const rel = srcFile.slice(srcMilestone.length);
    const dstFile = dstMilestone + rel;
    if (!existsSync(dstFile)) continue; // only reconcile existing files

    let srcContent: string;
    let dstContent: string;
    try {
      srcContent = readFileSync(srcFile, "utf-8");
      dstContent = readFileSync(dstFile, "utf-8");
    } catch {
      continue;
    }

    if (srcContent === dstContent) continue;

    // Extract all checked task IDs from the source (project root)
    // Pattern: - [x] **T<id>: or - [x] **S<id>: (case-insensitive x)
    const checkedRe = /^- \[[xX]\] \*\*([TS]\d+):/gm;
    const srcChecked = new Set<string>();
    for (const m of srcContent.matchAll(checkedRe)) srcChecked.add(m[1]);

    if (srcChecked.size === 0) continue;

    // Forward-apply: replace [ ] → [x] for any IDs that are checked in src
    let updated = dstContent;
    let changed = false;
    for (const id of srcChecked) {
      const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const uncheckedRe = new RegExp(
        `^(- )\\[ \\]( \\*\\*${escapedId}:)`,
        "gm",
      );
      if (uncheckedRe.test(updated)) {
        updated = updated.replace(
          new RegExp(`^(- )\\[ \\]( \\*\\*${escapedId}:)`, "gm"),
          "$1[x]$2",
        );
        changed = true;
      }
    }

    if (changed) {
      try {
        atomicWriteSync(dstFile, updated, "utf-8");
      } catch {
        /* non-fatal */
      }
    }
  }
}

export function createAutoWorktree(
  basePath: string,
  milestoneId: string,
): string {
  const branch = autoWorktreeBranch(milestoneId);

  // Check if the milestone branch already exists — it survives auto-mode
  // stop/pause and contains committed work from prior sessions. If it exists,
  // re-attach the worktree to it WITHOUT resetting. Only create a fresh branch
  // from the integration branch when no prior work exists.
  const branchExists = nativeBranchExists(basePath, branch);

  let info: { name: string; path: string; branch: string; exists: boolean };
  if (branchExists) {
    // Re-attach worktree to the existing milestone branch (preserving commits)
    info = createWorktree(basePath, milestoneId, {
      branch,
      reuseExistingBranch: true,
    });
  } else {
    // Fresh start — create branch from integration branch
    const integrationBranch =
      readIntegrationBranch(basePath, milestoneId) ?? undefined;
    info = createWorktree(basePath, milestoneId, {
      branch,
      startPoint: integrationBranch,
    });
  }

  // Copy .sdd/ planning artifacts from the source repo into the new worktree.
  // Worktrees are fresh git checkouts — untracked files don't carry over.
  // Planning artifacts may be untracked if the project's .gitignore had a
  // blanket .sdd/ rule (pre-v2.14.0). Without this copy, auto-mode loops
  // on plan-slice because the plan file doesn't exist in the worktree.
  //
  // IMPORTANT: Skip when re-attaching to an existing branch (#759).
  // The branch checkout already has committed artifacts with correct state
  // (e.g. [x] for completed slices). Copying from the project root would
  // overwrite them with stale data ([ ] checkboxes) because the root is
  // not always fully synced.
  if (!branchExists) {
    copyPlanningArtifacts(basePath, info.path);
  } else {
    // Re-attaching to an existing branch: forward-merge any plan checkpoint
    // state from the project root into the worktree (#778).
    //
    // If auto-mode stopped via crash, the milestone branch HEAD may lag behind
    // the project root filesystem because syncStateToProjectRoot() ran after
    // task completion but the auto-commit never fired. On restart the worktree
    // is re-created from the branch HEAD (which has [ ] for the crashed task),
    // causing verifyExpectedArtifact() to return false → stale-key eviction →
    // infinite dispatch/skip loop. Reconciling here ensures the worktree sees
    // the same [x] state that syncStateToProjectRoot() wrote to the root.
    reconcilePlanCheckboxes(basePath, info.path, milestoneId);
  }

  // Run user-configured post-create hook (#597) — e.g. copy .env, symlink assets
  const hookError = runWorktreePostCreateHook(basePath, info.path);
  if (hookError) {
    // Non-fatal — log but don't prevent worktree usage
    logWarning("reconcile", hookError, { worktree: info.name });
  }

  const previousCwd = process.cwd();

  try {
    process.chdir(info.path);
    originalBase = basePath;
  } catch (err) {
    // If chdir fails, the worktree was created but we couldn't enter it.
    // Don't store originalBase -- caller can retry or clean up.
    throw new SDDError(
      SDD_IO_ERROR,
      `Auto-worktree created at ${info.path} but chdir failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  nudgeGitBranchCache(previousCwd);
  return info.path;
}

/**
 * Copy .sdd/ planning artifacts from source repo to a new worktree.
 * Copies milestones/, DECISIONS.md, REQUIREMENTS.md, PROJECT.md, QUEUE.md,
 * STATE.md, KNOWLEDGE.md, and OVERRIDES.md.
 * Skips runtime files (auto.lock, metrics.json, etc.) and the worktrees/ dir.
 * Best-effort — failures are non-fatal since auto-mode can recreate artifacts.
 */
function copyPlanningArtifacts(srcBase: string, wtPath: string): void {
  const srcSdd = join(srcBase, ".sdd");
  const dstSdd = join(wtPath, ".sdd");
  if (!existsSync(srcSdd)) return;

  // Copy milestones/ directory (planning files, roadmaps, plans, research)
  safeCopyRecursive(join(srcSdd, "milestones"), join(dstSdd, "milestones"), {
    force: true,
    filter: (src) => !src.endsWith("-META.json"),
  });

  // Copy top-level planning files
  for (const file of [
    "DECISIONS.md",
    "REQUIREMENTS.md",
    "PROJECT.md",
    "QUEUE.md",
    "STATE.md",
    "KNOWLEDGE.md",
    "OVERRIDES.md",
    "preferences.md",
  ]) {
    safeCopy(join(srcSdd, file), join(dstSdd, file), { force: true });
  }

  // Shared WAL (R012): worktrees use the project root's DB directly.
  // No longer copy sdd.db into the worktree — the DB path resolver in
  // ensureDbOpen() detects the worktree location and opens the root DB.
  // Compat note: reconcileWorktreeDb() in mergeMilestoneToMain handles
  // worktrees that already have a local sdd.db from before this change.
}

/**
 * Teardown an auto-worktree: chdir back to original base, then remove
 * the worktree and its branch.
 */
export function teardownAutoWorktree(
  originalBasePath: string,
  milestoneId: string,
  opts: { preserveBranch?: boolean } = {},
): void {
  const branch = autoWorktreeBranch(milestoneId);
  const { preserveBranch = false } = opts;
  const previousCwd = process.cwd();

  try {
    process.chdir(originalBasePath);
    originalBase = null;
  } catch (err) {
    throw new SDDError(
      SDD_IO_ERROR,
      `Failed to chdir back to ${originalBasePath} during teardown: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  nudgeGitBranchCache(previousCwd);
  removeWorktree(originalBasePath, milestoneId, {
    branch,
    deleteBranch: !preserveBranch,
  });

  // Verify cleanup succeeded — warn if the worktree directory is still on disk.
  // On Windows, bash-based cleanup can silently fail when paths contain
  // backslashes (#1436), leaving ~1 GB+ orphaned directories.
  const wtDir = worktreePath(originalBasePath, milestoneId);
  if (existsSync(wtDir)) {
    logWarning(
      "reconcile",
      `Worktree directory still exists after teardown: ${wtDir}. ` +
        `This is likely an orphaned directory consuming disk space. ` +
        `Remove it manually with: rm -rf "${wtDir.replaceAll("\\", "/")}"`,
      { worktree: milestoneId },
    );
    // Attempt a direct filesystem removal as a fallback
    try {
      rmSync(wtDir, { recursive: true, force: true });
    } catch {
      // Non-fatal — the warning above tells the user how to clean up
    }
  }
}

/**
 * Detect if the process is currently inside an auto-worktree.
 * Checks both module state and git branch prefix.
 */
export function isInAutoWorktree(basePath: string): boolean {
  if (!originalBase) return false;
  const cwd = process.cwd();
  const resolvedBase = existsSync(basePath) ? realpathSync(basePath) : basePath;
  const wtDir = join(resolvedBase, ".sdd", "worktrees");
  if (!cwd.startsWith(wtDir)) return false;
  const branch = nativeGetCurrentBranch(cwd);
  return branch.startsWith("milestone/");
}

/**
 * Get the filesystem path for an auto-worktree, or null if it doesn't exist
 * or is not a valid git worktree.
 *
 * Validates that the path is a real git worktree (has a .git file with a
 * gitdir: pointer) rather than just a stray directory. This prevents
 * mis-detection of leftover directories as active worktrees (#695).
 */
export function getAutoWorktreePath(
  basePath: string,
  milestoneId: string,
): string | null {
  const p = worktreePath(basePath, milestoneId);
  if (!existsSync(p)) return null;

  // Validate this is a real git worktree, not a stray directory.
  // A git worktree has a .git *file* (not directory) containing "gitdir: <path>".
  const gitPath = join(p, ".git");
  if (!existsSync(gitPath)) return null;
  try {
    const content = readFileSync(gitPath, "utf8").trim();
    if (!content.startsWith("gitdir: ")) return null;
  } catch {
    return null;
  }

  return p;
}

/**
 * Enter an existing auto-worktree (chdir into it, store originalBase).
 * Use for resume -- the worktree already exists from a prior create.
 *
 * Atomic: chdir + originalBase update in same try block.
 */
export function enterAutoWorktree(
  basePath: string,
  milestoneId: string,
): string {
  const p = worktreePath(basePath, milestoneId);
  if (!existsSync(p)) {
    throw new SDDError(
      SDD_IO_ERROR,
      `Auto-worktree for ${milestoneId} does not exist at ${p}`,
    );
  }

  // Validate this is a real git worktree, not a stray directory (#695)
  const gitPath = join(p, ".git");
  if (!existsSync(gitPath)) {
    throw new SDDError(
      SDD_GIT_ERROR,
      `Auto-worktree path ${p} exists but is not a git worktree (no .git)`,
    );
  }
  try {
    const content = readFileSync(gitPath, "utf8").trim();
    if (!content.startsWith("gitdir: ")) {
      throw new SDDError(
        SDD_GIT_ERROR,
        `Auto-worktree path ${p} has a .git but it is not a worktree gitdir pointer`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("worktree")) throw err;
    throw new SDDError(
      SDD_IO_ERROR,
      `Auto-worktree path ${p} exists but .git is unreadable`,
    );
  }

  const previousCwd = process.cwd();

  try {
    process.chdir(p);
    originalBase = basePath;
  } catch (err) {
    throw new SDDError(
      SDD_IO_ERROR,
      `Failed to enter auto-worktree at ${p}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  nudgeGitBranchCache(previousCwd);
  return p;
}

/**
 * Get the original project root stored when entering an auto-worktree.
 * Returns null if not currently in an auto-worktree.
 */
export function getAutoWorktreeOriginalBase(): string | null {
  return originalBase;
}

export function getActiveAutoWorktreeContext(): {
  originalBase: string;
  worktreeName: string;
  branch: string;
} | null {
  if (!originalBase) return null;
  const cwd = process.cwd();
  const resolvedBase = existsSync(originalBase)
    ? realpathSync(originalBase)
    : originalBase;
  const wtDir = join(resolvedBase, ".sdd", "worktrees");
  if (!cwd.startsWith(wtDir)) return null;
  const worktreeName = detectWorktreeName(cwd);
  if (!worktreeName) return null;
  const branch = nativeGetCurrentBranch(cwd);
  if (!branch.startsWith("milestone/")) return null;
  return {
    originalBase,
    worktreeName,
    branch,
  };
}

// ─── Merge Milestone -> Main ───────────────────────────────────────────────

/**
 * Auto-commit any dirty (uncommitted) state in the given directory.
 * Returns true if a commit was made, false if working tree was clean.
 */
function autoCommitDirtyState(cwd: string): boolean {
  try {
    const status = nativeWorkingTreeStatus(cwd);
    if (!status) return false;
    nativeAddAllWithExclusions(cwd, RUNTIME_EXCLUSION_PATHS);
    const result = nativeCommit(
      cwd,
      "chore: auto-commit before milestone merge",
    );
    return result !== null;
  } catch (e) {
    debugLog("autoCommitDirtyState", { error: String(e) });
    return false;
  }
}

/**
 * Squash-merge the milestone branch into main with a rich commit message
 * listing all completed slices, then tear down the worktree.
 *
 * Sequence:
 *  1. Auto-commit dirty worktree state
 *  2. chdir to originalBasePath
 *  3. git checkout main
 *  4. git merge --squash milestone/<MID>
 *  5. git commit with rich message
 *  6. Auto-push if enabled
 *  7. Delete milestone branch
 *  8. Remove worktree directory
 *  9. Clear originalBase
 *
 * On merge conflict: throws MergeConflictError.
 * On "nothing to commit" after squash: safe only if milestone work is already
 * on the integration branch.  Throws if unanchored code changes would be lost.
 */
export function mergeMilestoneToMain(
  originalBasePath_: string,
  milestoneId: string,
  roadmapContent: string,
): { commitMessage: string; pushed: boolean; prCreated: boolean; codeFilesChanged: boolean } {
  const worktreeCwd = process.cwd();
  const milestoneBranch = autoWorktreeBranch(milestoneId);

  // 1. Auto-commit dirty state in worktree before leaving
  autoCommitDirtyState(worktreeCwd);

  // Reconcile worktree DB into main DB before leaving worktree context
  if (isDbAvailable()) {
    try {
      const worktreeDbPath = join(worktreeCwd, ".sdd", "sdd.db");
      const mainDbPath = join(originalBasePath_, ".sdd", "sdd.db");
      reconcileWorktreeDb(mainDbPath, worktreeDbPath);
    } catch {
      /* non-fatal */
    }
  }

  // 2. Get completed slices for commit message
  let completedSlices: { id: string; title: string }[] = [];
  if (isDbAvailable()) {
    completedSlices = getMilestoneSlices(milestoneId)
      .filter(s => s.status === "complete")
      .map(s => ({ id: s.id, title: s.title }));
  }
  // Fallback: parse roadmap content when DB is unavailable
  if (completedSlices.length === 0 && roadmapContent) {
    const sliceRe = /- \[x\] \*\*(\w+):\s*(.+?)\*\*/gi;
    let m: RegExpExecArray | null;
    while ((m = sliceRe.exec(roadmapContent)) !== null) {
      completedSlices.push({ id: m[1], title: m[2] });
    }
  }

  // 3. chdir to original base
  const previousCwd = process.cwd();
  process.chdir(originalBasePath_);

  // 4. Resolve integration branch — prefer milestone metadata, then preferences,
  //    then auto-detect (origin/HEAD → main → master → current). Never hardcode
  //    "main": repos using "master" or a custom default branch would fail at
  //    checkout and leave the user with a broken merge state (#1668).
  const prefs = loadEffectiveSDDPreferences()?.preferences?.git ?? {};
  const integrationBranch = readIntegrationBranch(
    originalBasePath_,
    milestoneId,
  );
  const mainBranch =
    integrationBranch ?? prefs.main_branch ?? nativeDetectMainBranch(originalBasePath_);

  // Remove transient project-root state files before any branch or merge
  // operation. Untracked milestone metadata can otherwise block squash merges.
  clearProjectRootStateFiles(originalBasePath_, milestoneId);

  // 5. Checkout integration branch (skip if already current — avoids git error
  //    when main is already checked out in the project-root worktree, #757)
  const currentBranchAtBase = nativeGetCurrentBranch(originalBasePath_);
  if (currentBranchAtBase !== mainBranch) {
    nativeCheckoutBranch(originalBasePath_, mainBranch);
  }

  // 6. Build rich commit message
  const dbMilestone = getMilestone(milestoneId);
  let milestoneTitle =
    (dbMilestone?.title ?? "").replace(/^M\d+:\s*/, "").trim();
  // Fallback: parse title from roadmap content header (e.g. "# M020: Backend foundation")
  if (!milestoneTitle && roadmapContent) {
    const titleMatch = roadmapContent.match(new RegExp(`^#\\s+${milestoneId}:\\s*(.+)`, "m"));
    if (titleMatch) milestoneTitle = titleMatch[1].trim();
  }
  milestoneTitle = milestoneTitle || milestoneId;
  const subject = `feat: ${milestoneTitle}`;
  let body = "";
  if (completedSlices.length > 0) {
    const sliceLines = completedSlices
      .map((s) => `- ${s.id}: ${s.title}`)
      .join("\n");
    body = `\n\nCompleted slices:\n${sliceLines}\n\nSDD-Milestone: ${milestoneId}\nBranch: ${milestoneBranch}`;
  } else {
    body = `\n\nSDD-Milestone: ${milestoneId}\nBranch: ${milestoneBranch}`;
  }
  const commitMessage = subject + body;

  // 6b. Reconcile worktree HEAD with milestone branch ref (#1846).
  //     When the worktree HEAD detaches and advances past the named branch,
  //     the branch ref becomes stale. Squash-merging the stale ref silently
  //     orphans all commits between the branch ref and the actual worktree HEAD.
  //     Fix: fast-forward the branch ref to the worktree HEAD before merging.
  //     Only applies when merging from an actual worktree (worktreeCwd differs
  //     from originalBasePath_).
  if (worktreeCwd !== originalBasePath_) {
    try {
      const worktreeHead = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: worktreeCwd,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf-8",
      }).trim();
      const branchHead = execFileSync("git", ["rev-parse", milestoneBranch], {
        cwd: originalBasePath_,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf-8",
      }).trim();

      if (worktreeHead && branchHead && worktreeHead !== branchHead) {
        if (nativeIsAncestor(originalBasePath_, branchHead, worktreeHead)) {
          // Worktree HEAD is strictly ahead — fast-forward the branch ref
          nativeUpdateRef(
            originalBasePath_,
            `refs/heads/${milestoneBranch}`,
            worktreeHead,
          );
          debugLog("mergeMilestoneToMain", {
            action: "fast-forward-branch-ref",
            milestoneBranch,
            oldRef: branchHead.slice(0, 8),
            newRef: worktreeHead.slice(0, 8),
          });
        } else {
          // Diverged — fail loudly rather than silently losing commits
          process.chdir(previousCwd);
          throw new SDDError(
            SDD_GIT_ERROR,
            `Worktree HEAD (${worktreeHead.slice(0, 8)}) diverged from ` +
              `${milestoneBranch} (${branchHead.slice(0, 8)}). ` +
              `Manual reconciliation required before merge.`,
          );
        }
      }
    } catch (err) {
      // Re-throw SDDError (divergence); swallow rev-parse failures
      // (e.g. worktree dir already removed by external cleanup)
      if (err instanceof SDDError) throw err;
      debugLog("mergeMilestoneToMain", {
        action: "reconcile-skipped",
        reason: String(err),
      });
    }
  }

  // 7. Stash any pre-existing dirty files so the squash merge is not
  //    blocked by unrelated local changes (#2151).  clearProjectRootStateFiles
  //    only removes untracked .sdd/ files; tracked dirty files elsewhere (e.g.
  //    .planning/work-state.json with stash conflict markers) are invisible to
  //    that cleanup but will cause `git merge --squash` to reject.
  let stashed = false;
  try {
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: originalBasePath_,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
    }).trim();
    if (status) {
      execFileSync(
        "git",
        ["stash", "push", "--include-untracked", "-m", `sdd: pre-merge stash for ${milestoneId}`],
        { cwd: originalBasePath_, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" },
      );
      stashed = true;
    }
  } catch {
    // Stash failure is non-fatal — proceed without stash and let the merge
    // report the dirty tree if it fails.
  }

  // 8. Squash merge — auto-resolve .sdd/ state file conflicts (#530)
  const mergeResult = nativeMergeSquash(originalBasePath_, milestoneBranch);

  if (!mergeResult.success) {
    // Dirty working tree — the merge was rejected before it started (e.g.
    // untracked .sdd/ files left by syncStateToProjectRoot).  Preserve the
    // milestone branch so commits are not lost.
    if (mergeResult.conflicts.includes("__dirty_working_tree__")) {
      // Pop stash before throwing so local work is not lost.
      if (stashed) {
        try {
          execFileSync("git", ["stash", "pop"], {
            cwd: originalBasePath_,
            stdio: ["ignore", "pipe", "pipe"],
            encoding: "utf-8",
          });
        } catch { /* stash pop conflict is non-fatal */ }
      }
      // Restore cwd so the caller is not stranded on the integration branch
      process.chdir(previousCwd);
      // Surface the actual dirty filenames from git stderr instead of
      // generically blaming .sdd/ (#2151).
      const fileList = mergeResult.dirtyFiles?.length
        ? `Dirty files:\n${mergeResult.dirtyFiles.map((f) => `  ${f}`).join("\n")}`
        : `Check \`git status\` in the project root for details.`;
      throw new SDDError(
        SDD_GIT_ERROR,
        `Squash merge of ${milestoneBranch} rejected: working tree has dirty or untracked files ` +
          `that conflict with the merge. ${fileList}`,
      );
    }

    // Check for conflicts — use merge result first, fall back to nativeConflictFiles
    const conflictedFiles =
      mergeResult.conflicts.length > 0
        ? mergeResult.conflicts
        : nativeConflictFiles(originalBasePath_);

    if (conflictedFiles.length > 0) {
      // Separate auto-resolvable conflicts (SDD state files + build artifacts)
      // from real code conflicts. SDD state files diverge between branches
      // during normal operation. Build artifacts are machine-generated and
      // regenerable. Both are safe to accept from the milestone branch.
      const autoResolvable = conflictedFiles.filter(isSafeToAutoResolve);
      const codeConflicts = conflictedFiles.filter(
        (f) => !isSafeToAutoResolve(f),
      );

      // Auto-resolve safe conflicts by accepting the milestone branch version
      if (autoResolvable.length > 0) {
        for (const safeFile of autoResolvable) {
          try {
            nativeCheckoutTheirs(originalBasePath_, [safeFile]);
            nativeAddPaths(originalBasePath_, [safeFile]);
          } catch {
            // If checkout --theirs fails, try removing the file from the merge
            // (it's a runtime file that shouldn't be committed anyway)
            nativeRmForce(originalBasePath_, [safeFile]);
          }
        }
      }

      // If there are still real code conflicts, escalate
      if (codeConflicts.length > 0) {
        // Pop stash before throwing so local work is not lost (#2151).
        if (stashed) {
          try {
            execFileSync("git", ["stash", "pop"], {
              cwd: originalBasePath_,
              stdio: ["ignore", "pipe", "pipe"],
              encoding: "utf-8",
            });
          } catch { /* stash pop conflict is non-fatal */ }
        }
        throw new MergeConflictError(
          codeConflicts,
          "squash",
          milestoneBranch,
          mainBranch,
        );
      }
    }
    // No conflicts detected — possibly "already up to date", fall through to commit
  }

  // 9. Commit (handle nothing-to-commit gracefully)
  const commitResult = nativeCommit(originalBasePath_, commitMessage);
  const nothingToCommit = commitResult === null;

  // 9a. Clean up SQUASH_MSG left by git merge --squash (#1853).
  // git only removes SQUASH_MSG when the commit reads it directly (plain
  // `git commit`).  nativeCommit uses `-F -` (stdin) or libgit2, neither
  // of which trigger git's SQUASH_MSG cleanup.  If left on disk, doctor
  // reports `corrupt_merge_state` on every subsequent run.
  try {
    const squashMsgPath = join(resolveGitDir(originalBasePath_), "SQUASH_MSG");
    if (existsSync(squashMsgPath)) unlinkSync(squashMsgPath);
  } catch { /* best-effort */ }

  // 9a-ii. Restore stashed files now that the merge+commit is complete (#2151).
  // Pop after commit so stashed changes do not interfere with the squash merge
  // or the commit content.  Conflict on pop is non-fatal — the stash entry is
  // preserved and the user can resolve manually with `git stash pop`.
  if (stashed) {
    try {
      execFileSync("git", ["stash", "pop"], {
        cwd: originalBasePath_,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf-8",
      });
    } catch {
      // Stash pop after squash merge can conflict on .sdd/ state files that
      // diverged between branches.  Left unresolved, these UU entries block
      // every subsequent merge.  Auto-resolve them the same way we handle
      // .sdd/ conflicts during the merge itself: accept HEAD (the just-committed
      // version) and drop the now-applied stash.
      const uu = nativeConflictFiles(originalBasePath_);
      const gsdUU = uu.filter((f) => f.startsWith(".sdd/"));
      const nonSddUU = uu.filter((f) => !f.startsWith(".sdd/"));

      if (gsdUU.length > 0) {
        for (const f of gsdUU) {
          try {
            // Accept the committed (HEAD) version of the state file
            execFileSync("git", ["checkout", "HEAD", "--", f], {
              cwd: originalBasePath_,
              stdio: ["ignore", "pipe", "pipe"],
              encoding: "utf-8",
            });
            nativeAddPaths(originalBasePath_, [f]);
          } catch {
            // Last resort: remove the conflicted state file
            nativeRmForce(originalBasePath_, [f]);
          }
        }
      }

      if (nonSddUU.length === 0) {
        // All conflicts were .sdd/ files — safe to drop the stash
        try {
          execFileSync("git", ["stash", "drop"], {
            cwd: originalBasePath_,
            stdio: ["ignore", "pipe", "pipe"],
            encoding: "utf-8",
          });
        } catch { /* stash may already be consumed */ }
      } else {
        // Non-.sdd conflicts remain — leave stash for manual resolution
        logWarning("reconcile", "Stash pop conflict on non-.sdd files after merge", {
          files: nonSddUU.join(", "),
        });
      }
    }
  }

  // 9b. Safety check (#1792): if nothing was committed, verify the milestone
  // work is already on the integration branch before allowing teardown.
  // Compare only non-.sdd/ paths — .sdd/ state files diverge normally and
  // are auto-resolved during the squash merge.
  if (nothingToCommit) {
    const numstat = nativeDiffNumstat(
      originalBasePath_,
      mainBranch,
      milestoneBranch,
    );
    const codeChanges = numstat.filter(
      (entry) => !entry.path.startsWith(".sdd/"),
    );
    if (codeChanges.length > 0) {
      // Milestone has unanchored code changes — abort teardown.
      process.chdir(previousCwd);
      throw new SDDError(
        SDD_GIT_ERROR,
        `Squash merge produced nothing to commit but milestone branch "${milestoneBranch}" ` +
          `has ${codeChanges.length} code file(s) not on "${mainBranch}". ` +
          `Aborting worktree teardown to prevent data loss.`,
      );
    }
  }

  // 9c. Detect whether any non-.sdd/ code files were actually merged (#1906).
  // When a milestone only produced .sdd/ metadata (summaries, roadmaps) but no
  // real code, the user sees "milestone complete" but nothing changed in their
  // codebase. Surface this so the caller can warn the user.
  let codeFilesChanged = false;
  if (!nothingToCommit) {
    try {
      const mergedFiles = nativeDiffNumstat(
        originalBasePath_,
        "HEAD~1",
        "HEAD",
      );
      codeFilesChanged = mergedFiles.some(
        (entry) => !entry.path.startsWith(".sdd/"),
      );
    } catch {
      // If HEAD~1 doesn't exist (first commit), assume code was changed
      codeFilesChanged = true;
    }
  }

  // 10. Auto-push if enabled
  let pushed = false;
  if (prefs.auto_push === true && !nothingToCommit) {
    const remote = prefs.remote ?? "origin";
    try {
      execFileSync("git", ["push", remote, mainBranch], {
        cwd: originalBasePath_,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf-8",
      });
      pushed = true;
    } catch {
      // Push failure is non-fatal
    }
  }

  // 9b. Auto-create PR if enabled (#2302: no longer gated on pushed/auto_push)
  let prCreated = false;
  if (prefs.auto_pr === true && !nothingToCommit) {
    const remote = prefs.remote ?? "origin";
    const prTarget = prefs.pr_target_branch ?? mainBranch;
    try {
      // Push the milestone branch to remote first
      execFileSync("git", ["push", remote, milestoneBranch], {
        cwd: originalBasePath_,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf-8",
      });
      // Create PR via gh CLI with explicit --head and --base (#2302)
      execFileSync("gh", [
        "pr", "create", "--draft",
        "--base", prTarget,
        "--head", milestoneBranch,
        "--title", `Milestone ${milestoneId} complete`,
        "--body", "Auto-created by SDD on milestone completion.",
      ], {
        cwd: originalBasePath_,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf-8",
      });
      prCreated = true;
    } catch {
      // PR creation failure is non-fatal — gh may not be installed or authenticated
    }
  }

  // 11. Guard removed — step 9b (#1792) now handles this with a smarter check:
  //     throws only when the milestone has unanchored code changes, passes
  //     through when the code is genuinely already on the integration branch.

  // 11a. Pre-teardown safety net (#1853): if the worktree still has uncommitted
  // changes (e.g. nativeHasChanges cache returned stale false, or auto-commit
  // silently failed), force one final commit so code is not destroyed by
  // `git worktree remove --force`.
  if (existsSync(worktreeCwd)) {
    try {
      const dirtyCheck = nativeWorkingTreeStatus(worktreeCwd);
      if (dirtyCheck) {
        debugLog("mergeMilestoneToMain", {
          phase: "pre-teardown-dirty",
          worktreeCwd,
          status: dirtyCheck.slice(0, 200),
        });
        nativeAddAllWithExclusions(worktreeCwd, RUNTIME_EXCLUSION_PATHS);
        nativeCommit(worktreeCwd, "chore: pre-teardown auto-commit of uncommitted worktree changes");
      }
    } catch (e) {
      debugLog("mergeMilestoneToMain", {
        phase: "pre-teardown-commit-error",
        error: String(e),
      });
    }
  }

  // 12. Remove worktree directory first (must happen before branch deletion)
  try {
    removeWorktree(originalBasePath_, milestoneId, {
      branch: null as unknown as string,
      deleteBranch: false,
    });
  } catch {
    // Best-effort -- worktree dir may already be gone
  }

  // 13. Delete milestone branch (after worktree removal so ref is unlocked)
  try {
    nativeBranchDelete(originalBasePath_, milestoneBranch);
  } catch {
    // Best-effort
  }

  // 14. Clear module state
  originalBase = null;
  nudgeGitBranchCache(previousCwd);

  return { commitMessage, pushed, prCreated, codeFilesChanged };
}
