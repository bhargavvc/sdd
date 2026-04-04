/**
 * Knowledge & Capture tools: sdd_capture, sdd_add_knowledge, sdd_quick_task
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getDb, transaction } from '../db.js';
import { updateStateMd } from '../state-writer.js';

// ---------------------------------------------------------------------------
// sdd_capture — fire-and-forget thought capture
// ---------------------------------------------------------------------------

export interface CaptureParams {
  projectDir: string;
  thought: string;
  category?: 'idea' | 'concern' | 'todo' | 'decision' | 'observation';
}

export function capture(params: CaptureParams): { captured: boolean; capturesFile: string } {
  const absDir = resolve(params.projectDir);
  const sddDir = join(absDir, '.sdd');
  const capturesFile = join(sddDir, 'CAPTURES.md');

  if (!existsSync(sddDir)) mkdirSync(sddDir, { recursive: true });

  const now = new Date().toISOString();
  const category = params.category || 'idea';
  const entry = `\n- **[${category}]** ${params.thought} _(${now})_`;

  if (!existsSync(capturesFile)) {
    writeFileSync(capturesFile, [
      '# Captures',
      '',
      '> Quick thoughts, ideas, and observations captured during development.',
      '> Use `sdd_capture` to add entries. Triage periodically.',
      '',
      '## Pending',
      entry,
    ].join('\n'), 'utf-8');
  } else {
    appendFileSync(capturesFile, entry + '\n', 'utf-8');
  }

  return { captured: true, capturesFile };
}

// ---------------------------------------------------------------------------
// sdd_add_knowledge — add rule/pattern/lesson to KNOWLEDGE.md
// ---------------------------------------------------------------------------

export interface AddKnowledgeParams {
  projectDir: string;
  type: 'rule' | 'pattern' | 'lesson' | 'gotcha';
  content: string;
  context?: string;
}

export function addKnowledge(params: AddKnowledgeParams): { added: boolean; knowledgeFile: string } {
  const absDir = resolve(params.projectDir);
  const sddDir = join(absDir, '.sdd');
  const knowledgeFile = join(sddDir, 'KNOWLEDGE.md');

  if (!existsSync(sddDir)) mkdirSync(sddDir, { recursive: true });

  const now = new Date().toISOString();
  const contextLine = params.context ? ` — _${params.context}_` : '';
  const entry = `\n- **[${params.type}]** ${params.content}${contextLine} _(${now})_`;

  if (!existsSync(knowledgeFile)) {
    writeFileSync(knowledgeFile, [
      '# Codebase Knowledge',
      '',
      '## Rules',
      '',
      '## Patterns',
      '',
      '## Lessons',
      '',
      '## Gotchas',
      '',
    ].join('\n'), 'utf-8');
  }

  // Append under the right section
  let content = readFileSync(knowledgeFile, 'utf-8');
  const sectionMap: Record<string, string> = {
    'rule': '## Rules',
    'pattern': '## Patterns',
    'lesson': '## Lessons',
    'gotcha': '## Gotchas',
  };
  const section = sectionMap[params.type] || '## Rules';
  const sectionIdx = content.indexOf(section);

  if (sectionIdx !== -1) {
    // Find end of section heading line
    const afterHeading = content.indexOf('\n', sectionIdx);
    if (afterHeading !== -1) {
      content = content.slice(0, afterHeading + 1) + entry + '\n' + content.slice(afterHeading + 1);
      writeFileSync(knowledgeFile, content, 'utf-8');
    } else {
      appendFileSync(knowledgeFile, entry + '\n', 'utf-8');
    }
  } else {
    appendFileSync(knowledgeFile, `\n${section}\n${entry}\n`, 'utf-8');
  }

  return { added: true, knowledgeFile };
}

// ---------------------------------------------------------------------------
// sdd_quick_task — lightweight task outside milestone ceremony
// ---------------------------------------------------------------------------

export interface QuickTaskParams {
  projectDir: string;
  description: string;
  oneLiner?: string;
}

export function quickTask(params: QuickTaskParams): { taskId: string; logged: boolean } {
  const absDir = resolve(params.projectDir);
  const sddDir = join(absDir, '.sdd');
  const queueFile = join(sddDir, 'QUEUE.md');

  if (!existsSync(sddDir)) mkdirSync(sddDir, { recursive: true });

  const now = new Date().toISOString();
  const taskId = `Q${Date.now().toString(36).toUpperCase()}`;
  const entry = `\n- **${taskId}**: ${params.description} _(${now})_`;

  if (!existsSync(queueFile)) {
    writeFileSync(queueFile, [
      '# Work Queue',
      '',
      '## Pending',
      entry,
      '',
      '## Completed',
      '',
      '_Nothing completed yet._',
    ].join('\n'), 'utf-8');
  } else {
    let content = readFileSync(queueFile, 'utf-8');
    const pendingIdx = content.indexOf('## Pending');
    if (pendingIdx !== -1) {
      const afterHeading = content.indexOf('\n', pendingIdx);
      if (afterHeading !== -1) {
        content = content.slice(0, afterHeading + 1) + entry + '\n' + content.slice(afterHeading + 1);
        writeFileSync(queueFile, content, 'utf-8');
      }
    } else {
      appendFileSync(queueFile, entry + '\n', 'utf-8');
    }
  }

  return { taskId, logged: true };
}
