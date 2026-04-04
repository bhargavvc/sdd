# SDD — New Chat Start Guide

**Read this at the start of every Cursor chat session.**

---

## Step 1: Tell Cursor your project directory

In your first message, always include the absolute path to your project:

> "My project is at `C:/Users/yourname/projects/my-app` — check SDD state"

Cursor needs this path to call any SDD tool. Without it, nothing works.

---

## Step 2: Cursor runs this automatically

```
sdd_query_state({ projectDir: "C:/Users/yourname/projects/my-app" })
```

This shows:
- Which milestones exist
- Which slices are active
- Which tasks are pending
- Overall progress %

---

## Step 3: Tell Cursor what you want to do

| You say | Cursor does |
|---------|-------------|
| "Start a new feature: login system" | `sdd_init_project` → `sdd_plan_milestone` |
| "What's next to work on?" | `sdd_query_state` → picks next pending task |
| "Plan slice S01" | `sdd_plan_slice` with task breakdown |
| "Execute task T01" | Writes code → runs tests → `sdd_complete_task` |
| "I'm done with slice S01" | `sdd_complete_slice` |
| "Fix bug: login crashes on empty email" | `sdd_plan_milestone` (bugfix template) |
| "Show me milestone M001 details" | `sdd_query_milestone` |
| "Something changed, replan S02" | `sdd_replan_slice` |

---

## What SDD tracks for you (persists across all chats)

Every action is saved to `.sdd/sdd.db` in your project:

```
Your project/
  .sdd/
    sdd.db                    ← SQLite: all milestones, slices, tasks, evidence
    milestones/
      M001/
        M001-ROADMAP.md       ← plan written here
        M001-SUMMARY.md       ← completion summary
        S01/
          S01-PLAN.md         ← slice plan
          S01-SUMMARY.md      ← slice summary
```

You can open a new Cursor chat tomorrow, give the projectDir, and SDD picks up exactly where you left off.

---

## Quick reference: SDD IDs

Always use these formats — don't invent your own:

| Type | Format | Examples |
|------|--------|---------|
| Milestone | `M001`, `M002`... | M001, M002, M003 |
| Slice | `S01`, `S02`... | S01, S02 (within a milestone) |
| Task | `T01`, `T02`... | T01, T02 (within a slice) |

---

## If you're starting fresh (no .sdd/ yet)

```
"Initialise SDD for my project at C:/path/to/project, project name: My App"
```

Cursor calls `sdd_init_project` → creates `.sdd/` → you're ready.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Milestone not found" | Run `sdd_query_state` first to see what exists |
| "Task already complete" | Use `sdd_reopen_task` to fix it |
| "Pending tasks exist" | Complete all tasks before completing the slice |
| "Slice not found" | Run `sdd_plan_slice` first |
| Tools not showing in Cursor | Check `.cursor/mcp.json` exists + restart Cursor |
