/**
 * @bhargavvc/sdd-cursor MCP Server
 *
 * Registers 22 SDD tools for Cursor.
 * Zero Anthropic dependency — Cursor's own AI does the reasoning.
 * Includes full SDD prompts, skills, and templates.
 */

import { z } from 'zod';
import { initProject } from './tools/init.js';
import { planMilestone, planSlice, planTask } from './tools/planning.js';
import { completeTask, completeSlice, completeMilestone } from './tools/completion.js';
import { replanSlice, reassessRoadmap, validateMilestone, reopenSlice, reopenTask } from './tools/lifecycle.js';
import { queryState, queryMilestone, listTemplates } from './tools/query.js';
import { getGuide, getSkill, listSkills, getTemplate } from './tools/guides.js';
import { capture, addKnowledge, quickTask } from './tools/knowledge.js';

const MCP_PKG = '@modelcontextprotocol/sdk';

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function ok(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

function run<T>(fn: () => T): ReturnType<typeof ok> | ReturnType<typeof err> {
  try { return ok(fn()); }
  catch (e) { return err(e instanceof Error ? e.message : String(e)); }
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export async function createCursorMcpServer() {
  const { McpServer } = await import(`${MCP_PKG}/server/mcp.js`) as { McpServer: new (info: { name: string; version: string }) => unknown };
  const server = new McpServer({ name: 'sdd-cursor', version: '1.0.0' }) as {
    tool(name: string, desc: string, schema: Record<string, unknown>, handler: (args: Record<string, unknown>) => unknown): void;
    connect(transport: unknown): Promise<void>;
    close(): Promise<void>;
  };

  // ── 1. sdd_init_project ────────────────────────────────────────────────────
  server.tool('sdd_init_project', 'Initialise .sdd/ directory and PROJECT.md for a project. Run this first before any other SDD tool.',
    { projectDir: z.string().describe('Absolute path to the project root'), projectName: z.string(), description: z.string().optional() },
    (a) => run(() => initProject({ projectDir: a['projectDir'] as string, projectName: a['projectName'] as string, description: a['description'] as string | undefined }))
  );

  // ── 2. sdd_plan_milestone ──────────────────────────────────────────────────
  server.tool('sdd_plan_milestone', 'Create or update a milestone with vision, success criteria, risks, proof strategy, verification contracts, and slices. Writes ROADMAP.md.',
    {
      projectDir: z.string(),
      milestoneId: z.string().describe('e.g. M001'),
      title: z.string(),
      vision: z.string(),
      successCriteria: z.array(z.string()).min(1),
      keyRisks: z.array(z.object({ risk: z.string(), whyItMatters: z.string() })),
      proofStrategy: z.array(z.object({ riskOrUnknown: z.string(), retireIn: z.string(), whatWillBeProven: z.string() })),
      verificationContract: z.string(),
      verificationIntegration: z.string(),
      verificationOperational: z.string(),
      verificationUat: z.string(),
      definitionOfDone: z.array(z.string()).min(1),
      requirementCoverage: z.string(),
      boundaryMapMarkdown: z.string(),
      slices: z.array(z.object({
        sliceId: z.string(),
        title: z.string(),
        risk: z.enum(['low', 'medium', 'high', 'critical']),
        depends: z.array(z.string()),
        demo: z.string(),
        goal: z.string(),
        successCriteria: z.string(),
        proofLevel: z.string(),
        integrationClosure: z.string(),
        observabilityImpact: z.string(),
      })).min(1),
    },
    (a) => run(() => planMilestone(a as unknown as Parameters<typeof planMilestone>[0]))
  );

  // ── 3. sdd_plan_slice ──────────────────────────────────────────────────────
  server.tool('sdd_plan_slice', 'Plan a slice with tasks. Writes slice PLAN.md. Call after sdd_plan_milestone.',
    {
      projectDir: z.string(),
      milestoneId: z.string(),
      sliceId: z.string(),
      goal: z.string(),
      successCriteria: z.string(),
      proofLevel: z.string(),
      integrationClosure: z.string(),
      observabilityImpact: z.string(),
      tasks: z.array(z.object({
        taskId: z.string(),
        title: z.string(),
        description: z.string(),
        estimate: z.string(),
        verify: z.string(),
        files: z.array(z.string()).optional(),
        inputs: z.array(z.string()).optional(),
        expectedOutput: z.array(z.string()).optional(),
        observabilityImpact: z.string().optional(),
      })).min(1),
    },
    (a) => run(() => planSlice(a as unknown as Parameters<typeof planSlice>[0]))
  );

  // ── 4. sdd_plan_task ───────────────────────────────────────────────────────
  server.tool('sdd_plan_task', 'Plan a single task within a slice.',
    {
      projectDir: z.string(),
      milestoneId: z.string(),
      sliceId: z.string(),
      taskId: z.string(),
      title: z.string(),
      description: z.string(),
      estimate: z.string(),
      verify: z.string(),
      files: z.array(z.string()).optional(),
      inputs: z.array(z.string()).optional(),
      expectedOutput: z.array(z.string()).optional(),
    },
    (a) => run(() => planTask(a as unknown as Parameters<typeof planTask>[0]))
  );

  // ── 5. sdd_complete_task ───────────────────────────────────────────────────
  server.tool('sdd_complete_task', 'Mark a task as done. REQUIRES verificationEvidence (test results, build output, etc.).',
    {
      projectDir: z.string(),
      milestoneId: z.string(),
      sliceId: z.string(),
      taskId: z.string(),
      oneLiner: z.string().describe('One-sentence summary of what was done'),
      narrative: z.string().describe('2-5 sentences describing the implementation'),
      verificationResult: z.string(),
      verificationEvidence: z.array(z.object({
        command: z.string(),
        exitCode: z.number(),
        verdict: z.enum(['pass', 'fail']),
        durationMs: z.number().optional(),
      })).min(1),
      keyFiles: z.array(z.string()).optional(),
      keyDecisions: z.array(z.string()).optional(),
      blockerDiscovered: z.boolean().optional(),
      deviations: z.string().optional(),
      knownIssues: z.string().optional(),
    },
    (a) => run(() => completeTask(a as unknown as Parameters<typeof completeTask>[0]))
  );

  // ── 6. sdd_complete_slice ──────────────────────────────────────────────────
  server.tool('sdd_complete_slice', 'Mark a slice as done. All tasks must be complete first. Writes SUMMARY.md.',
    {
      projectDir: z.string(),
      milestoneId: z.string(),
      sliceId: z.string(),
      oneLiner: z.string(),
      narrative: z.string(),
      verificationResult: z.string(),
      keyFiles: z.array(z.string()).optional(),
      keyDecisions: z.array(z.string()).optional(),
      requirementsAdvanced: z.array(z.string()).optional(),
      uatContent: z.string().optional(),
    },
    (a) => run(() => completeSlice(a as unknown as Parameters<typeof completeSlice>[0]))
  );

  // ── 7. sdd_complete_milestone ──────────────────────────────────────────────
  server.tool('sdd_complete_milestone', 'Mark a milestone as done. All slices must be complete first. Writes SUMMARY.md.',
    {
      projectDir: z.string(),
      milestoneId: z.string(),
      oneLiner: z.string(),
      narrative: z.string(),
      successCriteriaResults: z.string(),
      definitionOfDoneResults: z.string(),
      keyDecisions: z.array(z.string()).optional(),
      keyFiles: z.array(z.string()).optional(),
      lessonsLearned: z.array(z.string()).optional(),
    },
    (a) => run(() => completeMilestone(a as unknown as Parameters<typeof completeMilestone>[0]))
  );

  // ── 8. sdd_replan_slice ────────────────────────────────────────────────────
  server.tool('sdd_replan_slice', 'Adjust a slice plan mid-execution when a blocker or new information changes the approach.',
    {
      projectDir: z.string(),
      milestoneId: z.string(),
      sliceId: z.string(),
      reason: z.string(),
      updatedTasks: z.array(z.object({
        taskId: z.string(),
        title: z.string(),
        description: z.string(),
        estimate: z.string(),
        verify: z.string(),
      })).min(1),
      removedTaskIds: z.array(z.string()).optional(),
    },
    (a) => run(() => replanSlice(a as unknown as Parameters<typeof replanSlice>[0]))
  );

  // ── 9. sdd_reassess_roadmap ────────────────────────────────────────────────
  server.tool('sdd_reassess_roadmap', 'Reassess the milestone roadmap after completing a slice. Adjust remaining slices if needed.',
    {
      projectDir: z.string(),
      milestoneId: z.string(),
      completedSliceId: z.string(),
      verdict: z.enum(['on-track', 'needs-adjustment', 'pivot']),
      assessment: z.string(),
      sliceChanges: z.object({
        modified: z.array(z.object({ sliceId: z.string(), reason: z.string() })).optional(),
        added: z.array(z.object({ sliceId: z.string(), title: z.string(), reason: z.string() })).optional(),
        removed: z.array(z.string()).optional(),
      }).optional(),
    },
    (a) => run(() => reassessRoadmap(a as unknown as Parameters<typeof reassessRoadmap>[0]))
  );

  // ── 10. sdd_validate_milestone ─────────────────────────────────────────────
  server.tool('sdd_validate_milestone', 'Run validation checklist against milestone success criteria. Use before marking complete.',
    {
      projectDir: z.string(),
      milestoneId: z.string(),
      verdict: z.enum(['pass', 'fail']),
      successCriteriaChecklist: z.array(z.object({
        criterion: z.string(),
        passed: z.boolean(),
        evidence: z.string(),
      })).min(1),
      issues: z.array(z.string()).optional(),
      notes: z.string().optional(),
    },
    (a) => run(() => validateMilestone(a as unknown as Parameters<typeof validateMilestone>[0]))
  );

  // ── 11. sdd_reopen_slice ───────────────────────────────────────────────────
  server.tool('sdd_reopen_slice', 'Reopen a completed slice (e.g. when validation fails).',
    { projectDir: z.string(), milestoneId: z.string(), sliceId: z.string(), reason: z.string().optional() },
    (a) => run(() => reopenSlice(a as unknown as Parameters<typeof reopenSlice>[0]))
  );

  // ── 12. sdd_reopen_task ────────────────────────────────────────────────────
  server.tool('sdd_reopen_task', 'Reopen a completed task to fix an issue.',
    { projectDir: z.string(), milestoneId: z.string(), sliceId: z.string(), taskId: z.string(), reason: z.string().optional() },
    (a) => run(() => reopenTask(a as unknown as Parameters<typeof reopenTask>[0]))
  );

  // ── 13. sdd_query_state ────────────────────────────────────────────────────
  server.tool('sdd_query_state', 'Get full project state: all milestones, progress, active work. Call this to understand where you are.',
    { projectDir: z.string() },
    (a) => run(() => queryState({ projectDir: a['projectDir'] as string }))
  );

  // ── 14. sdd_query_milestone ────────────────────────────────────────────────
  server.tool('sdd_query_milestone', 'Get detailed info about a specific milestone: slices, tasks, progress.',
    { projectDir: z.string(), milestoneId: z.string() },
    (a) => run(() => queryMilestone({ projectDir: a['projectDir'] as string, milestoneId: a['milestoneId'] as string }))
  );

  // ── 15. sdd_list_templates ─────────────────────────────────────────────────
  server.tool('sdd_list_templates', 'List available SDD workflow templates (feature, bugfix, hotfix, spike, refactor).',
    {},
    () => run(() => listTemplates())
  );

  // ── 16. sdd_get_guide ─────────────────────────────────────────────────────
  server.tool('sdd_get_guide', 'Get the SDD methodology guide for a specific phase. Call this BEFORE starting any phase to get detailed instructions on how to approach it. Phases: discuss-milestone, discuss-slice, research-milestone, research-slice, plan-milestone, plan-slice, execute-task, complete-slice, complete-milestone, validate-milestone, reassess-roadmap, replan-slice, run-uat, quick-task, system, rethink, queue, doctor, workflow-start',
    { phase: z.string().describe('Phase name, e.g. "discuss-milestone", "execute-task", "plan-slice"') },
    (a) => run(() => getGuide({ phase: a['phase'] as string }))
  );

  // ── 17. sdd_get_skill ─────────────────────────────────────────────────────
  server.tool('sdd_get_skill', 'Get detailed instructions for an SDD skill. Skills are specialized methodologies for tasks like debugging, testing, code review, etc. Call sdd_list_skills first to see available skills.',
    { skill: z.string().describe('Skill ID, e.g. "debug-like-expert", "test", "review"') },
    (a) => run(() => getSkill({ skill: a['skill'] as string }))
  );

  // ── 18. sdd_list_skills ───────────────────────────────────────────────────
  server.tool('sdd_list_skills', 'List all available SDD skills with descriptions. Skills provide specialized methodologies for debugging, testing, reviewing, accessibility, performance, and more.',
    {},
    () => run(() => listSkills())
  );

  // ── 19. sdd_get_template ──────────────────────────────────────────────────
  server.tool('sdd_get_template', 'Get an SDD artifact template. Templates define the structure for project files like context, roadmap, plan, requirements, etc. Use these when creating or updating .sdd/ files.',
    { template: z.string().describe('Template name: context, roadmap, plan, task-plan, slice-summary, milestone-summary, requirements, decisions, knowledge, research, uat, state, etc.') },
    (a) => run(() => getTemplate({ template: a['template'] as string }))
  );

  // ── 20. sdd_capture ───────────────────────────────────────────────────────
  server.tool('sdd_capture', 'Quick fire-and-forget thought capture. Saves ideas, concerns, TODOs, decisions, or observations to CAPTURES.md for later triage.',
    {
      projectDir: z.string(),
      thought: z.string().describe('The thought, idea, or observation to capture'),
      category: z.enum(['idea', 'concern', 'todo', 'decision', 'observation']).optional(),
    },
    (a) => run(() => capture(a as unknown as Parameters<typeof capture>[0]))
  );

  // ── 21. sdd_add_knowledge ─────────────────────────────────────────────────
  server.tool('sdd_add_knowledge', 'Add a rule, pattern, lesson, or gotcha to KNOWLEDGE.md. Persistent codebase knowledge that informs future decisions.',
    {
      projectDir: z.string(),
      type: z.enum(['rule', 'pattern', 'lesson', 'gotcha']),
      content: z.string().describe('The knowledge to record'),
      context: z.string().optional().describe('Where/when this applies'),
    },
    (a) => run(() => addKnowledge(a as unknown as Parameters<typeof addKnowledge>[0]))
  );

  // ── 22. sdd_quick_task ────────────────────────────────────────────────────
  server.tool('sdd_quick_task', 'Log a quick task to the work queue WITHOUT full milestone ceremony. For small tasks that dont need planning overhead.',
    {
      projectDir: z.string(),
      description: z.string(),
      oneLiner: z.string().optional(),
    },
    (a) => run(() => quickTask(a as unknown as Parameters<typeof quickTask>[0]))
  );

  return server;
}
