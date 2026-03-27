# Commands Reference

## Session Commands

| Command | Description |
|---------|-------------|
| `/sdd` | Step mode — execute one unit at a time, pause between each |
| `/sdd next` | Explicit step mode (same as `/sdd`) |
| `/sdd auto` | Autonomous mode — research, plan, execute, commit, repeat |
| `/sdd quick` | Execute a quick task with SDD guarantees (atomic commits, state tracking) without full planning overhead |
| `/sdd stop` | Stop auto mode gracefully |
| `/sdd pause` | Pause auto-mode (preserves state, `/sdd auto` to resume) |
| `/sdd steer` | Hard-steer plan documents during execution |
| `/sdd discuss` | Discuss architecture and decisions (works alongside auto mode) |
| `/sdd status` | Progress dashboard |
| `/sdd widget` | Cycle dashboard widget: full / small / min / off |
| `/sdd queue` | Queue and reorder future milestones (safe during auto mode) |
| `/sdd capture` | Fire-and-forget thought capture (works during auto mode) |
| `/sdd triage` | Manually trigger triage of pending captures |
| `/sdd dispatch` | Dispatch a specific phase directly (research, plan, execute, complete, reassess, uat, replan) |
| `/sdd history` | View execution history (supports `--cost`, `--phase`, `--model` filters) |
| `/sdd forensics` | Full-access SDD debugger — structured anomaly detection, unit traces, and LLM-guided root-cause analysis for auto-mode failures |
| `/sdd cleanup` | Clean up SDD state files and stale worktrees |
| `/sdd visualize` | Open workflow visualizer (progress, deps, metrics, timeline) |
| `/sdd export --html` | Generate self-contained HTML report for current or completed milestone |
| `/sdd export --html --all` | Generate retrospective reports for all milestones at once |
| `/sdd update` | Update SDD to the latest version in-session |
| `/sdd knowledge` | Add persistent project knowledge (rule, pattern, or lesson) |
| `/sdd fast` | Toggle service tier for supported models (prioritized API routing) |
| `/sdd rate` | Rate last unit's model tier (over/ok/under) — improves adaptive routing |
| `/sdd changelog` | Show categorized release notes |
| `/sdd logs` | Browse activity logs, debug logs, and metrics |
| `/sdd remote` | Control remote auto-mode |
| `/sdd help` | Categorized command reference with descriptions for all SDD subcommands |

## Configuration & Diagnostics

| Command | Description |
|---------|-------------|
| `/sdd prefs` | Model selection, timeouts, budget ceiling |
| `/sdd mode` | Switch workflow mode (solo/team) with coordinated defaults for milestone IDs, git commit behavior, and documentation |
| `/sdd config` | Re-run the provider setup wizard (LLM provider + tool keys) |
| `/sdd keys` | API key manager — list, add, remove, test, rotate, doctor |
| `/sdd doctor` | Runtime health checks with auto-fix — issues surface in real time across widget, visualizer, and HTML reports (v2.40) |
| `/sdd inspect` | Show SQLite DB diagnostics |
| `/sdd init` | Project init wizard — detect, configure, bootstrap `.sdd/` |
| `/sdd setup` | Global setup status and configuration |
| `/sdd skill-health` | Skill lifecycle dashboard — usage stats, success rates, token trends, staleness warnings |
| `/sdd skill-health <name>` | Detailed view for a single skill |
| `/sdd skill-health --declining` | Show only skills flagged for declining performance |
| `/sdd skill-health --stale N` | Show skills unused for N+ days |
| `/sdd hooks` | Show configured post-unit and pre-dispatch hooks |
| `/sdd run-hook` | Manually trigger a specific hook |
| `/sdd migrate` | Migrate a v1 `.planning` directory to `.sdd` format |

## Milestone Management

| Command | Description |
|---------|-------------|
| `/sdd new-milestone` | Create a new milestone |
| `/sdd skip` | Prevent a unit from auto-mode dispatch |
| `/sdd undo` | Revert last completed unit |
| `/sdd undo-task` | Reset a specific task's completion state (DB + markdown) |
| `/sdd reset-slice` | Reset a slice and all its tasks (DB + markdown) |
| `/sdd park` | Park a milestone — skip without deleting |
| `/sdd unpark` | Reactivate a parked milestone |
| Discard milestone | Available via `/sdd` wizard → "Milestone actions" → "Discard" |

## Parallel Orchestration

| Command | Description |
|---------|-------------|
| `/sdd parallel start` | Analyze eligibility, confirm, and start workers |
| `/sdd parallel status` | Show all workers with state, progress, and cost |
| `/sdd parallel stop [MID]` | Stop all workers or a specific milestone's worker |
| `/sdd parallel pause [MID]` | Pause all workers or a specific one |
| `/sdd parallel resume [MID]` | Resume paused workers |
| `/sdd parallel merge [MID]` | Merge completed milestones back to main |

See [Parallel Orchestration](./parallel-orchestration.md) for full documentation.

## Workflow Templates (v2.42)

| Command | Description |
|---------|-------------|
| `/sdd start` | Start a workflow template (bugfix, spike, feature, hotfix, refactor, security-audit, dep-upgrade, full-project) |
| `/sdd start resume` | Resume an in-progress workflow |
| `/sdd templates` | List available workflow templates |
| `/sdd templates info <name>` | Show detailed template info |

## Custom Workflows (v2.42)

| Command | Description |
|---------|-------------|
| `/sdd workflow new` | Create a new workflow definition (via skill) |
| `/sdd workflow run <name>` | Create a run and start auto-mode |
| `/sdd workflow list` | List workflow runs |
| `/sdd workflow validate <name>` | Validate a workflow definition YAML |
| `/sdd workflow pause` | Pause custom workflow auto-mode |
| `/sdd workflow resume` | Resume paused custom workflow auto-mode |

## Extensions

| Command | Description |
|---------|-------------|
| `/sdd extensions list` | List all extensions and their status |
| `/sdd extensions enable <id>` | Enable a disabled extension |
| `/sdd extensions disable <id>` | Disable an extension |
| `/sdd extensions info <id>` | Show extension details |

## cmux Integration

| Command | Description |
|---------|-------------|
| `/sdd cmux status` | Show cmux detection, prefs, and capabilities |
| `/sdd cmux on` | Enable cmux integration |
| `/sdd cmux off` | Disable cmux integration |
| `/sdd cmux notifications on/off` | Toggle cmux desktop notifications |
| `/sdd cmux sidebar on/off` | Toggle cmux sidebar metadata |
| `/sdd cmux splits on/off` | Toggle cmux visual subagent splits |

## GitHub Sync (v2.39)

| Command | Description |
|---------|-------------|
| `/github-sync bootstrap` | Initial setup — creates GitHub Milestones, Issues, and draft PRs from current `.sdd/` state |
| `/github-sync status` | Show sync mapping counts (milestones, slices, tasks) |

Enable with `github.enabled: true` in preferences. Requires `gh` CLI installed and authenticated. Sync mapping is persisted in `.sdd/.github-sync.json`.

## Git Commands

| Command | Description |
|---------|-------------|
| `/worktree` (`/wt`) | Git worktree lifecycle — create, switch, merge, remove |

## Session Management

| Command | Description |
|---------|-------------|
| `/clear` | Start a new session (alias for `/new`) |
| `/exit` | Graceful shutdown — saves session state before exiting |
| `/kill` | Kill SDD process immediately |
| `/model` | Switch the active model |
| `/login` | Log in to an LLM provider |
| `/thinking` | Toggle thinking level during sessions |
| `/voice` | Toggle real-time speech-to-text (macOS, Linux) |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+G` | Toggle dashboard overlay |
| `Ctrl+Alt+V` | Toggle voice transcription |
| `Ctrl+Alt+B` | Show background shell processes |
| `Ctrl+V` / `Alt+V` | Paste image from clipboard (screenshot → vision input) |
| `Escape` | Pause auto mode (preserves conversation) |

> **Note:** In terminals without Kitty keyboard protocol support (macOS Terminal.app, JetBrains IDEs), slash-command fallbacks are shown instead of `Ctrl+Alt` shortcuts.
>
> **Tip:** If `Ctrl+V` is intercepted by your terminal (e.g. Warp), use `Alt+V` instead for clipboard image paste.

## CLI Flags

| Flag | Description |
|------|-------------|
| `sdd` | Start a new interactive session |
| `sdd --continue` (`-c`) | Resume the most recent session for the current directory |
| `sdd --model <id>` | Override the default model for this session |
| `sdd --print "msg"` (`-p`) | Single-shot prompt mode (no TUI) |
| `sdd --mode <text\|json\|rpc\|mcp>` | Output mode for non-interactive use |
| `sdd --list-models [search]` | List available models and exit |
| `sdd --web [path]` | Start browser-based web interface (optional project path) |
| `sdd --worktree` (`-w`) [name] | Start session in a git worktree (auto-generates name if omitted) |
| `sdd --no-session` | Disable session persistence |
| `sdd --extension <path>` | Load an additional extension (can be repeated) |
| `sdd --append-system-prompt <text>` | Append text to the system prompt |
| `sdd --tools <list>` | Comma-separated list of tools to enable |
| `sdd --version` (`-v`) | Print version and exit |
| `sdd --help` (`-h`) | Print help and exit |
| `sdd sessions` | Interactive session picker — list all saved sessions for the current directory and choose one to resume |
| `sdd --debug` | Enable structured JSONL diagnostic logging for troubleshooting dispatch and state issues |
| `sdd config` | Set up global API keys for search and docs tools (saved to `~/.sdd/agent/auth.json`, applies to all projects). See [Global API Keys](./configuration.md#global-api-keys-sdd-config). |
| `sdd update` | Update SDD to the latest version |
| `sdd headless new-milestone` | Create a new milestone from a context file (headless — no TUI required) |

## Headless Mode

`sdd headless` runs `/sdd` commands without a TUI — designed for CI, cron jobs, and scripted automation. It spawns a child process in RPC mode, auto-responds to interactive prompts, detects completion, and exits with meaningful exit codes.

```bash
# Run auto mode (default)
sdd headless

# Run a single unit
sdd headless next

# Instant JSON snapshot — no LLM, ~50ms
sdd headless query

# With timeout for CI
sdd headless --timeout 600000 auto

# Force a specific phase
sdd headless dispatch plan

# Create a new milestone from a context file and start auto mode
sdd headless new-milestone --context brief.md --auto

# Create a milestone from inline text
sdd headless new-milestone --context-text "Build a REST API with auth"

# Pipe context from stdin
echo "Build a CLI tool" | sdd headless new-milestone --context -
```

| Flag | Description |
|------|-------------|
| `--timeout N` | Overall timeout in milliseconds (default: 300000 / 5 min) |
| `--max-restarts N` | Auto-restart on crash with exponential backoff (default: 3). Set 0 to disable |
| `--json` | Stream all events as JSONL to stdout |
| `--model ID` | Override the model for the headless session |
| `--context <file>` | Context file for `new-milestone` (use `-` for stdin) |
| `--context-text <text>` | Inline context text for `new-milestone` |
| `--auto` | Chain into auto-mode after milestone creation |

**Exit codes:** `0` = complete, `1` = error or timeout, `2` = blocked.

Any `/sdd` subcommand works as a positional argument — `sdd headless status`, `sdd headless doctor`, `sdd headless dispatch execute`, etc.

### `sdd headless query`

Returns a single JSON object with the full project snapshot — no LLM session, no RPC child, instant response (~50ms). This is the recommended way for orchestrators and scripts to inspect SDD state.

```bash
sdd headless query | jq '.state.phase'
# "executing"

sdd headless query | jq '.next'
# {"action":"dispatch","unitType":"execute-task","unitId":"M001/S01/T03"}

sdd headless query | jq '.cost.total'
# 4.25
```

**Output schema:**

```json
{
  "state": {
    "phase": "executing",
    "activeMilestone": { "id": "M001", "title": "..." },
    "activeSlice": { "id": "S01", "title": "..." },
    "activeTask": { "id": "T01", "title": "..." },
    "registry": [{ "id": "M001", "status": "active" }, ...],
    "progress": { "milestones": { "done": 0, "total": 2 }, "slices": { "done": 1, "total": 3 } },
    "blockers": []
  },
  "next": {
    "action": "dispatch",
    "unitType": "execute-task",
    "unitId": "M001/S01/T01"
  },
  "cost": {
    "workers": [{ "milestoneId": "M001", "cost": 1.50, "state": "running", ... }],
    "total": 1.50
  }
}
```

## MCP Server Mode

`sdd --mode mcp` runs SDD as a [Model Context Protocol](https://modelcontextprotocol.io) server over stdin/stdout. This exposes all SDD tools (read, write, edit, bash, etc.) to external AI clients — Claude Desktop, VS Code Copilot, and any MCP-compatible host.

```bash
# Start SDD as an MCP server
sdd --mode mcp
```

The server registers all tools from the agent session and maps MCP `tools/list` and `tools/call` requests to SDD tool definitions. It runs until the transport closes.

## In-Session Update

`/sdd update` checks npm for a newer version of SDD and installs it without leaving the session.

```bash
/sdd update
# Current version: v2.36.0
# Checking npm registry...
# Updated to v2.37.0. Restart SDD to use the new version.
```

If already up to date, it reports so and takes no action.

## Export

`/sdd export` generates reports of milestone work.

```bash
# Generate HTML report for the active milestone
/sdd export --html

# Generate retrospective reports for ALL milestones at once
/sdd export --html --all
```

Reports are saved to `.sdd/reports/` with a browseable `index.html` that links to all generated snapshots.
