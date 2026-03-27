import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolvePreferredModelConfig } from "../auto-model-selection.js";

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("resolvePreferredModelConfig synthesizes heavy routing ceiling when models section is absent", () => {
  const originalCwd = process.cwd();
  const originalSddHome = process.env.SDD_HOME;
  const tempProject = makeTempDir("sdd-routing-project-");
  const tempSddHome = makeTempDir("sdd-routing-home-");

  try {
    mkdirSync(join(tempProject, ".sdd"), { recursive: true });
    writeFileSync(
      join(tempProject, ".sdd", "PREFERENCES.md"),
      [
        "---",
        "dynamic_routing:",
        "  enabled: true",
        "  tier_models:",
        "    light: claude-haiku-4-5",
        "    standard: claude-sonnet-4-6",
        "    heavy: claude-opus-4-6",
        "---",
      ].join("\n"),
      "utf-8",
    );
    process.env.SDD_HOME = tempSddHome;
    process.chdir(tempProject);

    const config = resolvePreferredModelConfig("plan-slice", {
      provider: "anthropic",
      id: "claude-sonnet-4-6",
    });

    assert.deepEqual(config, {
      primary: "claude-opus-4-6",
      fallbacks: [],
    });
  } finally {
    process.chdir(originalCwd);
    if (originalSddHome === undefined) delete process.env.SDD_HOME;
    else process.env.SDD_HOME = originalSddHome;
    rmSync(tempProject, { recursive: true, force: true });
    rmSync(tempSddHome, { recursive: true, force: true });
  }
});

test("resolvePreferredModelConfig falls back to auto start model when heavy tier is absent", () => {
  const originalCwd = process.cwd();
  const originalSddHome = process.env.SDD_HOME;
  const tempProject = makeTempDir("sdd-routing-project-");
  const tempSddHome = makeTempDir("sdd-routing-home-");

  try {
    mkdirSync(join(tempProject, ".sdd"), { recursive: true });
    writeFileSync(
      join(tempProject, ".sdd", "PREFERENCES.md"),
      [
        "---",
        "dynamic_routing:",
        "  enabled: true",
        "  tier_models:",
        "    light: claude-haiku-4-5",
        "    standard: claude-sonnet-4-6",
        "---",
      ].join("\n"),
      "utf-8",
    );
    process.env.SDD_HOME = tempSddHome;
    process.chdir(tempProject);

    const config = resolvePreferredModelConfig("execute-task", {
      provider: "openai",
      id: "gpt-5.4",
    });

    assert.deepEqual(config, {
      primary: "openai/gpt-5.4",
      fallbacks: [],
    });
  } finally {
    process.chdir(originalCwd);
    if (originalSddHome === undefined) delete process.env.SDD_HOME;
    else process.env.SDD_HOME = originalSddHome;
    rmSync(tempProject, { recursive: true, force: true });
    rmSync(tempSddHome, { recursive: true, force: true });
  }
});

test("resolvePreferredModelConfig keeps explicit phase models as the ceiling", () => {
  const originalCwd = process.cwd();
  const originalSddHome = process.env.SDD_HOME;
  const tempProject = makeTempDir("sdd-routing-project-");
  const tempSddHome = makeTempDir("sdd-routing-home-");

  try {
    mkdirSync(join(tempProject, ".sdd"), { recursive: true });
    writeFileSync(
      join(tempProject, ".sdd", "PREFERENCES.md"),
      [
        "---",
        "models:",
        "  planning: claude-sonnet-4-6",
        "dynamic_routing:",
        "  enabled: true",
        "  tier_models:",
        "    heavy: claude-opus-4-6",
        "---",
      ].join("\n"),
      "utf-8",
    );
    process.env.SDD_HOME = tempSddHome;
    process.chdir(tempProject);

    const config = resolvePreferredModelConfig("plan-slice", {
      provider: "anthropic",
      id: "claude-opus-4-6",
    });

    assert.deepEqual(config, {
      primary: "claude-sonnet-4-6",
      fallbacks: [],
    });
  } finally {
    process.chdir(originalCwd);
    if (originalSddHome === undefined) delete process.env.SDD_HOME;
    else process.env.SDD_HOME = originalSddHome;
    rmSync(tempProject, { recursive: true, force: true });
    rmSync(tempSddHome, { recursive: true, force: true });
  }
});
