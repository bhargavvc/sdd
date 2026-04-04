/**
 * Lifecycle tools: sdd_replan_slice, sdd_reassess_roadmap,
 *                  sdd_validate_milestone, sdd_reopen_slice, sdd_reopen_task
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getDb, transaction, getMilestone, getSlice, getTask } from '../db.js';
import { updateStateMd } from '../state-writer.js';

// ---------------------------------------------------------------------------
// Replan Slice
// ---------------------------------------------------------------------------

export interface ReplanSliceParams {
  projectDir: string;
  milestoneId: string;
  sliceId: string;
  reason: string;
  updatedTasks: Array<{
    taskId: string;
    title: string;
    description: string;
    estimate: string;
    verify: string;
  }>;
  removedTaskIds?: string[];
}

export function replanSlice(params: ReplanSliceParams): { milestoneId: string; sliceId: string; tasksUpdated: number } {
  const db = getDb(resolve(params.projectDir));
  const now = new Date().toISOString();

  if (!getSlice(db, params.milestoneId, params.sliceId)) {
    throw new Error(`Slice '${params.sliceId}' not found.`);
  }

  transaction(db, () => {
    // Log replan
    db.prepare(`
      INSERT INTO replan_history (milestone_id, slice_id, summary, created_at)
      VALUES (?, ?, ?, ?)
    `).run(params.milestoneId, params.sliceId, params.reason, now);

    // Mark slice as replanned
    db.prepare(`UPDATE slices SET replan_triggered_at=? WHERE milestone_id=? AND id=?`)
      .run(now, params.milestoneId, params.sliceId);

    // Remove specified tasks
    for (const tid of (params.removedTaskIds ?? [])) {
      db.prepare(`DELETE FROM tasks WHERE milestone_id=? AND slice_id=? AND id=?`)
        .run(params.milestoneId, params.sliceId, tid);
    }

    // Upsert updated tasks
    params.updatedTasks.forEach((t, idx) => {
      db.prepare(`
        INSERT INTO tasks (milestone_id, slice_id, id, title, status, description, estimate, verify, sequence, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
        ON CONFLICT(milestone_id, slice_id, id) DO UPDATE SET
          title=excluded.title, description=excluded.description,
          estimate=excluded.estimate, verify=excluded.verify, sequence=excluded.sequence
      `).run(params.milestoneId, params.sliceId, t.taskId, t.title, t.description, t.estimate, t.verify, idx, now);
    });
  });

  updateStateMd(params.projectDir);
  return { milestoneId: params.milestoneId, sliceId: params.sliceId, tasksUpdated: params.updatedTasks.length };
}

// ---------------------------------------------------------------------------
// Reassess Roadmap
// ---------------------------------------------------------------------------

export interface ReassessRoadmapParams {
  projectDir: string;
  milestoneId: string;
  completedSliceId: string;
  verdict: 'on-track' | 'needs-adjustment' | 'pivot';
  assessment: string;
  sliceChanges?: {
    modified?: Array<{ sliceId: string; reason: string }>;
    added?: Array<{ sliceId: string; title: string; reason: string }>;
    removed?: string[];
  };
}

export function reassessRoadmap(params: ReassessRoadmapParams): { milestoneId: string; verdict: string; changesApplied: boolean } {
  const db = getDb(resolve(params.projectDir));
  const now = new Date().toISOString();

  if (!getMilestone(db, params.milestoneId)) throw new Error(`Milestone '${params.milestoneId}' not found.`);

  const changes = params.sliceChanges ?? {};
  let changesApplied = false;

  transaction(db, () => {
    // Log the assessment
    db.prepare(`
      INSERT INTO replan_history (milestone_id, summary, created_at)
      VALUES (?, ?, ?)
    `).run(params.milestoneId, `[reassess] ${params.verdict}: ${params.assessment}`, now);

    // Apply slice changes
    if (changes.removed?.length) {
      for (const sid of changes.removed) {
        db.prepare(`DELETE FROM slices WHERE milestone_id=? AND id=? AND status='pending'`).run(params.milestoneId, sid);
      }
      changesApplied = true;
    }

    if (changes.added?.length) {
      const maxSeq = (db.prepare(`SELECT MAX(sequence) as m FROM slices WHERE milestone_id=?`).get(params.milestoneId)?.['m'] as number | null) ?? 0;
      changes.added.forEach((s, i) => {
        db.prepare(`
          INSERT OR IGNORE INTO slices (milestone_id, id, title, status, risk, depends, demo, created_at, sequence)
          VALUES (?, ?, ?, 'pending', 'medium', '[]', '', ?, ?)
        `).run(params.milestoneId, s.sliceId, s.title, now, maxSeq + i + 1);
      });
      changesApplied = true;
    }
  });

  updateStateMd(params.projectDir);
  return { milestoneId: params.milestoneId, verdict: params.verdict, changesApplied };
}

// ---------------------------------------------------------------------------
// Validate Milestone
// ---------------------------------------------------------------------------

export interface ValidateMilestoneParams {
  projectDir: string;
  milestoneId: string;
  verdict: 'pass' | 'fail';
  successCriteriaChecklist: Array<{ criterion: string; passed: boolean; evidence: string }>;
  issues?: string[];
  notes?: string;
}

export function validateMilestone(params: ValidateMilestoneParams): { milestoneId: string; verdict: string; passRate: number } {
  const db = getDb(resolve(params.projectDir));
  const now = new Date().toISOString();

  if (!getMilestone(db, params.milestoneId)) throw new Error(`Milestone '${params.milestoneId}' not found.`);

  const passed = params.successCriteriaChecklist.filter(c => c.passed).length;
  const total = params.successCriteriaChecklist.length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  transaction(db, () => {
    // Log validation as a replan event
    const summary = `[validate] verdict=${params.verdict} passRate=${passRate}% ${params.notes ?? ''}`.trim();
    db.prepare(`INSERT INTO replan_history (milestone_id, summary, created_at) VALUES (?, ?, ?)`).run(params.milestoneId, summary, now);

    // Update milestone status if failed
    if (params.verdict === 'fail') {
      db.prepare(`UPDATE milestones SET status='active' WHERE id=? AND status='done'`).run(params.milestoneId);
    }
  });

  updateStateMd(params.projectDir);
  return { milestoneId: params.milestoneId, verdict: params.verdict, passRate };
}

// ---------------------------------------------------------------------------
// Reopen Slice / Task
// ---------------------------------------------------------------------------

export function reopenSlice(params: { projectDir: string; milestoneId: string; sliceId: string; reason?: string }): { sliceId: string; status: string } {
  const db = getDb(resolve(params.projectDir));
  const now = new Date().toISOString();

  const slice = getSlice(db, params.milestoneId, params.sliceId);
  if (!slice) throw new Error(`Slice '${params.sliceId}' not found.`);

  transaction(db, () => {
    db.prepare(`UPDATE slices SET status='active', completed_at=NULL WHERE milestone_id=? AND id=?`)
      .run(params.milestoneId, params.sliceId);
    if (params.reason) {
      db.prepare(`INSERT INTO replan_history (milestone_id, slice_id, summary, created_at) VALUES (?, ?, ?, ?)`)
        .run(params.milestoneId, params.sliceId, `[reopen] ${params.reason}`, now);
    }
  });

  updateStateMd(params.projectDir);
  return { sliceId: params.sliceId, status: 'active' };
}

export function reopenTask(params: { projectDir: string; milestoneId: string; sliceId: string; taskId: string; reason?: string }): { taskId: string; status: string } {
  const db = getDb(resolve(params.projectDir));
  const now = new Date().toISOString();

  const task = getTask(db, params.milestoneId, params.sliceId, params.taskId);
  if (!task) throw new Error(`Task '${params.taskId}' not found.`);

  transaction(db, () => {
    db.prepare(`UPDATE tasks SET status='pending', completed_at=NULL WHERE milestone_id=? AND slice_id=? AND id=?`)
      .run(params.milestoneId, params.sliceId, params.taskId);
    if (params.reason) {
      db.prepare(`INSERT INTO replan_history (milestone_id, slice_id, task_id, summary, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(params.milestoneId, params.sliceId, params.taskId, `[reopen-task] ${params.reason}`, now);
    }
  });

  updateStateMd(params.projectDir);
  return { taskId: params.taskId, status: 'pending' };
}
