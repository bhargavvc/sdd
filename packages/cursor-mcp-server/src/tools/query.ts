/**
 * Query tools: sdd_query_state, sdd_query_milestone, sdd_list_templates
 */

import { resolve } from 'node:path';
import { getDb, getMilestone, getMilestones, getSlices, getTasks } from '../db.js';

// ---------------------------------------------------------------------------
// Query State — full project overview
// ---------------------------------------------------------------------------

export interface ProjectState {
  projectDir: string;
  milestones: MilestoneSummary[];
  activeMilestone: MilestoneSummary | null;
  totalTasks: number;
  completedTasks: number;
  progressPercent: number;
}

export interface MilestoneSummary {
  id: string;
  title: string;
  status: string;
  sliceCount: number;
  completedSlices: number;
  taskCount: number;
  completedTasks: number;
  progressPercent: number;
}

export function queryState(params: { projectDir: string }): ProjectState {
  const db = getDb(resolve(params.projectDir));
  const allMilestones = getMilestones(db);

  let totalTasks = 0;
  let completedTasks = 0;

  const summaries: MilestoneSummary[] = allMilestones.map(m => {
    const slices = getSlices(db, m.id);
    const completedSlices = slices.filter(s => s.status === 'done').length;
    let mTasks = 0;
    let mDone = 0;
    for (const s of slices) {
      const tasks = getTasks(db, m.id, s.id);
      mTasks += tasks.length;
      mDone += tasks.filter(t => t.status === 'done').length;
    }
    totalTasks += mTasks;
    completedTasks += mDone;
    return {
      id: m.id,
      title: m.title,
      status: m.status,
      sliceCount: slices.length,
      completedSlices,
      taskCount: mTasks,
      completedTasks: mDone,
      progressPercent: mTasks > 0 ? Math.round((mDone / mTasks) * 100) : 0,
    };
  });

  const activeMilestone = summaries.find(m => m.status === 'active') ?? null;

  return {
    projectDir: resolve(params.projectDir),
    milestones: summaries,
    activeMilestone,
    totalTasks,
    completedTasks,
    progressPercent: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// Query Milestone — detailed drill-down
// ---------------------------------------------------------------------------

export interface MilestoneDetail {
  id: string;
  title: string;
  status: string;
  vision: string;
  successCriteria: string[];
  definitionOfDone: string[];
  slices: SliceDetail[];
  progressPercent: number;
}

export interface SliceDetail {
  id: string;
  title: string;
  status: string;
  risk: string;
  goal: string;
  tasks: TaskDetail[];
  progressPercent: number;
}

export interface TaskDetail {
  id: string;
  title: string;
  status: string;
  estimate: string;
  completedAt: string | null;
  blockerDiscovered: boolean;
}

export function queryMilestone(params: { projectDir: string; milestoneId: string }): MilestoneDetail {
  const db = getDb(resolve(params.projectDir));
  const m = getMilestone(db, params.milestoneId);
  if (!m) throw new Error(`Milestone '${params.milestoneId}' not found.`);

  const slices = getSlices(db, m.id);
  let totalTasks = 0;
  let doneTasks = 0;

  const sliceDetails: SliceDetail[] = slices.map(s => {
    const tasks = getTasks(db, m.id, s.id);
    const done = tasks.filter(t => t.status === 'done').length;
    totalTasks += tasks.length;
    doneTasks += done;
    return {
      id: s.id,
      title: s.title,
      status: s.status,
      risk: s.risk,
      goal: s.goal,
      tasks: tasks.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        estimate: t.estimate,
        completedAt: t.completed_at,
        blockerDiscovered: t.blocker_discovered === 1,
      })),
      progressPercent: tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0,
    };
  });

  return {
    id: m.id,
    title: m.title,
    status: m.status,
    vision: m.vision,
    successCriteria: JSON.parse(m.success_criteria || '[]') as string[],
    definitionOfDone: JSON.parse(m.definition_of_done || '[]') as string[],
    slices: sliceDetails,
    progressPercent: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// List Templates
// ---------------------------------------------------------------------------

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  ceremony: string;
  when: string;
}

export function listTemplates(): WorkflowTemplate[] {
  return [
    {
      id: 'feature',
      name: 'Feature',
      description: 'Full SDD ceremony for a new feature',
      ceremony: 'discuss → plan-milestone → plan-slice → execute tasks → complete-slice → complete-milestone',
      when: 'New feature with multiple slices (2+ days of work)',
    },
    {
      id: 'bugfix',
      name: 'Bug Fix',
      description: 'Triage, fix, verify, ship',
      ceremony: 'plan-milestone (1 slice) → plan-slice (1-3 tasks) → complete-task → complete-slice → complete-milestone',
      when: 'Known bug with clear reproduction steps',
    },
    {
      id: 'hotfix',
      name: 'Hotfix',
      description: 'Emergency fix — minimal ceremony',
      ceremony: 'plan-task → complete-task → complete-slice → complete-milestone',
      when: 'Production incident requiring immediate fix',
    },
    {
      id: 'spike',
      name: 'Spike / Research',
      description: 'Time-boxed investigation',
      ceremony: 'plan-milestone (research tasks) → complete tasks → reassess-roadmap',
      when: 'Unknown feasibility or approach needs investigation',
    },
    {
      id: 'refactor',
      name: 'Refactor',
      description: 'Code improvement without functional change',
      ceremony: 'plan-milestone → inventory slice → migration slices → validate-milestone',
      when: 'Improving code quality, paying down tech debt',
    },
  ];
}
