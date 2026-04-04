/**
 * sdd_init_project — initialise .sdd/ directory and PROJECT.md for a project.
 */

import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getDb } from '../db.js';
import { updateStateMd } from '../state-writer.js';

export interface InitProjectParams {
  projectDir: string;
  projectName: string;
  description?: string;
}

export interface InitProjectResult {
  projectDir: string;
  sddDir: string;
  dbPath: string;
  projectMdPath: string;
  alreadyInitialised: boolean;
}

function writeIfMissing(path: string, content: string): void {
  if (!existsSync(path)) writeFileSync(path, content, 'utf-8');
}

export function initProject(params: InitProjectParams): InitProjectResult {
  const absDir = resolve(params.projectDir);
  const sddDir = join(absDir, '.sdd');
  const dbPath = join(sddDir, 'sdd.db');
  const projectMdPath = join(sddDir, 'PROJECT.md');

  const alreadyInitialised = existsSync(dbPath);

  // Opens DB and runs schema init (creates .sdd/ dir if missing)
  getDb(absDir);

  const now = new Date().toISOString();

  // Write PROJECT.md if not already there
  if (!existsSync(projectMdPath)) {
    writeFileSync(projectMdPath, [
      `# ${params.projectName}`,
      '',
      params.description ? `${params.description}` : '> Add project description here.',
      '',
      '## SDD Setup',
      '',
      `- Initialised: ${now}`,
      `- Tool: @bhargavvc/sdd-cursor`,
      '',
      '## Milestones',
      '',
      '_No milestones yet. Use `sdd_plan_milestone` to create one._',
    ].join('\n'), 'utf-8');
  }

  // Write STATE.md
  writeIfMissing(join(sddDir, 'STATE.md'), [
    '# SDD State',
    '',
    `**Project:** ${params.projectName}`,
    `**Status:** initialised`,
    `**Active milestone:** none`,
    `**Current phase:** pre-planning`,
    '',
    `_Auto-updated by @bhargavvc/sdd-cursor_`,
    `_Last updated: ${now}_`,
  ].join('\n'));

  // Write CONTEXT.md
  writeIfMissing(join(sddDir, 'CONTEXT.md'), [
    '# Project Context',
    '',
    `## ${params.projectName}`,
    '',
    params.description || '> Describe the project context, goals, and constraints here.',
    '',
    '## Tech Stack',
    '',
    '> List the tech stack here (framework, language, DB, etc.)',
    '',
    '## Team',
    '',
    '> Describe team structure, roles, and responsibilities.',
  ].join('\n'));

  // Write DECISIONS.md
  writeIfMissing(join(sddDir, 'DECISIONS.md'), [
    '# Key Decisions',
    '',
    '| # | Decision | Rationale | Made by | Date |',
    '|---|----------|-----------|---------|------|',
    '',
    '_Decisions are logged here as they are made during development._',
  ].join('\n'));

  // Write KNOWLEDGE.md
  writeIfMissing(join(sddDir, 'KNOWLEDGE.md'), [
    '# Codebase Knowledge',
    '',
    '## Patterns',
    '',
    '> Document patterns, conventions, and important codebase knowledge here.',
    '',
    '## Gotchas',
    '',
    '> Known pitfalls, workarounds, and things to watch out for.',
  ].join('\n'));

  // Write REQUIREMENTS.md
  writeIfMissing(join(sddDir, 'REQUIREMENTS.md'), [
    '# Requirements',
    '',
    '| ID | Class | Description | Status | Owner |',
    '|----|-------|-------------|--------|-------|',
    '',
    '_Requirements are tracked here and linked to milestones/slices._',
  ].join('\n'));

  // Write QUEUE.md
  writeIfMissing(join(sddDir, 'QUEUE.md'), [
    '# Work Queue',
    '',
    '## Pending',
    '',
    '_No queued work items._',
    '',
    '## Completed',
    '',
    '_Nothing completed yet._',
  ].join('\n'));

  // Write OVERRIDES.md
  writeIfMissing(join(sddDir, 'OVERRIDES.md'), [
    '# Overrides & Steering',
    '',
    '_User overrides and steering instructions are logged here._',
    '',
    '| Date | Override | Reason |',
    '|------|----------|--------|',
  ].join('\n'));

  updateStateMd(absDir);
  return { projectDir: absDir, sddDir, dbPath, projectMdPath, alreadyInitialised };
}
