// tool-naming — Verifies canonical + alias tool registration for SDD DB tools.
//
// Each DB tool must register under its canonical sdd_concept_action name
// AND under a backward-compatible alias name.
// The alias must share the exact same execute function reference as the canonical tool.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerDbTools } from '../bootstrap/db-tools.ts';


// ─── Mock PI ──────────────────────────────────────────────────────────────────

function makeMockPi() {
  const tools: any[] = [];
  return {
    registerTool: (tool: any) => tools.push(tool),
    tools,
  } as any;
}

// ─── Rename map ───────────────────────────────────────────────────────────────

const RENAME_MAP: Array<{ canonical: string; alias: string }> = [
  { canonical: "sdd_decision_save", alias: "sdd_save_decision" },
  { canonical: "sdd_requirement_update", alias: "sdd_update_requirement" },
  { canonical: "sdd_summary_save", alias: "sdd_save_summary" },
  { canonical: "sdd_milestone_generate_id", alias: "sdd_generate_milestone_id" },
  { canonical: "sdd_task_complete", alias: "sdd_complete_task" },
  { canonical: "sdd_slice_complete", alias: "sdd_complete_slice" },
  { canonical: "sdd_plan_milestone", alias: "sdd_milestone_plan" },
  { canonical: "sdd_plan_slice", alias: "sdd_slice_plan" },
  { canonical: "sdd_plan_task", alias: "sdd_task_plan" },
  { canonical: "sdd_replan_slice", alias: "sdd_slice_replan" },
  { canonical: "sdd_reassess_roadmap", alias: "sdd_roadmap_reassess" },
  { canonical: "sdd_complete_milestone", alias: "sdd_milestone_complete" },
  { canonical: "sdd_validate_milestone", alias: "sdd_milestone_validate" },
];

// ─── Registration count ──────────────────────────────────────────────────────

console.log('\n── Tool naming: registration count ──');

const pi = makeMockPi();
registerDbTools(pi);

assert.deepStrictEqual(pi.tools.length, 27, 'Should register exactly 27 tools (13 canonical + 13 aliases + 1 gate tool)');

// ─── Both names exist for each pair ──────────────────────────────────────────

console.log('\n── Tool naming: canonical and alias names exist ──');

for (const { canonical, alias } of RENAME_MAP) {
  const canonicalTool = pi.tools.find((t: any) => t.name === canonical);
  const aliasTool = pi.tools.find((t: any) => t.name === alias);

  assert.ok(canonicalTool !== undefined, `Canonical tool "${canonical}" should be registered`);
  assert.ok(aliasTool !== undefined, `Alias tool "${alias}" should be registered`);
}

// ─── Execute function identity ───────────────────────────────────────────────

console.log('\n── Tool naming: execute function identity (===) ──');

for (const { canonical, alias } of RENAME_MAP) {
  const canonicalTool = pi.tools.find((t: any) => t.name === canonical);
  const aliasTool = pi.tools.find((t: any) => t.name === alias);

  if (canonicalTool && aliasTool) {
    assert.ok(
      canonicalTool.execute === aliasTool.execute,
      `"${canonical}" and "${alias}" should share the same execute function reference`,
    );
  }
}

// ─── Alias descriptions include "(alias for ...)" ───────────────────────────

console.log('\n── Tool naming: alias descriptions ──');

for (const { canonical, alias } of RENAME_MAP) {
  const aliasTool = pi.tools.find((t: any) => t.name === alias);

  if (aliasTool) {
    assert.ok(
      aliasTool.description.includes(`alias for ${canonical}`),
      `Alias "${alias}" description should include "alias for ${canonical}"`,
    );
  }
}

// ─── Canonical tools have proper promptGuidelines ────────────────────────────

console.log('\n── Tool naming: canonical promptGuidelines use canonical name ──');

for (const { canonical } of RENAME_MAP) {
  const canonicalTool = pi.tools.find((t: any) => t.name === canonical);

  if (canonicalTool) {
    const guidelinesText = canonicalTool.promptGuidelines.join(' ');
    assert.ok(
      guidelinesText.includes(canonical),
      `Canonical tool "${canonical}" promptGuidelines should reference its own name`,
    );
  }
}

// ─── Alias promptGuidelines direct to canonical ──────────────────────────────

console.log('\n── Tool naming: alias promptGuidelines redirect to canonical ──');

for (const { canonical, alias } of RENAME_MAP) {
  const aliasTool = pi.tools.find((t: any) => t.name === alias);

  if (aliasTool) {
    const guidelinesText = aliasTool.promptGuidelines.join(' ');
    assert.ok(
      guidelinesText.includes(`Alias for ${canonical}`),
      `Alias "${alias}" promptGuidelines should say "Alias for ${canonical}"`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
