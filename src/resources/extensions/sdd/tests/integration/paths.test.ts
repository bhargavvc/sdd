import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { gsdRoot, _clearGsdRootCache } from "../../paths.ts";
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

describe('paths', () => {
  test('Case 1: .sdd exists at basePath — fast path', () => {
    const root = tmp();
    try {
      mkdirSync(join(root, ".sdd"));
      _clearSddRootCache();
      const result = sddRoot(root);
      assert.deepStrictEqual(result, join(root, ".sdd"), "fast path: returns basePath/.sdd");
    } finally { cleanup(root); }
  });

  test('Case 2: .sdd exists at git root, cwd is a subdirectory', () => {
    const root = tmp();
    try {
      initGit(root);
      mkdirSync(join(root, ".sdd"));
      const sub = join(root, "src", "deep");
      mkdirSync(sub, { recursive: true });
      _clearSddRootCache();
      const result = sddRoot(sub);
      assert.deepStrictEqual(result, join(root, ".sdd"), "git-root probe: finds .sdd at git root from subdirectory");
    } finally { cleanup(root); }
  });

  test('Case 3: .sdd in an ancestor — walk-up finds it', () => {
    const root = tmp();
    try {
      initGit(root);
      const project = join(root, "project");
      mkdirSync(join(project, ".sdd"), { recursive: true });
      const deep = join(project, "src", "deep");
      mkdirSync(deep, { recursive: true });
      _clearSddRootCache();
      const result = sddRoot(deep);
      assert.deepStrictEqual(result, join(project, ".sdd"), "walk-up: finds .sdd in ancestor when git root has none");
    } finally { cleanup(root); }
  });

  test('Case 4: .sdd nowhere — fallback returns original basePath/.sdd', () => {
    const root = tmp();
    try {
      initGit(root);
      const sub = join(root, "src");
      mkdirSync(sub, { recursive: true });
      _clearSddRootCache();
      const result = sddRoot(sub);
      assert.deepStrictEqual(result, join(sub, ".sdd"), "fallback: returns basePath/.sdd when .sdd not found anywhere");
    } finally { cleanup(root); }
  });

  test('Case 5: cache — second call returns same value without re-probing', () => {
    const root = tmp();
    try {
      mkdirSync(join(root, ".sdd"));
      _clearSddRootCache();
      const first = sddRoot(root);
      const second = sddRoot(root);
      assert.deepStrictEqual(first, second, "cache: same result returned on second call");
      assert.ok(first === second, "cache: identity check (same string)");
    } finally { cleanup(root); }
  });

  test('Case 6: .sdd at basePath takes precedence over ancestor .sdd', () => {
    const outer = tmp();
    try {
      initGit(outer);
      mkdirSync(join(outer, ".sdd"));
      const inner = join(outer, "nested");
      mkdirSync(join(inner, ".sdd"), { recursive: true });
      _clearSddRootCache();
      const result = sddRoot(inner);
      assert.deepStrictEqual(result, join(inner, ".sdd"), "precedence: nearest .sdd wins over ancestor");
    } finally { cleanup(outer); }
  });
});
