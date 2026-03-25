---
name: sdd-headless
description: Orchestrate SDD (Spec-Driven Development) projects programmatically via headless CLI. Use when an agent needs to create milestones from specs, execute software development workflows, monitor task progress, check project status, or control SDD execution (pause/stop/skip/steer). Triggers on requests to "run sdd", "create milestone", "execute project", "check sdd status", "orchestrate development", "run headless workflow", or any programmatic interaction with the SDD project management system. Essential for building orchestrators that coordinate multiple SDD workers.
---

# SDD Headless Orchestration

Run SDD commands without TUI via `sdd headless`. Spawns an RPC child process, auto-responds to UI prompts, streams progress.

## Command Syntax

```bash
sdd headless [flags] [command] [args...]
```

**Flags:**
- `--timeout N` — overall timeout in ms (default 300000)
- `--json` — JSONL event stream to stdout
- `--model ID` — override LLM model
- `--verbose` — show tool calls in progress output
- `--supervised` — forward interactive UI requests to orchestrator via stdout/stdin
- `--response-timeout N` — timeout for orchestrator response in supervised mode (default 30000)
- `--max-restarts N` — auto-restart on crash with backoff (default 3, 0 to disable)
- `--answers <path>` — pre-supply answers and secrets from JSON file
- `--events <types>` — filter JSONL output to specific event types (comma-separated, implies `--json`)

**Exit codes:** 0=complete, 1=error/timeout, 2=blocked

## Core Workflows

### 1. Create + Execute a Milestone (end-to-end)

```bash
sdd headless new-milestone --context spec.md --auto
```

Reads spec, bootstraps `.sdd/`, creates milestone, then chains into auto-mode executing all phases (discuss → research → plan → execute → summarize → complete).

Extra flags for `new-milestone`: `--context <path>` (use `-` for stdin), `--context-text <text>`, `--auto`.

### 2. Run All Queued Work

```bash
sdd headless auto
```

Default command. Loops through all pending units until milestone complete or blocked.

### 3. Run One Unit

```bash
sdd headless next
```

Execute exactly one unit (task/slice/milestone step), then exit. Ideal for step-by-step orchestration with external decision logic between steps.

### 4. Instant State Snapshot (no LLM)

```bash
sdd headless query
```

Returns a single JSON object with the full project snapshot — no LLM session, instant (~50ms). **This is the recommended way for orchestrators to inspect state.**

```json
{
  "state": { "phase": "executing", "activeMilestone": {...}, "activeSlice": {...}, "progress": {...}, "registry": [...] },
  "next":  { "action": "dispatch", "unitType": "execute-task", "unitId": "M001/S01/T01" },
  "cost":  { "workers": [{ "milestoneId": "M001", "cost": 1.50, ... }], "total": 1.50 }
}
```

```bash
# What phase is the project in?
sdd headless query | jq '.state.phase'

# What would auto-mode do next?
sdd headless query | jq '.next'

# Total spend across parallel workers
sdd headless query | jq '.cost.total'
```

### 5. Dispatch Specific Phase

```bash
sdd headless dispatch research|plan|execute|complete|reassess|uat|replan
```

Force-route to a specific phase, bypassing normal state-machine routing.

## Orchestrator Patterns

### Poll-and-React Loop

```bash
# Instant state check — no LLM cost
PHASE=$(sdd headless query | jq -r '.state.phase')
NEXT_ACTION=$(sdd headless query | jq -r '.next.action')

case "$PHASE" in
  complete) echo "Done" ;;
  blocked)  echo "Needs intervention" ;;
  *)        [ "$NEXT_ACTION" = "dispatch" ] && sdd headless next ;;
esac
```

### Step-by-Step with Monitoring

```bash
while true; do
  sdd headless next
  EXIT=$?
  [ $EXIT -ne 0 ] && break
  # Instant progress check between steps
  sdd headless query | jq '{phase: .state.phase, progress: .state.progress}'
done
```

### Multi-Session Orchestration

SDD tracks concurrent workers via file-based IPC in `.sdd/parallel/`. See [references/multi-session.md](references/multi-session.md) for the full architecture.

**Quick overview:**

Each worker spawns with `SDD_MILESTONE_LOCK=M00X` + its own git worktree. Workers write heartbeats to `.sdd/parallel/<milestoneId>.status.json`. The orchestrator enumerates all status files to get a dashboard of all workers, and sends commands via signal files.

```bash
# Spawn a worker for milestone M001 in its worktree
SDD_MILESTONE_LOCK=M001 SDD_PARALLEL_WORKER=1 \
  sdd headless --json auto \
  --cwd .sdd/worktrees/M001 2>worker-M001.log &

# Monitor all workers: read .sdd/parallel/*.status.json
for f in .sdd/parallel/*.status.json; do
  jq '{mid: .milestoneId, state: .state, unit: .currentUnit.id, cost: .cost}' "$f"
done

# Send pause signal to M001
echo '{"signal":"pause","sentAt":'$(date +%s000)',"from":"coordinator"}' \
  > .sdd/parallel/M001.signal.json
```

**Status file fields:** `milestoneId`, `pid`, `state` (running/paused/stopped/error), `currentUnit`, `completedUnits`, `cost`, `lastHeartbeat`, `startedAt`, `worktreePath`.

**Signal commands:** `pause`, `resume`, `stop`, `rebase`.

**Liveness detection:** PID alive check (`kill -0 $pid`) + heartbeat freshness (30s timeout). Stale sessions are auto-cleaned.

**For multiple projects:** each project has its own `.sdd/` directory. The orchestrator must track `(projectPath, milestoneId)` tuples externally.

### JSONL Event Stream

Use `--json` to get real-time events on stdout for downstream processing:

```bash
sdd headless --json auto 2>/dev/null | while read -r line; do
  TYPE=$(echo "$line" | jq -r '.type')
  case "$TYPE" in
    tool_execution_start) echo "Tool: $(echo "$line" | jq -r '.toolName')" ;;
    extension_ui_request) echo "SDD: $(echo "$line" | jq -r '.message // .title // empty')" ;;
    agent_end) echo "Session ended" ;;
  esac
done
```

Event types: `agent_start`, `agent_end`, `tool_execution_start`, `tool_execution_end`, `extension_ui_request`, `message_update`, `error`.

### Filtered Event Stream

Use `--events` to receive only specific event types — reduces noise for orchestrators:

```bash
# Only phase-relevant events
sdd headless --events agent_end,extension_ui_request auto 2>/dev/null

# Only tool execution events
sdd headless --events tool_execution_start,tool_execution_end auto
```

The filter applies only to stdout output. Internal processing (completion detection, supervised mode, answer injection) is unaffected — all events are still processed internally.

Available event types: `agent_start`, `agent_end`, `tool_execution_start`, `tool_execution_end`, `tool_execution_update`, `extension_ui_request`, `message_start`, `message_end`, `message_update`, `turn_start`, `turn_end`.

## Answer Injection

Pre-supply answers and secrets for headless runs via `--answers`:

```bash
sdd headless --answers answers.json auto
```

Answer file schema:
```json
{
  "questions": { "question_id": "selected_option" },
  "secrets": { "API_KEY": "sk-..." },
  "defaults": { "strategy": "first_option" }
}
```

- **questions** — question ID → answer (string or string[])
- **secrets** — env var → value, injected into child process env
- **defaults.strategy** — `"first_option"` (default) or `"cancel"` for unmatched

See [references/answer-injection.md](references/answer-injection.md) for full details.

## SDD Project Structure

All state lives in `.sdd/` as markdown files (version-controllable):

```
.sdd/
  milestones/M001/
    M001-CONTEXT.md      # Requirements, scope, decisions
    M001-ROADMAP.md      # Slices with tasks, dependencies, checkboxes
    M001-SUMMARY.md      # Completion summary
    slices/S01/
      S01-PLAN.md        # Task list
      S01-SUMMARY.md     # Slice summary with frontmatter
      tasks/T01-PLAN.md  # Individual task spec
```

State is derived from files on disk — checkboxes in ROADMAP.md are the source of truth for completion.

## All Headless Commands

Quick reference — see [references/commands.md](references/commands.md) for the complete list.

| Command | Purpose |
|---------|---------|
| `auto` | Run all queued units (default) |
| `next` | Run one unit |
| `query` | Instant JSON snapshot — state, next dispatch, costs (no LLM) |
| `new-milestone` | Create milestone from spec |
| `queue` | Queue/reorder milestones |
| `history` | View execution history |
| `stop` / `pause` | Control auto-mode |
| `dispatch <phase>` | Force specific phase |
| `skip` / `undo` | Unit control |
| `doctor` | Health check + auto-fix |
| `steer <desc>` | Hard-steer plan mid-execution |
