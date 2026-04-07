# SDD — VS Code Extension

Control the [SDD-2 coding agent](https://github.com/bhargavvc/sdd) directly from VS Code. Run autonomous coding sessions, chat with `@sdd`, monitor agent activity in real-time, review and accept/reject changes, and manage your workflow — all without leaving the editor.

![SDD Extension Overview](docs/images/overview.png)

## Requirements

- **SDD-2** installed globally: `npm install -g sdd-pi`
- **Node.js** >= 22.0.0
- **Git** installed and on PATH
- **VS Code** >= 1.95.0

## Quick Start

1. Install SDD: `npm install -g sdd-pi`
2. Install this extension
3. Open a project folder in VS Code
4. Click the **SDD icon** in the Activity Bar (left sidebar)
5. Click **Start Agent** or run `Ctrl+Shift+P` > **SDD: Start Agent**
6. Start chatting with `@sdd` in Chat or click **Auto** in the sidebar

---

## Features

### Sidebar Dashboard

Click the **SDD icon** in the Activity Bar. The compact header shows connection status, model, session, message count, thinking level, context usage bar, and cost — all in two lines. Sections (Workflow, Stats, Actions, Settings) are collapsible and remember their state.

### Workflow Controls

One-click buttons for SDD's core commands. All route through the Chat panel so you see the full response:

| Button | What it does |
|--------|-------------|
| **Auto** | Start autonomous mode — research, plan, execute |
| **Next** | Execute one unit of work, then pause |
| **Quick** | Quick task without planning (opens input) |
| **Capture** | Capture a thought for later triage |

### Chat Integration (`@sdd`)

Use `@sdd` in VS Code Chat (`Cmd+Shift+I`) to talk to the agent:

```
@sdd refactor the auth module to use JWT
@sdd /sdd auto
@sdd fix the errors in this file
```

- **Auto-starts** the agent if not running
- **File context** via `#file` references
- **Selection context** — automatically includes selected code
- **Diagnostic context** — auto-includes errors/warnings when you mention "fix" or "error"
- **Streaming** progress, file anchors, token usage footer

### Source Control Integration

Agent-modified files appear in a dedicated **"SDD Agent"** section of the Source Control panel:

- **Click any file** to see a before/after diff in VS Code's native diff editor
- **Accept** or **Discard** changes per-file via inline buttons
- **Accept All** / **Discard All** via the SCM title bar
- Gutter diff indicators (green/red bars) show exactly what changed

### Line-Level Decorations

When the agent modifies a file, you'll see:
- **Green background** on newly added lines
- **Yellow background** on modified lines
- **Left border gutter indicator** on all agent-touched lines
- **Hover** any decorated line to see "Modified by SDD Agent"

### Checkpoints & Rollback

Automatic checkpoints are created at the start of each agent turn. Use **Discard All** in the SCM panel to revert all agent changes to their original state, or discard individual files.

### Activity Feed

The **Activity** panel shows a real-time log of every tool the agent executes — Read, Write, Edit, Bash, Grep, Glob — with status icons (running/success/error), duration, and click-to-open for file operations.

### Sessions

The **Sessions** panel lists all past sessions for the current workspace. Click any session to switch to it. The current session is highlighted green. Sessions persist to disk automatically.

### Diagnostic Integration

- **Fix Errors** button in the sidebar reads the active file's diagnostics from the Problems panel and sends them to the agent
- **Fix All Problems** (`Cmd+Shift+P` > SDD: Fix All Problems) collects errors/warnings across the workspace
- Works automatically in chat — mention "fix" or "error" and diagnostics are included

### Code Lens

Four inline actions above every function and class (TS/JS/Python/Go/Rust):

| Action | What it does |
|--------|-------------|
| **Ask SDD** | Explain the function/class |
| **Refactor** | Improve clarity, performance, or structure |
| **Find Bugs** | Review for bugs and edge cases |
| **Tests** | Generate test coverage |

### Git Integration

- **Commit Agent Changes** — stages and commits modified files with your message
- **Create Branch** — create a new branch for agent work
- **Show Diff** — view git diff of agent changes

### Approval Modes

Control how much autonomy the agent has:

| Mode | Behavior |
|------|----------|
| **Auto-approve** | Agent runs freely (default) |
| **Ask** | Prompts before file writes and commands |
| **Plan-only** | Read-only — agent can analyze but not modify |

Change via Settings section or `Cmd+Shift+P` > **SDD: Select Approval Mode**.

### Agent UI Requests

When the agent needs input (questions, confirmations, selections), VS Code dialogs appear automatically — no more hanging on `ask_user_questions`.

### Additional Features

- **Conversation History** — full message viewer with tool calls, thinking blocks, search, and fork-from-here
- **Slash Command Completion** — type `/` for auto-complete of `/sdd` commands
- **File Decorations** — "G" badge on agent-modified files in the Explorer
- **Bash Terminal** — dedicated terminal for agent shell output
- **Context Window Warning** — notification when context exceeds threshold
- **Progress Notifications** — optional notification with cancel button (off by default)

---

## All Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| **SDD: Start Agent** | | Connect to the SDD agent |
| **SDD: Stop Agent** | | Disconnect the agent |
| **SDD: New Session** | `Cmd+Shift+G` `Cmd+Shift+N` | Start a fresh conversation |
| **SDD: Send Message** | `Cmd+Shift+G` `Cmd+Shift+P` | Send a message to the agent |
| **SDD: Abort** | `Cmd+Shift+G` `Cmd+Shift+A` | Interrupt the current operation |
| **SDD: Steer Agent** | `Cmd+Shift+G` `Cmd+Shift+I` | Steering message mid-operation |
| **SDD: Switch Model** | | Pick a model from QuickPick |
| **SDD: Cycle Model** | `Cmd+Shift+G` `Cmd+Shift+M` | Rotate to the next model |
| **SDD: Set Thinking Level** | | Choose off / low / medium / high |
| **SDD: Cycle Thinking** | `Cmd+Shift+G` `Cmd+Shift+T` | Rotate through thinking levels |
| **SDD: Compact Context** | | Trigger context compaction |
| **SDD: Export HTML** | | Save session as HTML |
| **SDD: Session Stats** | | Display token usage and cost |
| **SDD: Run Bash** | | Execute a shell command |
| **SDD: List Commands** | | Browse slash commands |
| **SDD: Set Session Name** | | Rename current session |
| **SDD: Copy Last Response** | | Copy to clipboard |
| **SDD: Switch Session** | | Load a different session |
| **SDD: Show History** | | Open conversation viewer |
| **SDD: Fork Session** | | Fork from a previous message |
| **SDD: Fix Problems in File** | | Send file diagnostics to agent |
| **SDD: Fix All Problems** | | Send workspace errors to agent |
| **SDD: Commit Agent Changes** | | Git commit modified files |
| **SDD: Create Branch** | | Create branch for agent work |
| **SDD: Show Agent Diff** | | View git diff |
| **SDD: Accept All Changes** | | Accept all SCM changes |
| **SDD: Discard All Changes** | | Revert all agent modifications |
| **SDD: Select Approval Mode** | | Choose auto-approve/ask/plan-only |
| **SDD: Cycle Approval Mode** | | Rotate through approval modes |
| **SDD: Code Lens** actions | | Ask, Refactor, Find Bugs, Tests |

> On Windows/Linux, replace `Cmd` with `Ctrl`.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `sdd.binaryPath` | `"sdd"` | Path to the SDD binary |
| `sdd.autoStart` | `false` | Start agent on extension activation |
| `sdd.autoCompaction` | `true` | Automatic context compaction |
| `sdd.codeLens` | `true` | Code lens above functions/classes |
| `sdd.showProgressNotifications` | `false` | Progress notification (off — Chat shows progress) |
| `sdd.activityFeedMaxItems` | `100` | Max items in Activity feed |
| `sdd.showContextWarning` | `true` | Warn when context exceeds threshold |
| `sdd.contextWarningThreshold` | `80` | Context % that triggers warning |
| `sdd.approvalMode` | `"auto-approve"` | Agent permission mode |

## How It Works

The extension spawns `sdd --mode rpc` and communicates over JSON-RPC via stdin/stdout. Agent events stream in real-time. The change tracker captures file state before modifications for SCM diffs and rollback. UI requests from the agent (questions, confirmations) are handled via VS Code dialogs.

## Links

- [SDD Documentation](https://github.com/bhargavvc/sdd/tree/main/docs)
- [Getting Started](https://github.com/bhargavvc/sdd/blob/main/docs/getting-started.md)
- [Issue Tracker](https://github.com/bhargavvc/sdd/issues)
