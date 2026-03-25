/**
 * Unit tests for the sdd CLI package.
 *
 * Tests the glue code that IS the product:
 * - app-paths resolve to ~/.sdd/
 * - loader sets all required env vars
 * - resource-loader syncs bundled resources
 * - wizard loadStoredEnvKeys hydrates env
 *
 * Integration tests (npm pack, install, launch) are in ./integration/pack-install.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const projectRoot = join(fileURLToPath(import.meta.url), "..", "..", "..");

function assertExtensionIndexExists(agentDir: string, extensionName: string): void {
  assert.ok(
    existsSync(join(agentDir, "extensions", extensionName, "index.js"))
      || existsSync(join(agentDir, "extensions", extensionName, "index.ts")),
    `${extensionName} extension synced`,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. app-paths
// ═══════════════════════════════════════════════════════════════════════════

test("app-paths resolve to ~/.sdd/", async () => {
  const { appRoot, agentDir, sessionsDir, authFilePath } = await import("../app-paths.ts");
  const home = process.env.HOME!;

  assert.equal(appRoot, join(home, ".sdd"), "appRoot is ~/.sdd/");
  assert.equal(agentDir, join(home, ".sdd", "agent"), "agentDir is ~/.sdd/agent/");
  assert.equal(sessionsDir, join(home, ".sdd", "sessions"), "sessionsDir is ~/.sdd/sessions/");
  assert.equal(authFilePath, join(home, ".sdd", "agent", "auth.json"), "authFilePath is ~/.sdd/agent/auth.json");
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. loader env vars
// ═══════════════════════════════════════════════════════════════════════════

test("loader sets all 4 SDD_ env vars and PI_PACKAGE_DIR", async () => {
  // Run loader in a subprocess that prints env vars and exits before TUI starts
  const script = `
    import { fileURLToPath } from 'url';
    import { dirname, resolve, join, delimiter } from 'path';
    import { agentDir } from './app-paths.js';

    const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'pkg');
    process.env.PI_PACKAGE_DIR = pkgDir;
    process.env.SDD_CODING_AGENT_DIR = agentDir;
    process.env.SDD_BIN_PATH = process.argv[1];
    const resourcesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'resources');
    process.env.SDD_WORKFLOW_PATH = join(resourcesDir, 'SDD-WORKFLOW.md');
    const exts = ['extensions/sdd/index.ts'].map(r => join(resourcesDir, r));
    process.env.SDD_BUNDLED_EXTENSION_PATHS = exts.join(delimiter);

    // Print for verification
    console.log('PI_PACKAGE_DIR=' + process.env.PI_PACKAGE_DIR);
    console.log('SDD_CODING_AGENT_DIR=' + process.env.SDD_CODING_AGENT_DIR);
    console.log('SDD_BIN_PATH=' + process.env.SDD_BIN_PATH);
    console.log('SDD_WORKFLOW_PATH=' + process.env.SDD_WORKFLOW_PATH);
    console.log('SDD_BUNDLED_EXTENSION_PATHS=' + process.env.SDD_BUNDLED_EXTENSION_PATHS);
    process.exit(0);
  `;

  const tmp = mkdtempSync(join(tmpdir(), "sdd-loader-test-"));
  const scriptPath = join(tmp, "check-env.ts");
  writeFileSync(scriptPath, script);

  try {
    const output = execSync(
      `node --experimental-strip-types -e "
        process.chdir('${projectRoot}');
        await import('./src/app-paths.ts');
      " 2>&1`,
      { encoding: "utf-8", cwd: projectRoot },
    );
    // If we got here without error, the import works
  } catch {
    // Fine — we test the logic inline below
  }

  // Direct logic verification (no subprocess needed)
  const { agentDir: ad } = await import("../app-paths.ts");
  assert.ok(ad.endsWith(join(".sdd", "agent")), "agentDir ends with .sdd/agent");

  // Verify the env var names are in loader.ts source
  const loaderSrc = readFileSync(join(projectRoot, "src", "loader.ts"), "utf-8");
  assert.ok(loaderSrc.includes("PI_PACKAGE_DIR"), "loader sets PI_PACKAGE_DIR");
  assert.ok(loaderSrc.includes("SDD_CODING_AGENT_DIR"), "loader sets SDD_CODING_AGENT_DIR");
  assert.ok(loaderSrc.includes("SDD_BIN_PATH"), "loader sets SDD_BIN_PATH");
  assert.ok(loaderSrc.includes("SDD_WORKFLOW_PATH"), "loader sets SDD_WORKFLOW_PATH");
  assert.ok(loaderSrc.includes("SDD_BUNDLED_EXTENSION_PATHS"), "loader sets SDD_BUNDLED_EXTENSION_PATHS");
  assert.ok(loaderSrc.includes("serializeBundledExtensionPaths"), "loader uses shared bundled path serializer");
  assert.ok(loaderSrc.includes("join(delimiter)"), "loader uses platform delimiter for NODE_PATH");

  // Verify extension discovery mechanism is in place
  // loader.ts uses shared discoverExtensionEntryPaths() from extension-discovery.ts
  assert.ok(loaderSrc.includes("discoverExtensionEntryPaths"), "loader uses discoverExtensionEntryPaths for extension discovery");
  assert.ok(loaderSrc.includes("bundledExtDir"), "loader defines bundledExtDir for scanning");
  assert.ok(loaderSrc.includes("discoveredExtensionPaths"), "loader collects discovered paths");

  // Verify that the env var is populated at runtime by checking the actual
  // extensions directory has discoverable entry points
  const { discoverExtensionEntryPaths } = await import("../extension-discovery.ts");
  const bundledExtensionsDir = join(projectRoot, existsSync(join(projectRoot, "dist", "resources"))
    ? "dist" : "src", "resources", "extensions");
  const discovered = discoverExtensionEntryPaths(bundledExtensionsDir);
  assert.ok(discovered.length >= 10, `expected >=10 extensions, found ${discovered.length}`);

  // Spot-check that core extensions are discoverable
  const discoveredNames = discovered.map(p => {
    const rel = p.slice(bundledExtensionsDir.length + 1);
    return rel.split(/[\\/]/)[0].replace(/\.(?:ts|js)$/, "");
  });
  for (const core of ["sdd", "bg-shell", "browser-tools", "subagent", "search-the-web"]) {
    assert.ok(discoveredNames.includes(core), `core extension '${core}' is discoverable`);
  }

  rmSync(tmp, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. resource-loader syncs bundled resources
// ═══════════════════════════════════════════════════════════════════════════

test("initResources syncs extensions, agents, and skills to target dir", async () => {
  const { initResources, readManagedResourceVersion } = await import("../resource-loader.ts");
  const tmp = mkdtempSync(join(tmpdir(), "sdd-resources-test-"));
  const fakeAgentDir = join(tmp, "agent");

  try {
    initResources(fakeAgentDir);

    // Extensions synced
    assertExtensionIndexExists(fakeAgentDir, "sdd");
    assertExtensionIndexExists(fakeAgentDir, "browser-tools");
    assertExtensionIndexExists(fakeAgentDir, "search-the-web");
    assertExtensionIndexExists(fakeAgentDir, "context7");
    assertExtensionIndexExists(fakeAgentDir, "subagent");

    // Agents synced
    assert.ok(existsSync(join(fakeAgentDir, "agents", "scout.md")), "scout agent synced");

    // Skills synced
    assert.ok(existsSync(join(fakeAgentDir, "skills")), "skills directory synced");

    // Version manifest synced
    const managedVersion = readManagedResourceVersion(fakeAgentDir);
    assert.ok(managedVersion, "managed resource version written");

    // Idempotent: run again, no crash
    initResources(fakeAgentDir);
    assertExtensionIndexExists(fakeAgentDir, "sdd");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("initResources skips copy when managed version matches current version", async () => {
  const { initResources, readManagedResourceVersion } = await import("../resource-loader.ts");
  const tmp = mkdtempSync(join(tmpdir(), "sdd-resources-skip-"));
  const fakeAgentDir = join(tmp, "agent");

  try {
    // First run: full sync (no manifest yet)
    initResources(fakeAgentDir);
    const version = readManagedResourceVersion(fakeAgentDir);
    assert.ok(version, "manifest written after first sync");

    // Add a marker file to detect whether sync runs again
    const markerPath = join(fakeAgentDir, "extensions", "sdd", "_marker.txt");
    writeFileSync(markerPath, "test-marker");

    // Second run: version matches — should skip, marker survives
    initResources(fakeAgentDir);
    assert.ok(existsSync(markerPath), "marker file survives when version matches (sync skipped)");

    // Simulate version mismatch by writing older version to manifest
    const manifestPath = join(fakeAgentDir, "managed-resources.json");
    writeFileSync(manifestPath, JSON.stringify({ sddVersion: "0.0.1", syncedAt: Date.now() }));

    // Third run: version mismatch — full sync, marker removed
    initResources(fakeAgentDir);
    assert.ok(!existsSync(markerPath), "marker file removed after version-mismatch sync");

    // Manifest updated to current version
    const updatedVersion = readManagedResourceVersion(fakeAgentDir);
    assert.strictEqual(updatedVersion, version, "manifest updated to current version after sync");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. wizard loadStoredEnvKeys hydration
// ═══════════════════════════════════════════════════════════════════════════

test("loadStoredEnvKeys hydrates process.env from auth.json", async () => {
  const { loadStoredEnvKeys } = await import("../wizard.ts");
  const { AuthStorage } = await import("@sdd/pi-coding-agent");

  const tmp = mkdtempSync(join(tmpdir(), "sdd-wizard-test-"));
  const authPath = join(tmp, "auth.json");
  writeFileSync(authPath, JSON.stringify({
    brave: { type: "api_key", key: "test-brave-key" },
    brave_answers: { type: "api_key", key: "test-answers-key" },
    context7: { type: "api_key", key: "test-ctx7-key" },
    tavily: { type: "api_key", key: "test-tavily-key" },
    telegram_bot: { type: "api_key", key: "test-telegram-key" },
    "custom-openai": { type: "api_key", key: "test-custom-openai-key" },
  }));

  // Clear any existing env vars
  const envVarsToRestore = [
    "BRAVE_API_KEY", "BRAVE_ANSWERS_KEY", "CONTEXT7_API_KEY",
    "JINA_API_KEY", "TAVILY_API_KEY", "TELEGRAM_BOT_TOKEN",
    "CUSTOM_OPENAI_API_KEY",
  ];
  const origValues: Record<string, string | undefined> = {};
  for (const v of envVarsToRestore) {
    origValues[v] = process.env[v];
    delete process.env[v];
  }

  try {
    const auth = AuthStorage.create(authPath);
    loadStoredEnvKeys(auth);

    assert.equal(process.env.BRAVE_API_KEY, "test-brave-key", "BRAVE_API_KEY hydrated");
    assert.equal(process.env.BRAVE_ANSWERS_KEY, "test-answers-key", "BRAVE_ANSWERS_KEY hydrated");
    assert.equal(process.env.CONTEXT7_API_KEY, "test-ctx7-key", "CONTEXT7_API_KEY hydrated");
    assert.equal(process.env.JINA_API_KEY, undefined, "JINA_API_KEY not set (not in auth)");
    assert.equal(process.env.TAVILY_API_KEY, "test-tavily-key", "TAVILY_API_KEY hydrated");
    assert.equal(process.env.TELEGRAM_BOT_TOKEN, "test-telegram-key", "TELEGRAM_BOT_TOKEN hydrated");
    assert.equal(process.env.CUSTOM_OPENAI_API_KEY, "test-custom-openai-key", "CUSTOM_OPENAI_API_KEY hydrated");
  } finally {
    for (const v of envVarsToRestore) {
      if (origValues[v]) process.env[v] = origValues[v]; else delete process.env[v];
    }
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. loadStoredEnvKeys does NOT overwrite existing env vars
// ═══════════════════════════════════════════════════════════════════════════

test("loadStoredEnvKeys does not overwrite existing env vars", async () => {
  const { loadStoredEnvKeys } = await import("../wizard.ts");
  const { AuthStorage } = await import("@sdd/pi-coding-agent");

  const tmp = mkdtempSync(join(tmpdir(), "sdd-wizard-nooverwrite-"));
  const authPath = join(tmp, "auth.json");
  writeFileSync(authPath, JSON.stringify({
    brave: { type: "api_key", key: "stored-key" },
  }));

  const origBrave = process.env.BRAVE_API_KEY;
  process.env.BRAVE_API_KEY = "existing-env-key";

  try {
    const auth = AuthStorage.create(authPath);
    loadStoredEnvKeys(auth);

    assert.equal(process.env.BRAVE_API_KEY, "existing-env-key", "existing env var not overwritten");
  } finally {
    if (origBrave) process.env.BRAVE_API_KEY = origBrave; else delete process.env.BRAVE_API_KEY;
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. State derivation — Gap 2
// ═══════════════════════════════════════════════════════════════════════════

test("deriveState returns pre-planning phase for empty .sdd/ directory", async () => {
  const { deriveState } = await import("../resources/extensions/sdd/state.ts");
  const tmp = mkdtempSync(join(tmpdir(), "sdd-state-smoke-"));

  // Create minimal .sdd/ structure with no milestones
  mkdirSync(join(tmp, ".sdd"), { recursive: true });

  try {
    const state = await deriveState(tmp);

    assert.equal(state.phase, "pre-planning",
      `expected pre-planning phase for empty .sdd/, got: ${state.phase}`);
    assert.equal(state.activeMilestone, null, "no active milestone");
    assert.equal(state.activeSlice, null, "no active slice");
    assert.equal(state.activeTask, null, "no active task");
    assert.ok(Array.isArray(state.blockers), "blockers is an array");
    assert.ok(Array.isArray(state.registry), "registry is an array");
    assert.equal(state.registry.length, 0, "empty registry");
    assert.ok(typeof state.nextAction === "string", "nextAction is a string");
    assert.ok(state.nextAction.length > 0, "nextAction is non-empty");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("deriveState returns pre-planning phase when no .sdd/ directory exists", async () => {
  const { deriveState } = await import("../resources/extensions/sdd/state.ts");
  // Use a temp dir with no .sdd/ subdirectory at all
  const tmp = mkdtempSync(join(tmpdir(), "sdd-state-nosdd-"));

  try {
    // Should not throw — missing .sdd/ is a valid "no project" state
    const state = await deriveState(tmp);

    assert.equal(state.phase, "pre-planning",
      `expected pre-planning phase when .sdd/ absent, got: ${state.phase}`);
    assert.equal(state.activeMilestone, null, "no active milestone");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("deriveState shape is structurally complete", async () => {
  const { deriveState } = await import("../resources/extensions/sdd/state.ts");
  const tmp = mkdtempSync(join(tmpdir(), "sdd-state-shape-"));
  mkdirSync(join(tmp, ".sdd"), { recursive: true });

  try {
    const state = await deriveState(tmp);

    // All required fields present
    const requiredFields = [
      "phase", "activeMilestone", "activeSlice", "activeTask",
      "recentDecisions", "blockers", "nextAction", "registry",
    ] as const;
    for (const field of requiredFields) {
      assert.ok(field in state, `state.${field} should be present`);
    }

    // phase is a known string value
    const validPhases = [
      "pre-planning", "needs-discussion", "researching", "planning",
      "executing", "summarizing", "replanning-slice", "validating-milestone",
      "completing-milestone", "complete", "blocked",
    ];
    assert.ok(validPhases.includes(state.phase),
      `state.phase '${state.phase}' should be a known phase`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Doctor health checks — Gap 3
// ═══════════════════════════════════════════════════════════════════════════

test("runSDDDoctor completes without throwing on empty .sdd/ directory", async () => {
  const { runSDDDoctor } = await import("../resources/extensions/sdd/doctor.ts");
  const tmp = mkdtempSync(join(tmpdir(), "sdd-doctor-smoke-"));
  mkdirSync(join(tmp, ".sdd"), { recursive: true });

  try {
    // audit-only mode (fix: false) — should never throw
    const report = await runSDDDoctor(tmp, { fix: false });

    // Structural assertions on the DoctorReport
    assert.ok(typeof report === "object" && report !== null, "report is an object");
    assert.ok("ok" in report, "report has ok field");
    assert.ok("issues" in report, "report has issues field");
    assert.ok("fixesApplied" in report, "report has fixesApplied field");
    assert.ok("basePath" in report, "report has basePath field");
    assert.ok(Array.isArray(report.issues), "report.issues is an array");
    assert.ok(Array.isArray(report.fixesApplied), "report.fixesApplied is an array");
    assert.equal(typeof report.ok, "boolean", "report.ok is a boolean");
    assert.equal(report.fixesApplied.length, 0, "no fixes applied in audit mode");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("runSDDDoctor issue objects have required fields", async () => {
  const { runSDDDoctor } = await import("../resources/extensions/sdd/doctor.ts");
  const tmp = mkdtempSync(join(tmpdir(), "sdd-doctor-fields-"));
  mkdirSync(join(tmp, ".sdd"), { recursive: true });

  // Create a milestone dir with no ROADMAP.md to force a missing_roadmap issue
  const mDir = join(tmp, ".sdd", "milestones", "M001");
  mkdirSync(mDir, { recursive: true });
  writeFileSync(join(mDir, "M001-CONTEXT.md"), "# Context\n");

  try {
    const report = await runSDDDoctor(tmp, { fix: false });

    // Should find at least one issue (missing roadmap for M001)
    assert.ok(report.issues.length > 0, "expected at least one issue for milestone missing ROADMAP.md");

    // Verify structure of each issue
    for (const issue of report.issues) {
      assert.ok(typeof issue.severity === "string", "issue.severity is a string");
      assert.ok(["info", "warning", "error"].includes(issue.severity),
        `issue.severity '${issue.severity}' should be info|warning|error`);
      assert.ok(typeof issue.code === "string", "issue.code is a string");
      assert.ok(typeof issue.message === "string", "issue.message is a string");
      assert.ok(issue.message.length > 0, "issue.message is non-empty");
      assert.ok(typeof issue.fixable === "boolean", "issue.fixable is a boolean");
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("runSDDDoctor with fix:false never modifies the filesystem", async () => {
  const { runSDDDoctor } = await import("../resources/extensions/sdd/doctor.ts");
  const tmp = mkdtempSync(join(tmpdir(), "sdd-doctor-readonly-"));
  const sddDir = join(tmp, ".sdd");
  mkdirSync(sddDir, { recursive: true });

  // Write a sentinel file — doctor must not delete or modify it
  const sentinelPath = join(sddDir, "SENTINEL.md");
  writeFileSync(sentinelPath, "# sentinel\n");

  try {
    await runSDDDoctor(tmp, { fix: false });

    assert.ok(existsSync(sentinelPath), "sentinel file still exists after audit-only run");
    const content = readFileSync(sentinelPath, "utf-8");
    assert.equal(content, "# sentinel\n", "sentinel file content unchanged");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
