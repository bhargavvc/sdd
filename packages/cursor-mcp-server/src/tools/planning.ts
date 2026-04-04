/**
 * Planning tools: sdd_plan_milestone, sdd_plan_slice, sdd_plan_task
 *
 * All deterministic — write to SQLite + markdown files.
 * No AI calls.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getDb, transaction, getMilestone, getSlice } from '../db.js';
import { updateStateMd } from '../state-writer.js';

// ---------------------------------------------------------------------------
// Plan Milestone
// ---------------------------------------------------------------------------

export interface PlanMilestoneSliceInput {
  sliceId: string;
  title: string;
  risk: string;
  depends: string[];
  demo: string;
  goal: string;
  successCriteria: string;
  proofLevel: string;
  integrationClosure: string;
  observabilityImpact: string;
}

export interface PlanMilestoneParams {
  projectDir: string;
  milestoneId: string;
  title: string;
  vision: string;
  successCriteria: string[];
  keyRisks: Array<{ risk: string; whyItMatters: string }>;
  proofStrategy: Array<{ riskOrUnknown: string; retireIn: string; whatWillBeProven: string }>;
  verificationContract: string;
  verificationIntegration: string;
  verificationOperational: string;
  verificationUat: string;
  definitionOfDone: string[];
  requirementCoverage: string;
  boundaryMapMarkdown: string;
  slices: PlanMilestoneSliceInput[];
}

export interface PlanMilestoneResult {
  milestoneId: string;
  roadmapPath: string;
  slicesCreated: number;
}

export function planMilestone(params: PlanMilestoneParams): PlanMilestoneResult {
  const db = getDb(resolve(params.projectDir));
  const now = new Date().toISOString();

  transaction(db, () => {
    // Upsert milestone
    db.prepare(`
      INSERT INTO milestones (
        id, title, status, depends_on, created_at,
        vision, success_criteria, key_risks, proof_strategy,
        verification_contract, verification_integration, verification_operational, verification_uat,
        definition_of_done, requirement_coverage, boundary_map_markdown
      ) VALUES (?, ?, 'active', '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, vision=excluded.vision,
        success_criteria=excluded.success_criteria, key_risks=excluded.key_risks,
        proof_strategy=excluded.proof_strategy,
        verification_contract=excluded.verification_contract,
        verification_integration=excluded.verification_integration,
        verification_operational=excluded.verification_operational,
        verification_uat=excluded.verification_uat,
        definition_of_done=excluded.definition_of_done,
        requirement_coverage=excluded.requirement_coverage,
        boundary_map_markdown=excluded.boundary_map_markdown
    `).run(
      params.milestoneId, params.title, now,
      params.vision,
      JSON.stringify(params.successCriteria),
      JSON.stringify(params.keyRisks),
      JSON.stringify(params.proofStrategy),
      params.verificationContract,
      params.verificationIntegration,
      params.verificationOperational,
      params.verificationUat,
      JSON.stringify(params.definitionOfDone),
      params.requirementCoverage,
      params.boundaryMapMarkdown,
    );

    // Upsert slices
    params.slices.forEach((s, idx) => {
      db.prepare(`
        INSERT INTO slices (
          milestone_id, id, title, status, risk, depends, demo, created_at,
          goal, success_criteria, proof_level, integration_closure, observability_impact, sequence
        ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(milestone_id, id) DO UPDATE SET
          title=excluded.title, risk=excluded.risk, depends=excluded.depends,
          demo=excluded.demo, goal=excluded.goal, success_criteria=excluded.success_criteria,
          proof_level=excluded.proof_level, integration_closure=excluded.integration_closure,
          observability_impact=excluded.observability_impact, sequence=excluded.sequence
      `).run(
        params.milestoneId, s.sliceId, s.title, s.risk,
        JSON.stringify(s.depends), s.demo, now,
        s.goal, s.successCriteria, s.proofLevel,
        s.integrationClosure, s.observabilityImpact, idx,
      );
    });
  });

  // Write ROADMAP.md
  const absDir = resolve(params.projectDir);
  const mDir = join(absDir, '.sdd', 'milestones', params.milestoneId);
  if (!existsSync(mDir)) mkdirSync(mDir, { recursive: true });
  const roadmapPath = join(mDir, `${params.milestoneId}-ROADMAP.md`);
  writeFileSync(roadmapPath, renderMilestoneRoadmap(params), 'utf-8');

  updateStateMd(params.projectDir);
  return { milestoneId: params.milestoneId, roadmapPath, slicesCreated: params.slices.length };
}

function renderMilestoneRoadmap(p: PlanMilestoneParams): string {
  const lines: string[] = [
    `# ${p.milestoneId}: ${p.title}`,
    '',
    `## Vision`,
    p.vision,
    '',
    `## Success Criteria`,
    ...p.successCriteria.map((c, i) => `${i + 1}. ${c}`),
    '',
    `## Key Risks`,
    ...p.keyRisks.map(r => `- **${r.risk}** — ${r.whyItMatters}`),
    '',
    `## Proof Strategy`,
    ...p.proofStrategy.map(ps => `- ${ps.riskOrUnknown} → retire in **${ps.retireIn}**: ${ps.whatWillBeProven}`),
    '',
    `## Verification Contract`,
    `**Contract:** ${p.verificationContract}`,
    `**Integration:** ${p.verificationIntegration}`,
    `**Operational:** ${p.verificationOperational}`,
    `**UAT:** ${p.verificationUat}`,
    '',
    `## Definition of Done`,
    ...p.definitionOfDone.map((d, i) => `${i + 1}. ${d}`),
    '',
    `## Boundary Map`,
    p.boundaryMapMarkdown,
    '',
    `## Slices`,
    '',
  ];

  p.slices.forEach((s, i) => {
    lines.push(`### ${i + 1}. ${s.sliceId}: ${s.title}`);
    lines.push(`- **Risk:** ${s.risk}`);
    lines.push(`- **Goal:** ${s.goal}`);
    lines.push(`- **Success:** ${s.successCriteria}`);
    if (s.depends.length) lines.push(`- **Depends on:** ${s.depends.join(', ')}`);
    lines.push(`- **Demo:** ${s.demo}`);
    lines.push('');
  });

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Plan Slice
// ---------------------------------------------------------------------------

export interface PlanSliceTaskInput {
  taskId: string;
  title: string;
  description: string;
  estimate: string;
  verify: string;
  files?: string[];
  inputs?: string[];
  expectedOutput?: string[];
  observabilityImpact?: string;
}

export interface PlanSliceParams {
  projectDir: string;
  milestoneId: string;
  sliceId: string;
  goal: string;
  successCriteria: string;
  proofLevel: string;
  integrationClosure: string;
  observabilityImpact: string;
  tasks: PlanSliceTaskInput[];
}

export interface PlanSliceResult {
  milestoneId: string;
  sliceId: string;
  tasksCreated: number;
  planPath: string;
}

export function planSlice(params: PlanSliceParams): PlanSliceResult {
  const db = getDb(resolve(params.projectDir));
  const now = new Date().toISOString();

  // Verify milestone + slice exist
  const milestone = getMilestone(db, params.milestoneId);
  if (!milestone) throw new Error(`Milestone '${params.milestoneId}' not found. Run sdd_plan_milestone first.`);

  transaction(db, () => {
    // Update slice planning fields
    db.prepare(`
      UPDATE slices SET
        goal=?, success_criteria=?, proof_level=?,
        integration_closure=?, observability_impact=?
      WHERE milestone_id=? AND id=?
    `).run(
      params.goal, params.successCriteria, params.proofLevel,
      params.integrationClosure, params.observabilityImpact,
      params.milestoneId, params.sliceId,
    );

    // Upsert tasks
    params.tasks.forEach((t, idx) => {
      db.prepare(`
        INSERT INTO tasks (
          milestone_id, slice_id, id, title, status, description,
          estimate, verify, files, inputs, expected_output,
          observability_impact, sequence, created_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(milestone_id, slice_id, id) DO UPDATE SET
          title=excluded.title, description=excluded.description,
          estimate=excluded.estimate, verify=excluded.verify,
          files=excluded.files, inputs=excluded.inputs,
          expected_output=excluded.expected_output, sequence=excluded.sequence
      `).run(
        params.milestoneId, params.sliceId, t.taskId, t.title,
        t.description, t.estimate, t.verify,
        JSON.stringify(t.files ?? []),
        JSON.stringify(t.inputs ?? []),
        JSON.stringify(t.expectedOutput ?? []),
        t.observabilityImpact ?? '',
        idx, now,
      );
    });
  });

  // Write slice plan markdown
  const absDir = resolve(params.projectDir);
  const sDir = join(absDir, '.sdd', 'milestones', params.milestoneId, params.sliceId);
  if (!existsSync(sDir)) mkdirSync(sDir, { recursive: true });
  const planPath = join(sDir, `${params.sliceId}-PLAN.md`);
  writeFileSync(planPath, renderSlicePlan(params), 'utf-8');

  updateStateMd(params.projectDir);
  return { milestoneId: params.milestoneId, sliceId: params.sliceId, tasksCreated: params.tasks.length, planPath };
}

function renderSlicePlan(p: PlanSliceParams): string {
  const lines = [
    `# ${p.sliceId} Plan`,
    '',
    `**Goal:** ${p.goal}`,
    `**Success:** ${p.successCriteria}`,
    `**Proof level:** ${p.proofLevel}`,
    `**Integration closure:** ${p.integrationClosure}`,
    `**Observability:** ${p.observabilityImpact}`,
    '',
    `## Tasks`,
    '',
  ];
  p.tasks.forEach((t, i) => {
    lines.push(`### ${i + 1}. ${t.taskId}: ${t.title}`);
    lines.push(`- **Estimate:** ${t.estimate}`);
    lines.push(`- ${t.description}`);
    lines.push(`- **Verify:** ${t.verify}`);
    lines.push('');
  });
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Plan Task
// ---------------------------------------------------------------------------

export interface PlanTaskParams {
  projectDir: string;
  milestoneId: string;
  sliceId: string;
  taskId: string;
  title: string;
  description: string;
  estimate: string;
  verify: string;
  files?: string[];
  inputs?: string[];
  expectedOutput?: string[];
}

export function planTask(params: PlanTaskParams): { milestoneId: string; sliceId: string; taskId: string } {
  const db = getDb(resolve(params.projectDir));
  const now = new Date().toISOString();

  if (!getMilestone(db, params.milestoneId)) throw new Error(`Milestone '${params.milestoneId}' not found.`);
  if (!getSlice(db, params.milestoneId, params.sliceId)) throw new Error(`Slice '${params.sliceId}' not found.`);

  db.prepare(`
    INSERT INTO tasks (
      milestone_id, slice_id, id, title, status, description,
      estimate, verify, files, inputs, expected_output, created_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(milestone_id, slice_id, id) DO UPDATE SET
      title=excluded.title, description=excluded.description,
      estimate=excluded.estimate, verify=excluded.verify,
      files=excluded.files, inputs=excluded.inputs, expected_output=excluded.expected_output
  `).run(
    params.milestoneId, params.sliceId, params.taskId, params.title,
    params.description, params.estimate, params.verify,
    JSON.stringify(params.files ?? []),
    JSON.stringify(params.inputs ?? []),
    JSON.stringify(params.expectedOutput ?? []),
    now,
  );

  updateStateMd(params.projectDir);
  return { milestoneId: params.milestoneId, sliceId: params.sliceId, taskId: params.taskId };
}
