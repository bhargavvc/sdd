import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { sddRoot, _clearSddRootCache } from "../paths.ts";
import { createTestContext } from "./test-helpers.ts";

const { assertEq, assertTrue, report } = createTestContext();

/** Create a tmp dir and resolve symlinks + 8.3 short names (macOS /var→/private/var, Windows RUNNER~1→runneradmin). */
function tmp(): string {
  const p = mkdtempSync(join(tmpdir(), "sdd-paths-test-"));
  try { return realpathSync.native(p); } catch { return p; }
}

function cleanup(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function initGit(dir: string): void {
  spawnSync("git", ["init"], { cwd: dir });
  spawnSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: dir });
}

// ── tests ──────────────────────────────────────────────────────────────────

{
  // Case 1: .sdd exists at basePath — fast path
  const root = tmp();
  try {
    mkdirSync(join(root, ".sdd"));
    _clearSddRootCache();
    const result = sddRoot(root);
    assertEq(result, join(root, ".sdd"), "fast path: returns basePath/.sdd");
  } finally { cleanup(root); }
}

{
  // Case 2: .sdd exists at git root, cwd is a subdirectory
  const root = tmp();
  try {
    initGit(root);
    mkdirSync(join(root, ".sdd"));
    const sub = join(root, "src", "deep");
    mkdirSync(sub, { recursive: true });
    _clearSddRootCache();
    const result = sddRoot(sub);
    assertEq(result, join(root, ".sdd"), "git-root probe: finds .sdd at git root from subdirectory");
  } finally { cleanup(root); }
}

{
  // Case 3: .sdd in an ancestor — walk-up finds it (git repo with no .sdd at root)
  const root = tmp();
  try {
    // Init a git repo so git probe returns root — but put .sdd one level deeper
    // to force the walk-up path: root/project/.sdd, cwd = root/project/src/deep
    initGit(root);
    const project = join(root, "project");
    mkdirSync(join(project, ".sdd"), { recursive: true });
    const deep = join(project, "src", "deep");
    mkdirSync(deep, { recursive: true });
    _clearSddRootCache();
    // git probe returns root (no .sdd there), so walk-up takes over and finds project/.sdd
    const result = sddRoot(deep);
    assertEq(result, join(project, ".sdd"), "walk-up: finds .sdd in ancestor when git root has none");
  } finally { cleanup(root); }
}

{
  // Case 4: .sdd nowhere — fallback returns original basePath/.sdd
  // Use an isolated git repo so we fully control the environment above basePath
  const root = tmp();
  try {
    initGit(root);                          // git root = root, no .sdd anywhere
    const sub = join(root, "src");
    mkdirSync(sub, { recursive: true });
    _clearSddRootCache();
    const result = sddRoot(sub);
    // git probe finds root (no .sdd), walk-up finds nothing → fallback = sub/.sdd
    assertEq(result, join(sub, ".sdd"), "fallback: returns basePath/.sdd when .sdd not found anywhere");
  } finally { cleanup(root); }
}

{
  // Case 5: cache — second call returns same value without re-probing
  const root = tmp();
  try {
    mkdirSync(join(root, ".sdd"));
    _clearSddRootCache();
    const first = sddRoot(root);
    const second = sddRoot(root);
    assertEq(first, second, "cache: same result returned on second call");
    assertTrue(first === second, "cache: identity check (same string)");
  } finally { cleanup(root); }
}

{
  // Case 6: .sdd at basePath takes precedence over ancestor .sdd
  const outer = tmp();
  try {
    initGit(outer);
    mkdirSync(join(outer, ".sdd"));
    const inner = join(outer, "nested");
    mkdirSync(join(inner, ".sdd"), { recursive: true });
    _clearSddRootCache();
    const result = sddRoot(inner);
    assertEq(result, join(inner, ".sdd"), "precedence: nearest .sdd wins over ancestor");
  } finally { cleanup(outer); }
}

report();
