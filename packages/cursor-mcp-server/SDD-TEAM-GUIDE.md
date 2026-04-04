# SDD Commands — Team Quick Reference

> No slash commands needed. Just type plain English in Cursor chat.
> Cursor's AI knows SDD methodology from `.cursorrules` and calls the right tools automatically.

---

## Getting Started

| What you want | Type this in Cursor chat |
|---------------|------------------------|
| Set up SDD in a new project | "Initialise SDD for this project. Project name: My App" |
| Check current status | "Show me the SDD project status" |
| See what templates are available | "What SDD workflow templates are available?" |

## Discussion (Before Planning)

Cursor will **ask you questions before creating any plan**. This is the SDD "discuss" phase.

| What you want | Type this in Cursor chat |
|---------------|------------------------|
| Let Cursor interview you | "I want to build a login system. Interview me first." |
| Get options for an approach | "What are my options for implementing auth?" |
| Discuss before planning | "Let's discuss the user dashboard feature before planning" |
| Skip discussion, go fast | "Just plan it — user auth with email and OAuth" |
| Give feedback on a plan | "No, remove the OAuth slice. We only need email login." |
| Change direction mid-work | "Wait, I changed my mind. Let's use JWT instead of sessions." |

### Example conversation flow:
```
You:    "I want to add a payment system"
Cursor: "Let me ask a few questions first:
         1. What payment provider — Stripe, PayPal, or both?
         2. One-time payments or subscriptions?
         3. Any existing payment code in the codebase?"
You:    "Stripe only, subscriptions, no existing code"
Cursor: "Got it. Here's what I'm thinking:
         - M001: Payment System
         - S01: Stripe integration (high risk, do first)
         - S02: Subscription management
         - S03: Billing dashboard
         Does this look right?"
You:    "Yes, plan it"
Cursor: → calls sdd_plan_milestone
```

## Planning

| What you want | Type this in Cursor chat |
|---------------|------------------------|
| Plan a new feature | "Plan a milestone for user authentication with login and OAuth slices" |
| Break a slice into tasks | "Plan slice S01 with tasks for creating the user model, register endpoint, and login endpoint" |
| Add a single task | "Add a task T03 to slice S01 for password reset" |
| See milestone details | "Show me milestone M001 details" |

## Executing

| What you want | Type this in Cursor chat |
|---------------|------------------------|
| Work on next task | "Execute task T01 — create the user model" |
| Mark task as done | "Complete task T01. Tests pass, build succeeds." |
| Mark slice as done | "Complete slice S01 with a summary" |
| Mark milestone as done | "Complete milestone M001" |

## When Things Change

| What you want | Type this in Cursor chat |
|---------------|------------------------|
| Something broke, replan | "Replan slice S01 — the API changed and we need different tasks" |
| Finished a slice, check roadmap | "Reassess the roadmap after completing S01" |
| Need to fix a completed task | "Reopen task T01 — found a bug in the user model" |
| Need to rework a slice | "Reopen slice S01 — validation failed" |
| Validate before shipping | "Validate milestone M001 against its success criteria" |

## Checking Progress

| What you want | Type this in Cursor chat |
|---------------|------------------------|
| Overall project status | "What's the SDD status?" |
| Specific milestone progress | "Show me M001 progress" |
| What's left to do | "What tasks are still pending?" |
| Read the roadmap | Open `.sdd/milestones/M001/M001-ROADMAP.md` |
| Read the current state | Open `.sdd/STATE.md` |

---

## What Happens Behind the Scenes

When you type plain English, Cursor's AI:
1. Reads `.cursorrules` to understand SDD methodology
2. Calls the right MCP tool (e.g., `sdd_plan_milestone`)
3. The tool writes to SQLite database + markdown files
4. STATE.md is automatically updated
5. Progress persists across all Cursor chat sessions

## SDD Files in Your Project

```
your-project/
  .sdd/
    STATE.md           ← current state (auto-updated)
    PROJECT.md         ← project description
    CONTEXT.md         ← project context and tech stack
    DECISIONS.md       ← key decisions log
    KNOWLEDGE.md       ← codebase knowledge
    REQUIREMENTS.md    ← requirement tracking
    QUEUE.md           ← work queue
    OVERRIDES.md       ← steering/overrides
    sdd.db             ← SQLite state (all milestones, tasks, evidence)
    milestones/
      M001/
        M001-ROADMAP.md   ← milestone plan
        S01/
          S01-PLAN.md     ← slice task breakdown
          S01-SUMMARY.md  ← completion summary
        M001-SUMMARY.md   ← milestone completion summary
```

## Rules to Follow

1. **Always verify** — when you complete a task, tell Cursor what tests you ran
2. **Complete in order** — finish tasks before completing the slice
3. **Reassess after each slice** — ask Cursor to reassess the roadmap
4. **Don't skip validation** — validate milestone before marking complete
5. **Reopen, don't hack** — if a completed task needs fixing, reopen it

## ID Conventions

| Type | Format | Example |
|------|--------|---------|
| Milestone | M001, M002... | M001 |
| Slice | S01, S02... | S01 (within M001) |
| Task | T01, T02... | T01 (within S01) |

---

## Setup (One Time)

```bash
npm install -g @bhargavvc/sdd-cursor
```

Then in your project, create `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "sdd": { "command": "sdd-cursor-mcp", "args": [] }
  }
}
```

Copy `.cursorrules` and `SDD-NEW-CHAT.md` to your project root. Open in Cursor. Done.
