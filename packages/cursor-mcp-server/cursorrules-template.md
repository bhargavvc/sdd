# SDD — Spec-Driven Development Workflow

You are working inside the SDD framework. SDD enforces structured, verifiable development through milestones, slices, and tasks. Follow this methodology precisely.

## IMPORTANT: Use Phase Guides and Skills

**Before starting ANY phase, call `sdd_get_guide` with the phase name.** This returns the full SDD methodology for that phase — detailed instructions, question protocols, verification checklists, and quality gates. The guides contain the real SDD expertise.

Example: Before discussing a milestone, call `sdd_get_guide({ phase: "discuss-milestone" })` and follow those instructions precisely.

**For specialized tasks, call `sdd_get_skill`.** SDD includes 19 expert skills:
- `debug-like-expert` — scientific debugging methodology
- `test` — test generation and execution
- `review` — code review for security, performance, bugs
- `best-practices` — code quality standards
- `accessibility` — web accessibility audit
- `lint` — linting and formatting
- `code-optimizer` — performance optimization
- `react-best-practices` — React-specific guidance
- `frontend-design` — UI/UX patterns
- `web-design-guidelines` — web standards
- Call `sdd_list_skills` to see all 19.

**For artifact structure, call `sdd_get_template`.** Returns the official SDD template for any file type (context, roadmap, plan, requirements, etc.).

## Core Hierarchy

```
Milestone (M001, M002...)
  └─ Slice (S01, S02...)       ← vertical slice of work
       └─ Task (T01, T02...)   ← atomic, independently committable unit
```

## Phase Flow (for every slice)

1. **Discussing** — understand requirements, clarify scope, interview the user
2. **Researching** — read existing code, understand patterns
3. **Planning** — call `sdd_plan_slice` with 2-8 tasks
4. **Executing** — implement each task, run verification
5. **Completing** — call `sdd_complete_task` then `sdd_complete_slice`

## CRITICAL: Discussion Phase (NEVER SKIP)

**Before creating ANY milestone or plan, you MUST interview the user first.**

### When the user says "plan a feature" or "create a milestone":

Do NOT immediately call `sdd_plan_milestone`. Instead, enter **Discussion Mode**:

1. **Ask clarifying questions** — present 3-5 questions about:
   - What problem are we solving? Who is the user?
   - What's the expected behavior?
   - What are the constraints (time, tech, dependencies)?
   - Are there existing patterns in the codebase we should follow?
   - What's out of scope?

2. **Present options** — when there are multiple approaches:
   ```
   I see two approaches:

   **Option A: Server-side auth**
   - Pros: simpler, secure
   - Cons: slower

   **Option B: JWT tokens**
   - Pros: fast, stateless
   - Cons: harder to revoke

   Which do you prefer? Or should I explain more?
   ```

3. **Summarise understanding** — before planning, confirm:
   ```
   Let me confirm what I understand:
   - Goal: [what we're building]
   - Approach: [chosen approach]
   - Slices I'm thinking: [S01: x, S02: y]
   - Out of scope: [what we're NOT doing]

   Does this look right? Any changes before I create the plan?
   ```

4. **Only after user confirms** → call `sdd_plan_milestone`

### When the user says "interview me" or "discuss this":

Enter **Deep Discussion Mode**:
- Ask questions one at a time (not all at once)
- After each answer, ask a follow-up based on their response
- Show your thinking: "Based on what you said, I think we need..."
- Present choices with pros/cons when there are trade-offs
- Keep going until you have enough context to plan confidently
- Then summarise and ask "Ready to plan?"

### When the user says "just plan it" or "skip discussion":

Respect this — go straight to planning. But still show a brief summary before calling `sdd_plan_milestone` so they can catch mistakes.

## Before You Start Anything

Call `sdd_query_state` to understand the current project state:
- What milestones exist
- Which slices are pending/active/done
- What tasks remain

## Workflow: New Project

```
1. sdd_init_project         → create .sdd/ directory
2. DISCUSS with user         → ask questions, understand vision, present options
3. User confirms approach    → "yes, plan it"
4. sdd_plan_milestone        → write M001 with vision, risks, slices
5. DISCUSS slice details     → "For S01, I'm thinking these tasks..."
6. User confirms             → "looks good"
7. sdd_plan_slice (S01)      → break into 2-8 tasks
8. Execute tasks             → implement code, run tests
9. sdd_complete_task         → record each task with evidence
10. sdd_complete_slice       → summarise slice
11. sdd_reassess_roadmap     → check if remaining slices need adjustment
12. Repeat for next slice
13. sdd_validate_milestone   → verify all success criteria met
14. sdd_complete_milestone   → archive milestone
```

## Workflow: Execute a Slice

```
1. sdd_query_milestone       → read current slice details
2. DISCUSS if needed          → "S01 has 4 tasks. Any concerns before I start?"
3. sdd_plan_slice             → plan tasks (if not already planned)
4. For each task:
   a. Read task details
   b. Implement the changes (write code, create files)
   c. Run verification commands (tests, lint, build)
   d. sdd_complete_task with verificationEvidence
5. sdd_complete_slice         → after ALL tasks are done
6. sdd_reassess_roadmap       → evaluate remaining slices
```

## Workflow: Bug Fix

```
1. DISCUSS the bug             → "What's the error? When does it happen?"
2. sdd_init_project (if first time)
3. sdd_plan_milestone          → M001: Fix [bug name], 1 slice
4. sdd_plan_slice              → S01: 1-3 tasks (reproduce, fix, verify)
5. Execute + complete tasks
6. sdd_complete_slice + sdd_complete_milestone
```

## Feedback and Steering

### During planning:
- If user says "no" or "change this" → adjust and re-present
- If user says "add X" → incorporate and confirm
- If user says "remove that slice" → update plan

### During execution:
- If user says "stop" or "wait" → pause and discuss
- If user says "this approach isn't working" → call `sdd_replan_slice`
- If user says "I changed my mind" → discuss new direction, replan

### Always:
- Present your thinking, don't just execute silently
- After completing a slice, ask: "S01 is done. Ready for S02, or want to discuss changes?"
- When you hit something unexpected: stop, explain, ask for direction

## Rules (Mandatory)

1. **NEVER skip discussion for new milestones** — always interview/confirm before planning
2. **NEVER skip verification** — every `sdd_complete_task` MUST include `verificationEvidence` with actual command output
3. **Complete tasks in order** — unless the slice plan explicitly marks tasks as parallel
4. **Call sdd_reassess_roadmap after every slice** — not just at the end
5. **Use sdd_replan_slice when blocked** — don't hack around incomplete tasks
6. **Use sdd_reopen_task** to fix a completed task — never mark a task done that isn't
7. **Validation before completion** — call `sdd_validate_milestone` before `sdd_complete_milestone`
8. **Present choices** — when there are multiple valid approaches, show options with pros/cons

## Verification Evidence Format

Every `sdd_complete_task` must include:
```json
"verificationEvidence": [
  { "command": "npm test", "exitCode": 0, "verdict": "pass", "durationMs": 1240 },
  { "command": "npm run build", "exitCode": 0, "verdict": "pass", "durationMs": 3100 }
]
```

Minimum evidence: tests pass + build succeeds. Never fabricate evidence — run the actual commands.

## Risk Levels for Slices

- `critical` — tackles the riskiest unknown, should go first
- `high` — significant risk, do early
- `medium` — standard work
- `low` — polish, docs, cleanup (do last)

**Always order slices: highest risk first.**

## Templates

Use `sdd_list_templates` to see available workflow templates:
- `feature` — full ceremony for new features
- `bugfix` — triage → fix → verify
- `hotfix` — emergency fix, minimal ceremony
- `spike` — time-boxed research
- `refactor` — code improvement

## projectDir

Always pass `projectDir` as the absolute path to the project root (where the codebase lives). Use the workspace root from Cursor's context.

## Knowledge & Capture

- When you discover something important about the codebase, call `sdd_add_knowledge` with type `rule`, `pattern`, `lesson`, or `gotcha`
- When the user mentions an idea, concern, or TODO in passing, call `sdd_capture` to save it for later
- When doing a quick fix that doesn't need full ceremony, call `sdd_quick_task` to log it to the queue
- Knowledge persists in `.sdd/KNOWLEDGE.md` across all Cursor sessions

## Common Mistakes to Avoid

- Do NOT call `sdd_plan_milestone` without discussing with the user first
- Do NOT call `sdd_complete_slice` before all tasks are done — it will fail
- Do NOT call `sdd_complete_milestone` before all slices are done — it will fail
- Do NOT omit `verificationEvidence` — `sdd_complete_task` will reject it
- Do NOT invent milestone IDs — use M001, M002... sequentially
- Do NOT invent slice IDs — use S01, S02... within each milestone
- Do NOT invent task IDs — use T01, T02... within each slice
- Do NOT plan silently — always show your thinking and get confirmation
