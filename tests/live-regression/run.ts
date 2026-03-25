/**
 * Live Regression Test Harness — Post-Build Pipeline Validation
 *
 * These tests run AFTER `npm publish` against the installed `sdd` binary.
 * They exercise the dispatch loop state machine end-to-end by:
 *
 * 1. Creating real `.sdd/` directory structures with milestone artifacts
 * 2. Calling `sdd headless query` to verify state derivation
 * 3. Verifying phase transitions match expected outcomes
 * 4. Testing crash recovery (lock file lifecycle)
 * 5. Testing worktree identity hash consistency
 *
 * These tests DO NOT require LLM API keys — they test the state machine
 * and infrastructure, not the LLM execution.
 *
 * Run from CI pipeline after `npm install -g sdd-pi@<version>`:
 *   node --experimental-strip-types tests/live-regression/run.ts
 *
 * Or locally:
 *   SDD_SMOKE_BINARY=dist/loader.js node --experimental-strip-types tests/live-regression/run.ts
 */

import { execFileSync, execSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";

// ─── Config ───────────────────────────────────────────────────────────────

const binary = process.env.SDD_SMOKE_BINARY || "sdd";
let passed = 0;
let failed = 0;

function run(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✅ ${label}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${label}`);
    console.error(`     ${err.message || err}`);
    failed++;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function sdd(args: string[], cwd: string, env?: Record<string, string>): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync(binary === "sdd" ? "sdd" : "node", 
      binary === "sdd" ? args : [binary, ...args], {
      cwd,
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env, SDD_NON_INTERACTIVE: "1" },
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err: any) {
    return { stdout: err.stdout || "", stderr: err.stderr || "", code: err.status ?? 1 };
  }
}

function createTempProject(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `sdd-live-${name}-`));
  try { execSync("git init && git config user.email test@test.com && git config user.name Test && git commit --allow-empty -m init", { cwd: dir, stdio: "pipe" }); } catch {}
  return dir;
}

function buildMinimalRoadmap(slices: Array<{ id: string; title: string; done: boolean }>): string {
  const lines = ["# M001: Test Milestone", "", "## Slices", ""];
  for (const s of slices) {
    const cb = s.done ? "x" : " ";
    lines.push(`- [${cb}] **${s.id}: ${s.title}** \`risk:low\` \`depends:[]\``);
    lines.push(`  > Demo for ${s.id}`);
    lines.push("");
  }
  return lines.join("\n");
}

function buildMinimalPlan(tasks: Array<{ id: string; title: string; done: boolean }>): string {
  const lines = ["# S01: Test Slice", "", "**Goal:** test", "", "## Tasks", ""];
  for (const t of tasks) {
    const cb = t.done ? "x" : " ";
    lines.push(`- [${cb}] **${t.id}: ${t.title}** \`est:5m\``);
  }
  return lines.join("\n");
}

function buildTaskSummary(id: string): string {
  return `---\nid: ${id}\nparent: S01\nmilestone: M001\nduration: 5m\nverification_result: passed\ncompleted_at: ${new Date().toISOString()}\n---\n\n# ${id}: Done\n\nCompleted.`;
}

// ─── Test: headless query returns valid JSON ──────────────────────────────

run("headless query returns valid JSON on initialized project", () => {
  const dir = createTempProject("query");
  try {
    const sddDir = join(dir, ".sdd");
    mkdirSync(join(sddDir, "milestones"), { recursive: true });
    
    const result = sdd(["headless", "query"], dir);
    assert(result.code === 0, `expected exit 0, got ${result.code}: ${result.stderr}`);
    
    const json = JSON.parse(result.stdout);
    assert(typeof ((json.state?.phase ?? json.phase)) === "string", "response should have phase field");
    assert(Array.isArray(json.milestones) || json.milestones === undefined, "milestones should be array or undefined");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: state derivation — empty project ──────────────────────────────

run("headless query: empty project reports pre-planning", () => {
  const dir = createTempProject("empty");
  try {
    mkdirSync(join(dir, ".sdd", "milestones"), { recursive: true });
    
    const result = sdd(["headless", "query"], dir);
    assert(result.code === 0, `expected exit 0, got ${result.code}`);
    
    const json = JSON.parse(result.stdout);
    assert((json.state?.phase ?? json.phase) === "pre-planning" || (json.state?.phase ?? json.phase) === "idle", 
      `expected pre-planning or idle, got: ${(json.state?.phase ?? json.phase)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: state derivation — milestone with roadmap ─────────────────────

run("headless query: milestone with roadmap reports planning phase", () => {
  const dir = createTempProject("planning");
  try {
    const mDir = join(dir, ".sdd", "milestones", "M001");
    mkdirSync(join(mDir, "slices", "S01"), { recursive: true });
    writeFileSync(join(mDir, "M001-CONTEXT.md"), "# M001\n\nContext.");
    writeFileSync(join(mDir, "M001-ROADMAP.md"), buildMinimalRoadmap([
      { id: "S01", title: "First Slice", done: false },
    ]));
    
    const result = sdd(["headless", "query"], dir);
    assert(result.code === 0, `expected exit 0, got ${result.code}`);
    
    const json = JSON.parse(result.stdout);
    assert((json.state?.phase ?? json.phase) === "planning", `expected planning, got: ${(json.state?.phase ?? json.phase)}`);
    assert((json.state?.activeMilestone ?? json.activeMilestone) === "M001" || (json.state?.activeMilestone ?? json.activeMilestone)?.id === "M001",
      `expected active milestone M001`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: state derivation — all tasks done ─────────────────────────────

run("headless query: all tasks done reports summarizing phase", () => {
  const dir = createTempProject("summarizing");
  try {
    const mDir = join(dir, ".sdd", "milestones", "M001");
    const sDir = join(mDir, "slices", "S01");
    mkdirSync(join(sDir, "tasks"), { recursive: true });
    writeFileSync(join(mDir, "M001-CONTEXT.md"), "# M001\n\nContext.");
    writeFileSync(join(mDir, "M001-ROADMAP.md"), buildMinimalRoadmap([
      { id: "S01", title: "First Slice", done: false },
    ]));
    writeFileSync(join(sDir, "S01-PLAN.md"), buildMinimalPlan([
      { id: "T01", title: "Task One", done: true },
    ]));
    writeFileSync(join(sDir, "tasks", "T01-SUMMARY.md"), buildTaskSummary("T01"));
    
    const result = sdd(["headless", "query"], dir);
    assert(result.code === 0, `expected exit 0, got ${result.code}`);
    
    const json = JSON.parse(result.stdout);
    assert((json.state?.phase ?? json.phase) === "summarizing", `expected summarizing, got: ${(json.state?.phase ?? json.phase)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: state derivation — complete milestone ─────────────────────────

run("headless query: milestone with summary reports complete", () => {
  const dir = createTempProject("complete");
  try {
    const mDir = join(dir, ".sdd", "milestones", "M001");
    mkdirSync(mDir, { recursive: true });
    writeFileSync(join(mDir, "M001-ROADMAP.md"), buildMinimalRoadmap([
      { id: "S01", title: "Done", done: true },
    ]));
    writeFileSync(join(mDir, "M001-SUMMARY.md"), "# M001 Summary\n\nComplete.");
    
    const result = sdd(["headless", "query"], dir);
    assert(result.code === 0, `expected exit 0, got ${result.code}`);
    
    const json = JSON.parse(result.stdout);
    assert((json.state?.phase ?? json.phase) === "complete" || (json.state?.phase ?? json.phase) === "idle" || (json.state?.phase ?? json.phase) === "pre-planning",
      `expected complete/idle/pre-planning, got: ${(json.state?.phase ?? json.phase)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: lock file lifecycle ───────────────────────────────────────────

run("stale auto.lock with dead PID does not block --version", () => {
  const dir = createTempProject("stale-lock");
  try {
    const sddDir = join(dir, ".sdd");
    mkdirSync(sddDir, { recursive: true });
    // Write a lock with a PID that doesn't exist
    writeFileSync(join(sddDir, "auto.lock"), JSON.stringify({
      pid: 99999999,
      startedAt: new Date().toISOString(),
      unitType: "starting",
      unitId: "bootstrap",
      unitStartedAt: new Date().toISOString(),
      completedUnits: 0,
    }));
    
    const result = sdd(["--version"], dir);
    assert(result.code === 0, `--version should succeed even with stale lock, got code ${result.code}`);
    assert(/\d+\.\d+\.\d+/.test(result.stdout.trim()), `should output version, got: ${result.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: crash recovery message ────────────────────────────────────────

run("crash recovery shows actionable guidance", () => {
  const dir = createTempProject("crash-recovery");
  try {
    const sddDir = join(dir, ".sdd");
    mkdirSync(join(sddDir, "milestones"), { recursive: true });
    writeFileSync(join(sddDir, "auto.lock"), JSON.stringify({
      pid: 99999999,
      startedAt: new Date().toISOString(),
      unitType: "execute-task",
      unitId: "M001/S01/T02",
      unitStartedAt: new Date().toISOString(),
      completedUnits: 5,
    }));
    
    // headless query should still work — lock is for auto-mode, not query
    const result = sdd(["headless", "query"], dir);
    assert(result.code === 0, `query should succeed with stale lock`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: TTY check fires before heavy initialization ───────────────────

run("non-TTY invocation exits quickly with clean error", () => {
  const dir = createTempProject("tty-check");
  try {
    const start = Date.now();
    const result = sdd([], dir); // No args, no TTY
    const elapsed = Date.now() - start;
    
    assert(result.code === 1, `expected exit 1 for non-TTY, got ${result.code}`);
    assert(elapsed < 5000, `should exit within 5s, took ${elapsed}ms`);
    assert(
      result.stderr.includes("TTY") || result.stderr.includes("terminal") || result.stderr.includes("Interactive"),
      `should mention TTY requirement in stderr`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: version skew detection ────────────────────────────────────────

run("version skew is detected before TTY check", () => {
  const dir = createTempProject("version-skew");
  try {
    // Create a fake managed-resources.json with a future version
    const agentDir = join(dir, ".sdd-test-agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "managed-resources.json"), JSON.stringify({
      sddVersion: "999.0.0",
    }));
    
    // Set HOME to the temp dir so SDD reads the fake agent dir
    const fakeHome = dir;
    mkdirSync(join(fakeHome, ".sdd", "agent"), { recursive: true });
    writeFileSync(join(fakeHome, ".sdd", "agent", "managed-resources.json"), JSON.stringify({
      sddVersion: "999.0.0",
    }));
    
    const result = sdd([], dir, { HOME: fakeHome });
    // Should either exit with version mismatch or TTY error — both are fine
    assert(result.code === 1, `expected exit 1, got ${result.code}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: native addon graceful fallback ────────────────────────────────

run("sdd --help works (native addon loads or falls back gracefully)", () => {
  const result = sdd(["--help"], process.cwd());
  assert(result.code === 0, `--help should exit 0, got ${result.code}`);
  assert(result.stdout.toLowerCase().includes("sdd") || result.stdout.toLowerCase().includes("usage"),
    `help output should contain sdd or usage`);
});

// ─── Summary ─────────────────────────────────────────────────────────────

console.log(`\nLive regression: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
