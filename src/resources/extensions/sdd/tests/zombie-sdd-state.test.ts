import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createTestContext } from "./test-helpers.ts";

const { assertTrue, assertMatch, assertNoMatch, report } = createTestContext();

// ─── #2942: Zombie .sdd state skips init wizard ─────────────────────────────
//
// A partially initialized .sdd/ (symlink exists but no PREFERENCES.md or
// milestones/) causes the init wizard gate in showSmartEntry to be skipped,
// resulting in an uninitialized project session.

console.log("\n=== #2942: zombie .sdd state must not skip init wizard ===");

// ── guided-flow.ts — init wizard gate must check bootstrap completeness ──

const guidedFlowSrc = readFileSync(
  join(import.meta.dirname, "..", "guided-flow.ts"),
  "utf-8",
);

// Find the showSmartEntry function
const smartEntryIdx = guidedFlowSrc.indexOf("export async function showSmartEntry(");
assertTrue(smartEntryIdx >= 0, "guided-flow.ts defines showSmartEntry");

// Extract the region between showSmartEntry and the first showProjectInit call
// This is where the init wizard gate lives.
const afterSmartEntry = smartEntryIdx >= 0 ? guidedFlowSrc.slice(smartEntryIdx, smartEntryIdx + 3000) : "";

// The gate must NOT be a bare `!existsSync(sddRoot(basePath))` check.
// It must also verify that bootstrap artifacts (PREFERENCES.md or milestones/) exist.
assertTrue(
  afterSmartEntry.includes("PREFERENCES.md") || afterSmartEntry.includes("PREFERENCES"),
  "init wizard gate checks for PREFERENCES.md, not just .sdd/ existence (#2942)",
);

assertTrue(
  afterSmartEntry.includes("milestones"),
  "init wizard gate checks for milestones/ directory, not just .sdd/ existence (#2942)",
);

// The init wizard should be shown when .sdd/ exists but has no bootstrap artifacts.
// The old code was: if (!existsSync(sddRoot(basePath))) { ... showProjectInit ... }
// The fix should use a compound check so zombie states trigger the wizard.
// Verify we no longer have the bare existence check as the sole gate.

// Find the specific init wizard gate pattern — the detection preamble block.
const detectionPreambleIdx = afterSmartEntry.indexOf("Detection preamble");
const detectionRegion = detectionPreambleIdx >= 0
  ? afterSmartEntry.slice(detectionPreambleIdx, detectionPreambleIdx + 600)
  : afterSmartEntry.slice(0, 1500);

// The gate condition must reference PREFERENCES.md or milestones (bootstrap artifacts)
assertMatch(
  detectionRegion,
  /PREFERENCES\.md|milestones/,
  "detection preamble gate references bootstrap artifacts, not just directory existence (#2942)",
);

// ── auto-start.ts — milestones/ dir creation must not be dead code ──────────

console.log("\n=== #2942: auto-start milestones/ bootstrap not dead code ===");

const autoStartSrc = readFileSync(
  join(import.meta.dirname, "..", "auto-start.ts"),
  "utf-8",
);

// After ensureSddSymlink, the code that creates milestones/ must check for
// the milestones directory specifically (not .sdd/ which ensureSddSymlink already created).
const symlinkIdx = autoStartSrc.indexOf("ensureSddSymlink(base)");
assertTrue(symlinkIdx >= 0, "auto-start.ts calls ensureSddSymlink(base)");

const afterSymlink = symlinkIdx >= 0 ? autoStartSrc.slice(symlinkIdx, symlinkIdx + 800) : "";

// The milestones bootstrap must check milestones path, not sddDir
// Old (dead) code: if (!existsSync(sddDir)) { mkdirSync(join(sddDir, "milestones"), ...) }
// Fixed code should check: if (!existsSync(milestonesPath)) or similar
assertTrue(
  afterSymlink.includes("milestones") && afterSymlink.includes("mkdirSync"),
  "auto-start.ts creates milestones/ directory after ensureSddSymlink (#2942)",
);

// The guard for milestones/ creation should NOT be `!existsSync(sddDir)` —
// that's dead code since ensureSddSymlink already created sddDir.
// It should check for the milestones/ dir directly.
const mkdirRegion = afterSymlink.slice(0, afterSymlink.indexOf("mkdirSync") + 200);
assertMatch(
  mkdirRegion,
  /existsSync\([^)]*milestones/,
  "milestones bootstrap checks milestones path existence, not .sdd/ (#2942)",
);

report();
