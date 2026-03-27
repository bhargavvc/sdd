// SDD Extension — write-intercept unit tests
// Tests isBlockedStateFile() and BLOCKED_WRITE_ERROR constant.

import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedStateFile, BLOCKED_WRITE_ERROR } from '../write-intercept.ts';

// ─── isBlockedStateFile: blocked paths ───────────────────────────────────

test('write-intercept: blocks unix .sdd/STATE.md path', () => {
  assert.strictEqual(isBlockedStateFile('/project/.sdd/STATE.md'), true);
});

test('write-intercept: blocks relative path with dir prefix before .sdd/STATE.md', () => {
  assert.strictEqual(isBlockedStateFile('project/.sdd/STATE.md'), true);
});

test('write-intercept: blocks bare relative .sdd/STATE.md (no leading separator)', () => {
  // (^|[/\\]) matches paths that start with .sdd/ — covers the case where write
  // tools receive a bare relative path before the file exists (realpathSync fails).
  assert.strictEqual(isBlockedStateFile('.sdd/STATE.md'), true);
});

test('write-intercept: blocks nested project .sdd/STATE.md path', () => {
  assert.strictEqual(isBlockedStateFile('/Users/dev/my-project/.sdd/STATE.md'), true);
});

test('write-intercept: blocks .sdd/projects/<name>/STATE.md (symlinked projects path)', () => {
  assert.strictEqual(isBlockedStateFile('/home/user/.sdd/projects/my-project/STATE.md'), true);
});

// ─── isBlockedStateFile: allowed paths ───────────────────────────────────

test('write-intercept: allows .sdd/ROADMAP.md', () => {
  assert.strictEqual(isBlockedStateFile('/project/.sdd/ROADMAP.md'), false);
});

test('write-intercept: allows .sdd/PLAN.md', () => {
  assert.strictEqual(isBlockedStateFile('/project/.sdd/PLAN.md'), false);
});

test('write-intercept: allows .sdd/REQUIREMENTS.md', () => {
  assert.strictEqual(isBlockedStateFile('/project/.sdd/REQUIREMENTS.md'), false);
});

test('write-intercept: allows .sdd/SUMMARY.md', () => {
  assert.strictEqual(isBlockedStateFile('/project/.sdd/SUMMARY.md'), false);
});

test('write-intercept: allows .sdd/PROJECT.md', () => {
  assert.strictEqual(isBlockedStateFile('/project/.sdd/PROJECT.md'), false);
});

test('write-intercept: allows regular source files', () => {
  assert.strictEqual(isBlockedStateFile('/project/src/index.ts'), false);
});

test('write-intercept: allows slice plan files', () => {
  assert.strictEqual(isBlockedStateFile('/project/.sdd/milestones/M001/slices/S01/S01-PLAN.md'), false);
});

test('write-intercept: does not block files named STATE.md outside .sdd/', () => {
  assert.strictEqual(isBlockedStateFile('/project/docs/STATE.md'), false);
});

// ─── BLOCKED_WRITE_ERROR: content ────────────────────────────────────────

test('write-intercept: BLOCKED_WRITE_ERROR is a non-empty string', () => {
  assert.strictEqual(typeof BLOCKED_WRITE_ERROR, 'string');
  assert.ok(BLOCKED_WRITE_ERROR.length > 0);
});

test('write-intercept: BLOCKED_WRITE_ERROR mentions engine tool calls', () => {
  assert.ok(BLOCKED_WRITE_ERROR.includes('sdd_complete_task'), 'should mention sdd_complete_task');
  assert.ok(BLOCKED_WRITE_ERROR.includes('engine tool calls'), 'should mention engine tool calls');
});
