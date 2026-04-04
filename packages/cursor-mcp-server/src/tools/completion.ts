/**
 * Completion tools: sdd_complete_task, sdd_complete_slice, sdd_complete_milestone
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getDb, transaction, getMilestone, getSlice, getTask } from '../db.js';
import { updateStateMd } from '../state-writer.js';

// ---------------------------------------------------------------------------
// Complete Task
// ---------------------------------------------------------------------------

export interface VerificationEvidenceInput {
  command: string;
  exitCode: number;
  verdict: string;
  durationMs?: number;
}

export interface CompleteTaskParams {
  projectDir: string;
  milestoneId: string;
  sliceId: string;
  taskId: string;
  oneLiner: string;
  narrative: string;
  verificationResult: string;
  keyFiles?: string[];
  keyDecisions?: string[];
  verificationEvidence: VerificationEvidenceInput[];
  blockerDiscovered?: boolean;
  deviations?: string;
  knownIssues?: string;
}

export function completeTask(params: CompleteTaskParams): { milestoneId: string; sliceId: string; taskId: string; status: string } {
  const db = getDb(resolve(params.projectDir));
  const now = new Date().toISOString();

  const task = getTask(db, params.milestoneId, params.sliceId, params.taskId);
  if (!task) throw new Error(`Task '${params.taskId}' not found in ${params.milestoneId}/${params.sliceId}.`);
  if (task.status === 'done') throw new Error(`Task '${params.taskId}' is already complete.`);

  if (!params.verificationEvidence || params.verificationEvidence.length === 0) {
    throw new Error('verificationEvidence is required — must include at least one evidence entry (e.g. tests pass).');
  }

  transaction(db, () => {
    db.prepare(`
      UPDATE tasks SET
        status='done', one_liner=?, narrative=?, verification_result=?,
        key_files=?, key_decisions=?, completed_at=?,
        blocker_discovered=?, deviations=?, known_issues=?
      WHERE milestone_id=? AND slice_id=? AND id=?
    `).run(
      params.oneLiner, params.narrative, params.verificationResult,
      JSON.stringify(params.keyFiles ?? []),
      JSON.stringify(params.keyDecisions ?? []),
      now,
      params.blockerDiscovered ? 1 : 0,
      params.deviations ?? '',
      params.knownIssues ?? '',
      params.milestoneId, params.sliceId, params.taskId,
    );

    for (const e of params.verificationEvidence) {
      db.prepare(`
        INSERT INTO verification_evidence
          (task_id, slice_id, milestone_id, command, exit_code, verdict, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(params.taskId, params.sliceId, params.milestoneId, e.command, e.exitCode, e.verdict, e.durationMs ?? 0, now);
    }
  });

  updateStateMd(params.projectDir);
  return { milestoneId: params.milestoneId, sliceId: params.sliceId, taskId: params.taskId, status: 'done' };
}

// ---------------------------------------------------------------------------
// Complete Slice
// ---------------------------------------------------------------------------

export interface CompleteSliceParams {
  projectDir: string;
  milestoneId: string;
  sliceId: string;
  oneLiner: string;
  narrative: string;
  verificationResult: string;
  keyFiles?: string[];
  keyDecisions?: string[];
  requirementsAdvanced?: string[];
  uatContent?: string;
}

export function completeSlice(params: CompleteSliceParams): { milestoneId: string; sliceId: string; status: string } {
  const db = getDb(resolve(params.projectDir));
  const now = new Date().toISOString();

  const slice = getSlice(db, params.milestoneId, params.sliceId);
  if (!slice) throw new Error(`Slice '${params.sliceId}' not found in milestone '${params.milestoneId}'.`);
  if (slice.status === 'done') throw new Error(`Slice '${params.sliceId}' is already complete.`);

  // Check all tasks are done
  const pendingTasks = db.prepare(
    `SELECT id FROM tasks WHERE milestone_id=? AND slice_id=? AND status != 'done'`
  ).all(params.milestoneId, params.sliceId);

  if (pendingTasks.length > 0) {
    const ids = pendingTasks.map(t => t['id']).join(', ');
    throw new Error(`Cannot complete slice — pending tasks: ${ids}. Complete all tasks first.`);
  }

  const summaryMd = renderSliceSummary(params);
  const uatMd = params.uatContent ?? '';

  transaction(db, () => {
    db.prepare(`
      UPDATE slices SET
        status='done', completed_at=?,
        full_summary_md=?, full_uat_md=?
      WHERE milestone_id=? AND id=?
    `).run(now, summaryMd, uatMd, params.milestoneId, params.sliceId);
  });

  // Write summary file
  const absDir = resolve(params.projectDir);
  const sDir = join(absDir, '.sdd', 'milestones', params.milestoneId, params.sliceId);
  if (!existsSync(sDir)) mkdirSync(sDir, { recursive: true });
  writeFileSync(join(sDir, `${params.sliceId}-SUMMARY.md`), summaryMd, 'utf-8');

  updateStateMd(params.projectDir);
  return { milestoneId: params.milestoneId, sliceId: params.sliceId, status: 'done' };
}

function renderSliceSummary(p: CompleteSliceParams): string {
  return [
    `# ${p.sliceId} — Complete`,
    '',
    `**Summary:** ${p.oneLiner}`,
    '',
    `## What Was Done`,
    p.narrative,
    '',
    `## Verification`,
    p.verificationResult,
    '',
    p.keyFiles?.length ? `## Key Files\n${p.keyFiles.map(f => `- ${f}`).join('\n')}\n` : '',
    p.keyDecisions?.length ? `## Key Decisions\n${p.keyDecisions.map(d => `- ${d}`).join('\n')}\n` : '',
    p.requirementsAdvanced?.length ? `## Requirements Advanced\n${p.requirementsAdvanced.map(r => `- ${r}`).join('\n')}\n` : '',
    `Completed: ${new Date().toISOString()}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Complete Milestone
// ---------------------------------------------------------------------------

export interface CompleteMilestoneParams {
  projectDir: string;
  milestoneId: string;
  oneLiner: string;
  narrative: string;
  successCriteriaResults: string;
  definitionOfDoneResults: string;
  keyDecisions?: string[];
  keyFiles?: string[];
  lessonsLearned?: string[];
}

export function completeMilestone(params: CompleteMilestoneParams): { milestoneId: string; status: string; summaryPath: string } {
  const db = getDb(resolve(params.projectDir));
  const now = new Date().toISOString();

  const milestone = getMilestone(db, params.milestoneId);
  if (!milestone) throw new Error(`Milestone '${params.milestoneId}' not found.`);
  if (milestone.status === 'done') throw new Error(`Milestone '${params.milestoneId}' is already complete.`);

  // Check all slices are done
  const pendingSlices = db.prepare(
    `SELECT id FROM slices WHERE milestone_id=? AND status != 'done'`
  ).all(params.milestoneId);

  if (pendingSlices.length > 0) {
    const ids = pendingSlices.map(s => s['id']).join(', ');
    throw new Error(`Cannot complete milestone — pending slices: ${ids}.`);
  }

  transaction(db, () => {
    db.prepare(`UPDATE milestones SET status='done', completed_at=? WHERE id=?`).run(now, params.milestoneId);
  });

  // Write milestone summary
  const absDir = resolve(params.projectDir);
  const mDir = join(absDir, '.sdd', 'milestones', params.milestoneId);
  if (!existsSync(mDir)) mkdirSync(mDir, { recursive: true });
  const summaryPath = join(mDir, `${params.milestoneId}-SUMMARY.md`);
  writeFileSync(summaryPath, renderMilestoneSummary(params), 'utf-8');

  updateStateMd(params.projectDir);
  return { milestoneId: params.milestoneId, status: 'done', summaryPath };
}

function renderMilestoneSummary(p: CompleteMilestoneParams): string {
  return [
    `# ${p.milestoneId} — Complete`,
    '',
    `**Summary:** ${p.oneLiner}`,
    '',
    `## What Was Delivered`,
    p.narrative,
    '',
    `## Success Criteria Results`,
    p.successCriteriaResults,
    '',
    `## Definition of Done Results`,
    p.definitionOfDoneResults,
    '',
    p.keyDecisions?.length ? `## Key Decisions\n${p.keyDecisions.map(d => `- ${d}`).join('\n')}\n` : '',
    p.keyFiles?.length ? `## Key Files\n${p.keyFiles.map(f => `- ${f}`).join('\n')}\n` : '',
    p.lessonsLearned?.length ? `## Lessons Learned\n${p.lessonsLearned.map(l => `- ${l}`).join('\n')}\n` : '',
    `Completed: ${new Date().toISOString()}`,
  ].join('\n');
}
