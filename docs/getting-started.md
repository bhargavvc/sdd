# Getting Started

## Install

```bash
npm install -g sdd-pi
```

Requires Node.js ≥ 22.0.0 (24 LTS recommended) and Git.

> **`command not found: sdd`?** Your shell may not have npm's global bin directory in `$PATH`. Run `npm prefix -g` to find it, then add `$(npm prefix -g)/bin` to your PATH. See [Troubleshooting](./troubleshooting.md#command-not-found-sdd-after-install) for details.

SDD checks for updates once every 24 hours. When a new version is available, you'll see an interactive prompt at startup with the option to update immediately or skip. You can also update from within a session with `/sdd update`.

### Set up API keys

If you use a non-Anthropic model, you'll need a search API key for web search. Run `/sdd config` to set keys globally — they're saved to `~/.sdd/agent/auth.json` and apply to all projects:

```bash
# Inside any SDD session:
/sdd config
```

See [Global API Keys](./configuration.md#global-api-keys-sdd-config) for details on supported keys.

### Set up custom MCP servers

If you want SDD to call local or external MCP servers, add project-local config in `.mcp.json` or `.sdd/mcp.json`.

See [Configuration → MCP Servers](./configuration.md#mcp-servers) for examples and verification steps.

### VS Code Extension

SDD is also available as a VS Code extension. Install from the marketplace (publisher: FluxLabs) or search for "SDD" in VS Code extensions. The extension provides:

- **`@sdd` chat participant** — talk to the agent in VS Code Chat
- **Sidebar dashboard** — connection status, model info, token usage, quick actions
- **Full command palette** — start/stop agent, switch models, export sessions

The CLI (`sdd-pi`) must be installed first — the extension connects to it via RPC.

## First Launch

Run `sdd` in any directory:

```bash
sdd
```

SDD displays a welcome screen showing your version, active model, and available tool keys. Then on first launch, it runs a setup wizard:

1. **LLM Provider** — select from 20+ providers (Anthropic, OpenAI, Google, OpenRouter, GitHub Copilot, Amazon Bedrock, Azure, and more). OAuth flows handle Claude Max and Copilot subscriptions automatically; otherwise paste an API key.
2. **Tool API Keys** (optional) — Brave Search, Context7, Jina, Slack, Discord. Press Enter to skip any.

If you have an existing Pi installation, provider credentials are imported automatically.

Re-run the wizard anytime with:

```bash
sdd config
```

## Choose a Model

SDD auto-selects a default model after login. Switch later with:

```
/model
```

Or configure per-phase models in preferences — see [Configuration](./configuration.md).

## Two Ways to Work

### Step Mode — `/sdd`

Type `/sdd` inside a session. SDD executes one unit of work at a time, pausing between each with a wizard showing what completed and what's next.

- **No `.sdd/` directory** → starts a discussion flow to capture your project vision
- **Milestone exists, no roadmap** → discuss or research the milestone
- **Roadmap exists, slices pending** → plan the next slice or execute a task
- **Mid-task** → resume where you left off

Step mode is the on-ramp. You stay in the loop, reviewing output between each step.

### Auto Mode — `/sdd auto`

Type `/sdd auto` and walk away. SDD autonomously researches, plans, executes, verifies, commits, and advances through every slice until the milestone is complete.

```
/sdd auto
```

See [Auto Mode](./auto-mode.md) for full details.

## Two Terminals, One Project

The recommended workflow: auto mode in one terminal, steering from another.

**Terminal 1 — let it build:**

```bash
sdd
/sdd auto
```

**Terminal 2 — steer while it works:**

```bash
sdd
/sdd discuss    # talk through architecture decisions
/sdd status     # check progress
/sdd queue      # queue the next milestone
```

Both terminals read and write the same `.sdd/` files. Decisions in terminal 2 are picked up at the next phase boundary automatically.

## Project Structure

SDD organizes work into a hierarchy:

```
Milestone  →  a shippable version (4-10 slices)
  Slice    →  one demoable vertical capability (1-7 tasks)
    Task   →  one context-window-sized unit of work
```

The iron rule: **a task must fit in one context window.** If it can't, it's two tasks.

All state lives on disk in `.sdd/`:

```
.sdd/
  PROJECT.md          — what the project is right now
  REQUIREMENTS.md     — requirement contract (active/validated/deferred)
  DECISIONS.md        — append-only architectural decisions
  KNOWLEDGE.md        — cross-session rules, patterns, and lessons
  RUNTIME.md          — runtime context: API endpoints, env vars, services (v2.39)
  STATE.md            — quick-glance status
  milestones/
    M001/
      M001-ROADMAP.md — slice plan with risk levels and dependencies
      M001-CONTEXT.md — scope and goals from discussion
      slices/
        S01/
          S01-PLAN.md     — task decomposition
          S01-SUMMARY.md  — what happened
          S01-UAT.md      — human test script
          tasks/
            T01-PLAN.md
            T01-SUMMARY.md
```

## Resume a Session

```bash
sdd --continue    # or sdd -c
```

Resumes the most recent session for the current directory.

To browse and pick from all saved sessions:

```bash
sdd sessions
```

Shows each session's date, message count, and first-message preview so you can choose which one to resume.

## Next Steps

- [Auto Mode](./auto-mode.md) — deep dive into autonomous execution
- [Configuration](./configuration.md) — model selection, timeouts, budgets
- [Commands Reference](./commands.md) — all commands and shortcuts

## Troubleshooting

### `sdd` command runs `git svn dcommit` instead of SDD

The [oh-my-zsh git plugin](https://github.com/ohmyzsh/ohmyzsh/tree/master/plugins/git) defines `alias sdd='git svn dcommit'`, which shadows the SDD binary.

**Option 1** — Remove the alias in your `~/.zshrc` (add after the `source $ZSH/oh-my-zsh.sh` line):

```bash
unalias sdd 2>/dev/null
```

**Option 2** — Use the alternative binary name:

```bash
sdd-cli
```

Both `sdd` and `sdd-cli` point to the same binary.
