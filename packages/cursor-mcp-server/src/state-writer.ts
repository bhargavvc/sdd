/**
 * STATE.md writer — updates .sdd/STATE.md after every state change.
 */

import { writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getDb, getMilestones, getSlices, getTasks } from './db.js';

export function updateStateMd(projectDir: string): void {
  const absDir = resolve(projectDir);
  const sddDir = join(absDir, '.sdd');
  const statePath = join(sddDir, 'STATE.md');

  if (!existsSync(sddDir)) return;

  const db = getDb(absDir);
  const milestones = getMilestones(db);
  const now = new Date().toISOString();

  // Find active milestone
  const active = milestones.find(m => m.status === 'active');
  let currentPhase = 'pre-planning';
  let activeSlice = 'none';
  let activeTask = 'none';
  let totalTasks = 0;
  let doneTasks = 0;

  const lines: string[] = [
    '# SDD State',
    '',
    `**Last updated:** ${now}`,
    '',
  ];

  if (active) {
    const slices = getSlices(db, active.id);
    const pendingSlice = slices.find(s => s.status !== 'done');

    for (const s of slices) {
      const tasks = getTasks(db, active.id, s.id);
      totalTasks += tasks.length;
      doneTasks += tasks.filter(t => t.status === 'done').length;
    }

    if (pendingSlice) {
      activeSlice = `${pendingSlice.id}: ${pendingSlice.title}`;
      const tasks = getTasks(db, active.id, pendingSlice.id);
      const pendingTask = tasks.find(t => t.status !== 'done');
      if (tasks.length === 0) currentPhase = 'planning';
      else if (pendingTask) { currentPhase = 'executing'; activeTask = `${pendingTask.id}: ${pendingTask.title}`; }
      else currentPhase = 'completing';
    } else if (slices.length > 0 && slices.every(s => s.status === 'done')) {
      currentPhase = 'validating';
    }

    lines.push(
      `## Active Milestone: ${active.id}`,
      '',
      `**Title:** ${active.title}`,
      `**Phase:** ${currentPhase}`,
      `**Active slice:** ${activeSlice}`,
      `**Active task:** ${activeTask}`,
      `**Progress:** ${totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0}% (${doneTasks}/${totalTasks} tasks)`,
      '',
    );
  } else {
    lines.push(`**Status:** ${milestones.length > 0 && milestones.every(m => m.status === 'done') ? 'all milestones complete' : 'no active milestone'}`, '');
  }

  // Milestone summary table
  if (milestones.length > 0) {
    lines.push('## Milestones', '', '| ID | Title | Status | Progress |', '|---|---|---|---|');
    for (const m of milestones) {
      const slices = getSlices(db, m.id);
      let mt = 0, md = 0;
      for (const s of slices) { const tasks = getTasks(db, m.id, s.id); mt += tasks.length; md += tasks.filter(t => t.status === 'done').length; }
      const pct = mt > 0 ? Math.round((md / mt) * 100) : 0;
      lines.push(`| ${m.id} | ${m.title} | ${m.status} | ${pct}% (${md}/${mt}) |`);
    }
    lines.push('');
  }

  lines.push('_Auto-updated by @bhargavvc/sdd-cursor_');

  writeFileSync(statePath, lines.join('\n'), 'utf-8');
}
