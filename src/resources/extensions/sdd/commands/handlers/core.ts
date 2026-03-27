import type { ExtensionCommandContext, ExtensionContext } from "@sdd/pi-coding-agent";
import type { SDDState } from "../../types.js";

import { computeProgressScore, formatProgressLine } from "../../progress-score.js";
import { loadEffectiveSDDPreferences, getGlobalSDDPreferencesPath, getProjectSDDPreferencesPath } from "../../preferences.js";
import { ensurePreferencesFile, handlePrefs, handlePrefsMode, handlePrefsWizard } from "../../commands-prefs-wizard.js";
import { runEnvironmentChecks } from "../../doctor-environment.js";
import { deriveState } from "../../state.js";
import { handleCmux } from "../../commands-cmux.js";
import { projectRoot } from "../context.js";

export function showHelp(ctx: ExtensionCommandContext): void {
  const lines = [
    "SDD — Get Shit Done\n",
    "WORKFLOW",
    "  /sdd start <tpl>   Start a workflow template (bugfix, spike, feature, hotfix, etc.)",
    "  /sdd templates     List available workflow templates  [info <name>]",
    "  /sdd               Run next unit in step mode (same as /sdd next)",
    "  /sdd next           Execute next task, then pause  [--dry-run] [--verbose]",
    "  /sdd auto           Run all queued units continuously  [--verbose]",
    "  /sdd stop           Stop auto-mode gracefully",
    "  /sdd pause          Pause auto-mode (preserves state, /sdd auto to resume)",
    "  /sdd discuss        Start guided milestone/slice discussion",
    "  /sdd new-milestone  Create milestone from headless context (used by sdd headless)",
    "",
    "VISIBILITY",
    "  /sdd status         Show progress dashboard  (Ctrl+Alt+G)",
    "  /sdd visualize      Interactive 10-tab TUI (progress, timeline, deps, metrics, health, agent, changes, knowledge, captures, export)",
    "  /sdd queue          Show queued/dispatched units and execution order",
    "  /sdd history        View execution history  [--cost] [--phase] [--model] [N]",
    "  /sdd changelog      Show categorized release notes  [version]",
    "",
    "COURSE CORRECTION",
    "  /sdd steer <desc>   Apply user override to active work",
    "  /sdd capture <text> Quick-capture a thought to CAPTURES.md",
    "  /sdd triage         Classify and route pending captures",
    "  /sdd skip <unit>    Prevent a unit from auto-mode dispatch",
    "  /sdd undo           Revert last completed unit  [--force]",
    "  /sdd rethink        Conversational project reorganization — reorder, park, discard, add milestones",
    "  /sdd park [id]      Park a milestone — skip without deleting  [reason]",
    "  /sdd unpark [id]    Reactivate a parked milestone",
    "",
    "PROJECT KNOWLEDGE",
    "  /sdd knowledge <type> <text>   Add rule, pattern, or lesson to KNOWLEDGE.md",
    "",
    "SETUP & CONFIGURATION",
    "  /sdd init           Project init wizard — detect, configure, bootstrap .sdd/",
    "  /sdd setup          Global setup status  [llm|search|remote|keys|prefs]",
    "  /sdd mode           Set workflow mode (solo/team)  [global|project]",
    "  /sdd prefs          Manage preferences  [global|project|status|wizard|setup|import-claude]",
    "  /sdd cmux           Manage cmux integration  [status|on|off|notifications|sidebar|splits|browser]",
    "  /sdd config         Set API keys for external tools",
    "  /sdd keys           API key manager  [list|add|remove|test|rotate|doctor]",
    "  /sdd hooks          Show post-unit hook configuration",
    "  /sdd extensions     Manage extensions  [list|enable|disable|info]",
    "  /sdd fast           Toggle OpenAI service tier  [on|off|flex|status]",
    "  /sdd mcp            MCP server status and connectivity  [status|check <server>]",
    "",
    "MAINTENANCE",
    "  /sdd doctor         Diagnose and repair .sdd/ state  [audit|fix|heal] [scope]",
    "  /sdd export         Export milestone/slice results  [--json|--markdown|--html] [--all]",
    "  /sdd cleanup        Remove merged branches or snapshots  [branches|snapshots]",
    "  /sdd migrate        Migrate .planning/ (v1) to .sdd/ (v2) format",
    "  /sdd remote         Control remote auto-mode  [slack|discord|status|disconnect]",
    "  /sdd inspect        Show SQLite DB diagnostics (schema, row counts, recent entries)",
    "  /sdd update         Update SDD to the latest version via npm",
  ];
  ctx.ui.notify(lines.join("\n"), "info");
}

export async function handleStatus(ctx: ExtensionCommandContext): Promise<void> {
  const basePath = projectRoot();
  const state = await deriveState(basePath);

  if (state.registry.length === 0) {
    ctx.ui.notify("No SDD milestones found. Run /sdd to start.", "info");
    return;
  }

  const { SDDDashboardOverlay } = await import("../../dashboard-overlay.js");
  const result = await ctx.ui.custom<void>(
    (tui, theme, _kb, done) => new SDDDashboardOverlay(tui, theme, () => done()),
    {
      overlay: true,
      overlayOptions: {
        width: "70%",
        minWidth: 60,
        maxHeight: "90%",
        anchor: "center",
      },
    },
  );

  if (result === undefined) {
    ctx.ui.notify(formatTextStatus(state), "info");
  }
}

export async function fireStatusViaCommand(ctx: ExtensionContext): Promise<void> {
  await handleStatus(ctx as ExtensionCommandContext);
}

export async function handleVisualize(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("Visualizer requires an interactive terminal.", "warning");
    return;
  }

  const { SDDVisualizerOverlay } = await import("../../visualizer-overlay.js");
  const result = await ctx.ui.custom<void>(
    (tui, theme, _kb, done) => new SDDVisualizerOverlay(tui, theme, () => done()),
    {
      overlay: true,
      overlayOptions: {
        width: "80%",
        minWidth: 80,
        maxHeight: "90%",
        anchor: "center",
      },
    },
  );

  if (result === undefined) {
    ctx.ui.notify("Visualizer requires an interactive terminal. Use /sdd status for a text-based overview.", "warning");
  }
}

export async function handleSetup(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const { detectProjectState, hasGlobalSetup } = await import("../../detection.js");

  const globalConfigured = hasGlobalSetup();
  const detection = detectProjectState(projectRoot());

  const statusLines = ["SDD Setup Status\n"];
  statusLines.push(`  Global preferences: ${globalConfigured ? "configured" : "not set"}`);
  statusLines.push(`  Project state: ${detection.state}`);
  if (detection.projectSignals.primaryLanguage) {
    statusLines.push(`  Detected: ${detection.projectSignals.primaryLanguage}`);
  }

  if (args === "llm" || args === "auth") {
    ctx.ui.notify("Use /login to configure LLM authentication.", "info");
    return;
  }
  if (args === "search") {
    ctx.ui.notify("Use /search-provider to configure web search.", "info");
    return;
  }
  if (args === "remote") {
    ctx.ui.notify("Use /sdd remote to configure remote questions.", "info");
    return;
  }
  if (args === "keys") {
    const { handleKeys } = await import("../../key-manager.js");
    await handleKeys("", ctx);
    return;
  }
  if (args === "prefs") {
    await ensurePreferencesFile(getGlobalSDDPreferencesPath(), ctx, "global");
    await handlePrefsWizard(ctx, "global");
    return;
  }

  ctx.ui.notify(statusLines.join("\n"), "info");
  ctx.ui.notify(
    "Available setup commands:\n" +
    "  /sdd setup llm     — LLM authentication\n" +
    "  /sdd setup search  — Web search provider\n" +
    "  /sdd setup remote  — Remote questions (Discord/Slack/Telegram)\n" +
    "  /sdd setup keys    — Tool API keys\n" +
    "  /sdd setup prefs   — Global preferences wizard",
    "info",
  );
}

export async function handleCoreCommand(trimmed: string, ctx: ExtensionCommandContext): Promise<boolean> {
  if (trimmed === "help" || trimmed === "h" || trimmed === "?") {
    showHelp(ctx);
    return true;
  }
  if (trimmed === "status") {
    await handleStatus(ctx);
    return true;
  }
  if (trimmed === "visualize") {
    await handleVisualize(ctx);
    return true;
  }
  if (trimmed === "widget" || trimmed.startsWith("widget ")) {
    const { cycleWidgetMode, setWidgetMode, getWidgetMode } = await import("../../auto-dashboard.js");
    const arg = trimmed.replace(/^widget\s*/, "").trim();
    if (arg === "full" || arg === "small" || arg === "min" || arg === "off") {
      setWidgetMode(arg);
    } else {
      cycleWidgetMode();
    }
    ctx.ui.notify(`Widget: ${getWidgetMode()}`, "info");
    return true;
  }
  if (trimmed === "mode" || trimmed.startsWith("mode ")) {
    const modeArgs = trimmed.replace(/^mode\s*/, "").trim();
    const scope = modeArgs === "project" ? "project" : "global";
    const path = scope === "project" ? getProjectSDDPreferencesPath() : getGlobalSDDPreferencesPath();
    await ensurePreferencesFile(path, ctx, scope);
    await handlePrefsMode(ctx, scope);
    return true;
  }
  if (trimmed === "prefs" || trimmed.startsWith("prefs ")) {
    await handlePrefs(trimmed.replace(/^prefs\s*/, "").trim(), ctx);
    return true;
  }
  if (trimmed === "cmux" || trimmed.startsWith("cmux ")) {
    await handleCmux(trimmed.replace(/^cmux\s*/, "").trim(), ctx);
    return true;
  }
  if (trimmed === "setup" || trimmed.startsWith("setup ")) {
    await handleSetup(trimmed.replace(/^setup\s*/, "").trim(), ctx);
    return true;
  }
  return false;
}

export function formatTextStatus(state: SDDState): string {
  const lines: string[] = ["SDD Status\n"];
  lines.push(formatProgressLine(computeProgressScore()));
  lines.push("");
  lines.push(`Phase: ${state.phase}`);

  if (state.activeMilestone) {
    lines.push(`Active milestone: ${state.activeMilestone.id} — ${state.activeMilestone.title}`);
  }
  if (state.activeSlice) {
    lines.push(`Active slice: ${state.activeSlice.id} — ${state.activeSlice.title}`);
  }
  if (state.activeTask) {
    lines.push(`Active task: ${state.activeTask.id} — ${state.activeTask.title}`);
  }
  if (state.progress) {
    const { milestones, slices, tasks } = state.progress;
    const parts: string[] = [`milestones ${milestones.done}/${milestones.total}`];
    if (slices) parts.push(`slices ${slices.done}/${slices.total}`);
    if (tasks) parts.push(`tasks ${tasks.done}/${tasks.total}`);
    lines.push(`Progress: ${parts.join(", ")}`);
  }
  if (state.nextAction) {
    lines.push(`Next: ${state.nextAction}`);
  }
  if (state.blockers.length > 0) {
    lines.push(`Blockers: ${state.blockers.join("; ")}`);
  }
  if (state.registry.length > 0) {
    lines.push("");
    lines.push("Milestones:");
    for (const milestone of state.registry) {
      const icon = milestone.status === "complete"
        ? "✓"
        : milestone.status === "active"
          ? "▶"
          : milestone.status === "parked"
            ? "⏸"
            : "○";
      lines.push(`  ${icon} ${milestone.id}: ${milestone.title} (${milestone.status})`);
    }
  }

  const envResults = runEnvironmentChecks(projectRoot());
  const envIssues = envResults.filter((result) => result.status !== "ok");
  if (envIssues.length > 0) {
    lines.push("");
    lines.push("Environment:");
    for (const issue of envIssues) {
      lines.push(`  ${issue.status === "error" ? "✗" : "⚠"} ${issue.message}`);
    }
  }

  return lines.join("\n");
}
