/**
 * Unit tests for KNOWLEDGE.md integration.
 *
 * Tests:
 * - KNOWLEDGE is registered in SDD_ROOT_FILES
 * - resolveSddRootFile resolves KNOWLEDGE paths correctly
 * - inlineSddRootFile works with the KNOWLEDGE key
 * - before_agent_start hook includes/omits knowledge block appropriately
 * - loadKnowledgeBlock merges global and project knowledge correctly
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SDD_ROOT_FILES, resolveSddRootFile } from '../paths.ts';
import { inlineSddRootFile } from '../auto-prompts.ts';
import { appendKnowledge } from '../files.ts';
import { loadKnowledgeBlock } from '../bootstrap/system-context.ts';

// ─── KNOWLEDGE is registered in SDD_ROOT_FILES ─────────────────────────────

test('knowledge: KNOWLEDGE key exists in SDD_ROOT_FILES', () => {
  assert.ok('KNOWLEDGE' in SDD_ROOT_FILES, 'SDD_ROOT_FILES should have KNOWLEDGE key');
  assert.strictEqual(SDD_ROOT_FILES.KNOWLEDGE, 'KNOWLEDGE.md');
});

// ─── resolveSddRootFile resolves KNOWLEDGE.md ───────────────────────────────

test('knowledge: resolveSddRootFile returns canonical path when KNOWLEDGE.md exists', () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-knowledge-')));
  const sddDir = join(tmp, '.sdd');
  mkdirSync(sddDir, { recursive: true });
  writeFileSync(join(sddDir, 'KNOWLEDGE.md'), '# Project Knowledge\n');

  const resolved = resolveSddRootFile(tmp, 'KNOWLEDGE');
  assert.strictEqual(resolved, join(sddDir, 'KNOWLEDGE.md'));

  rmSync(tmp, { recursive: true, force: true });
});

test('knowledge: resolveSddRootFile resolves when legacy knowledge.md exists', () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-knowledge-')));
  const sddDir = join(tmp, '.sdd');
  mkdirSync(sddDir, { recursive: true });
  writeFileSync(join(sddDir, 'knowledge.md'), '# Project Knowledge\n');

  const resolved = resolveSddRootFile(tmp, 'KNOWLEDGE');
  // On case-insensitive filesystems (macOS), canonical path matches;
  // on case-sensitive (Linux), legacy path matches. Either is valid.
  const canonical = join(sddDir, 'KNOWLEDGE.md');
  const legacy = join(sddDir, 'knowledge.md');
  assert.ok(
    resolved === canonical || resolved === legacy,
    `resolved path should be canonical or legacy, got: ${resolved}`,
  );

  rmSync(tmp, { recursive: true, force: true });
});

test('knowledge: resolveSddRootFile returns canonical path when file does not exist', () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-knowledge-')));
  const sddDir = join(tmp, '.sdd');
  mkdirSync(sddDir, { recursive: true });

  const resolved = resolveSddRootFile(tmp, 'KNOWLEDGE');
  assert.strictEqual(resolved, join(sddDir, 'KNOWLEDGE.md'));

  rmSync(tmp, { recursive: true, force: true });
});

// ─── inlineSddRootFile works with knowledge.md ─────────────────────────────

test('knowledge: inlineSddRootFile returns content when KNOWLEDGE.md exists', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sdd-knowledge-'));
  const sddDir = join(tmp, '.sdd');
  mkdirSync(sddDir, { recursive: true });
  writeFileSync(join(sddDir, 'KNOWLEDGE.md'), '# Project Knowledge\n\n## Rules\n\nK001: Use real DB');

  const result = await inlineSddRootFile(tmp, 'knowledge.md', 'Project Knowledge');
  assert.ok(result !== null, 'should return content');
  assert.ok(result!.includes('Project Knowledge'), 'should include label');
  assert.ok(result!.includes('K001'), 'should include knowledge content');

  rmSync(tmp, { recursive: true, force: true });
});

test('knowledge: inlineSddRootFile returns null when KNOWLEDGE.md does not exist', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sdd-knowledge-'));
  const sddDir = join(tmp, '.sdd');
  mkdirSync(sddDir, { recursive: true });

  const result = await inlineSddRootFile(tmp, 'knowledge.md', 'Project Knowledge');
  assert.strictEqual(result, null, 'should return null when file does not exist');

  rmSync(tmp, { recursive: true, force: true });
});

// ─── appendKnowledge creates file and appends entries ──────────────────────

test('knowledge: appendKnowledge creates KNOWLEDGE.md with rule when file does not exist', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sdd-knowledge-'));
  const sddDir = join(tmp, '.sdd');
  mkdirSync(sddDir, { recursive: true });

  await appendKnowledge(tmp, 'rule', 'Use real DB for integration tests', 'M001/S01');

  const content = readFileSync(join(sddDir, 'KNOWLEDGE.md'), 'utf-8');
  assert.ok(content.includes('# Project Knowledge'), 'should have header');
  assert.ok(content.includes('K001'), 'should have K001 id');
  assert.ok(content.includes('Use real DB for integration tests'), 'should have rule text');
  assert.ok(content.includes('M001/S01'), 'should have scope');

  rmSync(tmp, { recursive: true, force: true });
});

test('knowledge: appendKnowledge appends to existing KNOWLEDGE.md with auto-incrementing ID', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sdd-knowledge-'));
  const sddDir = join(tmp, '.sdd');
  mkdirSync(sddDir, { recursive: true });

  // Create initial file with one rule
  await appendKnowledge(tmp, 'rule', 'First rule', 'M001');
  // Add second rule
  await appendKnowledge(tmp, 'rule', 'Second rule', 'M001/S02');

  const content = readFileSync(join(sddDir, 'KNOWLEDGE.md'), 'utf-8');
  assert.ok(content.includes('K001'), 'should have K001');
  assert.ok(content.includes('K002'), 'should have K002');
  assert.ok(content.includes('First rule'), 'should have first rule');
  assert.ok(content.includes('Second rule'), 'should have second rule');

  rmSync(tmp, { recursive: true, force: true });
});

test('knowledge: appendKnowledge handles pattern type', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sdd-knowledge-'));
  const sddDir = join(tmp, '.sdd');
  mkdirSync(sddDir, { recursive: true });

  await appendKnowledge(tmp, 'pattern', 'Middleware chain for auth', 'M001');

  const content = readFileSync(join(sddDir, 'KNOWLEDGE.md'), 'utf-8');
  assert.ok(content.includes('P001'), 'should have P001 id');
  assert.ok(content.includes('Middleware chain for auth'), 'should have pattern text');

  rmSync(tmp, { recursive: true, force: true });
});

test('knowledge: appendKnowledge handles lesson type', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sdd-knowledge-'));
  const sddDir = join(tmp, '.sdd');
  mkdirSync(sddDir, { recursive: true });

  await appendKnowledge(tmp, 'lesson', 'API timeout on large payloads', 'M002');

  const content = readFileSync(join(sddDir, 'KNOWLEDGE.md'), 'utf-8');
  assert.ok(content.includes('L001'), 'should have L001 id');
  assert.ok(content.includes('API timeout on large payloads'), 'should have lesson text');

  rmSync(tmp, { recursive: true, force: true });
});

// ─── loadKnowledgeBlock — global + project merge ────────────────────────────

test('loadKnowledgeBlock: returns empty block when neither file exists', () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-kb-')));
  const gsdHome = join(tmp, 'home');
  const cwd = join(tmp, 'project');
  mkdirSync(join(cwd, '.sdd'), { recursive: true });
  mkdirSync(join(gsdHome, 'agent'), { recursive: true });

  const result = loadKnowledgeBlock(gsdHome, cwd);
  assert.strictEqual(result.block, '');
  assert.strictEqual(result.globalSizeKb, 0);

  rmSync(tmp, { recursive: true, force: true });
});

test('loadKnowledgeBlock: uses project knowledge alone when no global file', () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-kb-')));
  const gsdHome = join(tmp, 'home');
  const cwd = join(tmp, 'project');
  mkdirSync(join(cwd, '.sdd'), { recursive: true });
  mkdirSync(join(gsdHome, 'agent'), { recursive: true });
  writeFileSync(join(cwd, '.sdd', 'KNOWLEDGE.md'), 'K001: Use real DB');

  const result = loadKnowledgeBlock(gsdHome, cwd);
  assert.ok(result.block.includes('[KNOWLEDGE — Rules, patterns, and lessons learned]'));
  assert.ok(result.block.includes('## Project Knowledge'));
  assert.ok(result.block.includes('K001: Use real DB'));
  assert.ok(!result.block.includes('## Global Knowledge'));
  assert.strictEqual(result.globalSizeKb, 0);

  rmSync(tmp, { recursive: true, force: true });
});

test('loadKnowledgeBlock: uses global knowledge alone when no project file', () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-kb-')));
  const gsdHome = join(tmp, 'home');
  const cwd = join(tmp, 'project');
  mkdirSync(join(cwd, '.sdd'), { recursive: true });
  mkdirSync(join(gsdHome, 'agent'), { recursive: true });
  writeFileSync(join(gsdHome, 'agent', 'KNOWLEDGE.md'), 'G001: Respond in English');

  const result = loadKnowledgeBlock(gsdHome, cwd);
  assert.ok(result.block.includes('[KNOWLEDGE — Rules, patterns, and lessons learned]'));
  assert.ok(result.block.includes('## Global Knowledge'));
  assert.ok(result.block.includes('G001: Respond in English'));
  assert.ok(!result.block.includes('## Project Knowledge'));
  assert.ok(result.globalSizeKb > 0);

  rmSync(tmp, { recursive: true, force: true });
});

test('loadKnowledgeBlock: merges global before project when both exist', () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-kb-')));
  const gsdHome = join(tmp, 'home');
  const cwd = join(tmp, 'project');
  mkdirSync(join(cwd, '.sdd'), { recursive: true });
  mkdirSync(join(gsdHome, 'agent'), { recursive: true });
  writeFileSync(join(gsdHome, 'agent', 'KNOWLEDGE.md'), 'G001: Global rule');
  writeFileSync(join(cwd, '.sdd', 'KNOWLEDGE.md'), 'K001: Project rule');

  const result = loadKnowledgeBlock(gsdHome, cwd);
  assert.ok(result.block.includes('## Global Knowledge'));
  assert.ok(result.block.includes('## Project Knowledge'));
  assert.ok(result.block.includes('G001: Global rule'));
  assert.ok(result.block.includes('K001: Project rule'));
  // Global section appears before project section
  assert.ok(result.block.indexOf('## Global Knowledge') < result.block.indexOf('## Project Knowledge'));

  rmSync(tmp, { recursive: true, force: true });
});

test('loadKnowledgeBlock: reports globalSizeKb above 4KB threshold', () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-kb-')));
  const gsdHome = join(tmp, 'home');
  const cwd = join(tmp, 'project');
  mkdirSync(join(cwd, '.sdd'), { recursive: true });
  mkdirSync(join(gsdHome, 'agent'), { recursive: true });
  // Write > 4KB of content
  writeFileSync(join(gsdHome, 'agent', 'KNOWLEDGE.md'), 'x'.repeat(5000));

  const result = loadKnowledgeBlock(gsdHome, cwd);
  assert.ok(result.globalSizeKb > 4, `expected > 4KB, got ${result.globalSizeKb}`);

  rmSync(tmp, { recursive: true, force: true });
});
