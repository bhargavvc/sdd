/**
 * Worktree ↔ project root state synchronization for auto-mode.
 *
 * When auto-mode runs inside a worktree, dispatch-critical state files
 * (.sdd/ metadata) diverge between the worktree (where work happens)
 * and the project root (where startAutoMode reads initial state on restart).
 * Without syncing, restarting auto-mode reads stale state from the project
 * root and re-dispatches already-completed units.
 *
 * Also contains resource staleness detection and stale worktree escape.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  cpSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { join, sep as pathSep } from "node:path";
import { homedir } from "node:os";
import { safeCopy, safeCopyRecursive } from "./safe-fs.js";

const sddHome = process.env.SDD_HOME || join(homedir(), ".sdd");

// ─── Project Root → Worktree Sync ─────────────────────────────────────────

/**
 * Sync milestone artifacts from project root INTO worktree before deriveState.
 * Covers the case where the LLM wrote artifacts to the main repo filesystem
 * (e.g. via absolute paths) but the worktree has stale data. Also deletes
 * sdd.db in the worktree so it rebuilds from fresh disk state (#853).
 * Non-fatal — sync failure should never block dispatch.
 */
export function syncProjectRootToWorktree(
  projectRoot: string,
  worktreePath: string,
  milestoneId: string | null,
): void {
  if (!worktreePath || !projectRoot || worktreePath === projectRoot) return;
  if (!milestoneId) return;

  const prSdd = join(projectRoot, ".sdd");
  const wtSdd = join(worktreePath, ".sdd");

  // Copy milestone directory from project root to worktree if the project root
  // has newer artifacts (e.g. slices that don't exist in the worktree yet)
  safeCopyRecursive(
    join(prSdd, "milestones", milestoneId),
    join(wtSdd, "milestones", milestoneId),
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

// ─── Worktree → Project Root Sync ─────────────────────────────────────────

/**
 * Sync dispatch-critical .sdd/ state files from worktree to project root.
 * Only runs when inside an auto-worktree (worktreePath differs from projectRoot).
 * Copies: STATE.md + active milestone directory (roadmap, slice plans, task summaries).
 * Non-fatal — sync failure should never block dispatch.
 */
export function syncStateToProjectRoot(
  worktreePath: string,
  projectRoot: string,
  milestoneId: string | null,
): void {
  if (!worktreePath || !projectRoot || worktreePath === projectRoot) return;
  if (!milestoneId) return;

  const wtSdd = join(worktreePath, ".sdd");
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
    process.env.SDD_CODING_AGENT_DIR || join(sddHome, "agent");
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
  const sddHomePath = sddHome.replaceAll("\\", "/");
  if (candidateSdd === sddHomePath || candidateSdd.startsWith(sddHomePath + "/")) {
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
