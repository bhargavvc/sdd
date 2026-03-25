const SUBCOMMAND_HELP: Record<string, string> = {
  config: [
    'Usage: sdd config',
    '',
    'Re-run the interactive setup wizard to configure:',
    '  - LLM provider (Anthropic, OpenAI, Google, etc.)',
    '  - Web search provider (Brave, Tavily, built-in)',
    '  - Remote questions (Discord, Slack, Telegram)',
    '  - Tool API keys (Context7, Jina, Groq)',
    '',
    'All steps are skippable and can be changed later with /login or /search-provider.',
  ].join('\n'),

  update: [
    'Usage: sdd update',
    '',
    'Update SDD to the latest version.',
    '',
    'Equivalent to: npm install -g sdd-pi@latest',
  ].join('\n'),

  sessions: [
    'Usage: sdd sessions',
    '',
    'List all saved sessions for the current directory and interactively',
    'pick one to resume. Shows date, message count, and a preview of the',
    'first message for each session.',
    '',
    'Sessions are stored per-directory, so you only see sessions that were',
    'started from the current working directory.',
    '',
    'Compare with --continue (-c) which always resumes the most recent session.',
  ].join('\n'),

  worktree: [
    'Usage: sdd worktree <command> [args]',
    '',
    'Manage isolated git worktrees for parallel work streams.',
    '',
    'Commands:',
    '  list                 List worktrees with status (files changed, commits, dirty)',
    '  merge [name]         Squash-merge a worktree into main and clean up',
    '  clean                Remove all worktrees that have been merged or are empty',
    '  remove <name>        Remove a worktree (--force to remove with unmerged changes)',
    '',
    'The -w flag creates/resumes worktrees for interactive sessions:',
    '  sdd -w               Auto-name a new worktree, or resume the only active one',
    '  sdd -w my-feature    Create or resume a named worktree',
    '',
    'Lifecycle:',
    '  1. sdd -w             Create worktree, start session inside it',
    '  2. (work normally)    All changes happen on the worktree branch',
    '  3. Ctrl+C             Exit — dirty work is auto-committed',
    '  4. sdd -w             Resume where you left off',
    '  5. sdd worktree merge Squash-merge into main when done',
    '',
    'Examples:',
    '  sdd -w                              Start in a new auto-named worktree',
    '  sdd -w auth-refactor                Create/resume "auth-refactor" worktree',
    '  sdd worktree list                   See all worktrees and their status',
    '  sdd worktree merge auth-refactor    Merge and clean up',
    '  sdd worktree clean                  Remove all merged/empty worktrees',
    '  sdd worktree remove old-branch      Remove a specific worktree',
    '  sdd worktree remove old-branch --force  Remove even with unmerged changes',
  ].join('\n'),

  headless: [
    'Usage: sdd headless [flags] [command] [args...]',
    '',
    'Run /sdd commands without the TUI. Default command: auto',
    '',
    'Flags:',
    '  --timeout N          Overall timeout in ms (default: 300000)',
    '  --json               JSONL event stream to stdout',
    '  --model ID           Override model',
    '  --supervised           Forward interactive UI requests to orchestrator via stdout/stdin',
    '  --response-timeout N   Timeout (ms) for orchestrator response (default: 30000)',
    '  --answers <path>       Pre-supply answers and secrets (JSON file)',
    '  --events <types>       Filter JSONL output to specific event types (comma-separated)',
    '',
    'Commands:',
    '  auto                 Run all queued units continuously (default)',
    '  next                 Run one unit',
    '  status               Show progress dashboard',
    '  new-milestone        Create a milestone from a specification document',
    '  query                JSON snapshot: state + next dispatch + costs (no LLM)',
    '',
    'new-milestone flags:',
    '  --context <path>     Path to spec/PRD file (use \'-\' for stdin)',
    '  --context-text <txt> Inline specification text',
    '  --auto               Start auto-mode after milestone creation',
    '  --verbose            Show tool calls in progress output',
    '',
    'Examples:',
    '  sdd headless                                    Run /sdd auto',
    '  sdd headless next                               Run one unit',
    '  sdd headless --json status                      Machine-readable status',
    '  sdd headless --timeout 60000                    With 1-minute timeout',
    '  sdd headless new-milestone --context spec.md    Create milestone from file',
    '  cat spec.md | sdd headless new-milestone --context -   From stdin',
    '  sdd headless new-milestone --context spec.md --auto    Create + auto-execute',
    '  sdd headless --supervised auto                     Supervised orchestrator mode',
    '  sdd headless --answers answers.json auto              With pre-supplied answers',
    '  sdd headless --events agent_end,extension_ui_request auto   Filtered event stream',
    '  sdd headless query                              Instant JSON state snapshot',
    '',
    'Exit codes: 0 = complete, 1 = error/timeout, 2 = blocked',
  ].join('\n'),
}

// Alias: `sdd wt --help` → same as `sdd worktree --help`
SUBCOMMAND_HELP['wt'] = SUBCOMMAND_HELP['worktree']

export function printHelp(version: string): void {
  process.stdout.write(`SDD v${version} — Spec-Driven Development\n\n`)
  process.stdout.write('Usage: sdd [options] [message...]\n\n')
  process.stdout.write('Options:\n')
  process.stdout.write('  --mode <text|json|rpc|mcp> Output mode (default: interactive)\n')
  process.stdout.write('  --print, -p              Single-shot print mode\n')
  process.stdout.write('  --continue, -c           Resume the most recent session\n')
  process.stdout.write('  --worktree, -w [name]    Start in an isolated worktree (auto-named if omitted)\n')
  process.stdout.write('  --model <id>             Override model (e.g. claude-opus-4-6)\n')
  process.stdout.write('  --no-session             Disable session persistence\n')
  process.stdout.write('  --extension <path>       Load additional extension\n')
  process.stdout.write('  --tools <a,b,c>          Restrict available tools\n')
  process.stdout.write('  --list-models [search]   List available models and exit\n')
  process.stdout.write('  --version, -v            Print version and exit\n')
  process.stdout.write('  --help, -h               Print this help and exit\n')
  process.stdout.write('\nSubcommands:\n')
  process.stdout.write('  config                   Re-run the setup wizard\n')
  process.stdout.write('  update                   Update SDD to the latest version\n')
  process.stdout.write('  sessions                 List and resume a past session\n')
  process.stdout.write('  worktree <cmd>           Manage worktrees (list, merge, clean, remove)\n')
  process.stdout.write('  headless [cmd] [args]    Run /sdd commands without TUI (default: auto)\n')
  process.stdout.write('\nRun sdd <subcommand> --help for subcommand-specific help.\n')
}

export function printSubcommandHelp(subcommand: string, version: string): boolean {
  const help = SUBCOMMAND_HELP[subcommand]
  if (!help) return false
  process.stdout.write(`SDD v${version} — Spec-Driven Development\n\n`)
  process.stdout.write(help + '\n')
  return true
}
