# SDD — VS Code Extension

Control the [SDD coding agent](https://github.com/bhargavvc/sdd) directly from VS Code. Run autonomous coding sessions, chat with `@sdd` in VS Code Chat, and monitor your agent from a sidebar dashboard — all without leaving the editor.

## Requirements

SDD must be installed before activating this extension:

```bash
npm install -g sdd-pi
```

Node.js ≥ 20.0.0 and Git are required.

## Features

### Sidebar Dashboard

Click the SDD icon in the Activity Bar to open the agent dashboard. It shows:

- Connection status (connected / disconnected)
- Active model and provider
- Thinking level
- Token usage and session cost
- Quick action buttons: Start, Stop, New Session, Compact, Abort

### Chat Integration (`@sdd`)

Use `@sdd` in VS Code Chat (`Ctrl+Shift+I`) to send messages to the agent:

```
@sdd refactor the auth module to use JWT
@sdd /sdd auto
@sdd what's the current milestone status?
```

### Commands

All commands are accessible via `Ctrl+Shift+P`:

| Command | Description |
|---------|-------------|
| **SDD: Start Agent** | Connect to the SDD agent |
| **SDD: Stop Agent** | Disconnect the agent |
| **SDD: New Session** | Start a fresh conversation |
| **SDD: Send Message** | Send a message to the agent |
| **SDD: Abort Current Operation** | Interrupt the current operation |
| **SDD: Steer Agent** | Send a steering message mid-operation |
| **SDD: Switch Model** | Pick a model from QuickPick |
| **SDD: Cycle Model** | Rotate to the next configured model |
| **SDD: Set Thinking Level** | Choose off / low / medium / high |
| **SDD: Cycle Thinking Level** | Rotate through thinking levels |
| **SDD: Compact Context** | Manually trigger context compaction |
| **SDD: Export Conversation as HTML** | Save the session as HTML |
| **SDD: Show Session Stats** | Display token usage and cost |
| **SDD: Run Bash Command** | Execute a shell command via the agent |
| **SDD: List Available Commands** | Browse and run SDD slash commands |

### Keyboard Shortcuts

| Shortcut | Command |
|----------|---------|
| `Ctrl+Shift+G Ctrl+Shift+N` | New Session |
| `Ctrl+Shift+G Ctrl+Shift+M` | Cycle Model |
| `Ctrl+Shift+G Ctrl+Shift+T` | Cycle Thinking Level |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `sdd.binaryPath` | `"sdd"` | Path to the SDD binary if not on PATH |
| `sdd.autoStart` | `false` | Start the agent automatically when the extension activates |
| `sdd.autoCompaction` | `true` | Enable automatic context compaction |

## Quick Start

1. Install SDD: `npm install -g sdd-pi`
2. Install this extension
3. Open a project folder in VS Code
4. `Ctrl+Shift+P` → **SDD: Start Agent**
5. Use `@sdd` in Chat or the sidebar to interact with the agent

## How It Works

The extension spawns `sdd --mode rpc` in the background and communicates over JSON-RPC via stdin/stdout. All RPC commands are supported, including streaming events for real-time sidebar updates.

## Links

- [SDD Documentation](https://github.com/bhargavvc/sdd/tree/main/docs)
- [Getting Started](https://github.com/bhargavvc/sdd/blob/main/docs/getting-started.md)
- [Issue Tracker](https://github.com/bhargavvc/sdd/issues)
