import { BUILTIN_SLASH_COMMANDS } from "../../packages/pi-coding-agent/src/core/slash-commands.ts"

export type BrowserSlashCommandSurface =
  | "settings"
  | "model"
  | "thinking"
  | "git"
  | "resume"
  | "name"
  | "fork"
  | "compact"
  | "login"
  | "logout"
  | "session"
  | "export"
  // SDD subcommand surfaces (S02)
  | "sdd-status"
  | "sdd-visualize"
  | "sdd-forensics"
  | "sdd-doctor"
  | "sdd-skill-health"
  | "sdd-knowledge"
  | "sdd-capture"
  | "sdd-triage"
  | "sdd-quick"
  | "sdd-history"
  | "sdd-undo"
  | "sdd-inspect"
  | "sdd-prefs"
  | "sdd-config"
  | "sdd-hooks"
  | "sdd-mode"
  | "sdd-steer"
  | "sdd-export"
  | "sdd-cleanup"
  | "sdd-queue"

export type BrowserSlashCommandLocalAction = "clear_terminal" | "refresh_workspace" | "sdd_help"

export type BrowserSlashPromptCommandType = "prompt" | "follow_up"

export interface BrowserSlashCommandDispatchOptions {
  isStreaming?: boolean
}

export type BrowserSlashCommandDispatchResult =
  | {
      kind: "prompt"
      input: string
      slashCommandName: string | null
      command: {
        type: BrowserSlashPromptCommandType
        message: string
      }
    }
  | {
      kind: "rpc"
      input: string
      commandName: string
      command:
        | { type: "get_state" }
        | { type: "new_session" }
    }
  | {
      kind: "surface"
      input: string
      commandName: string
      surface: BrowserSlashCommandSurface
      args: string
    }
  | {
      kind: "local"
      input: string
      commandName: string
      action: BrowserSlashCommandLocalAction
    }
  | {
      kind: "reject"
      input: string
      commandName: string
      reason: string
      guidance: string
    }
  | {
      kind: "view-navigate"
      input: string
      commandName: string
      view: string
    }

export interface BrowserSlashCommandTerminalNotice {
  type: "system" | "error"
  message: string
}

const BUILTIN_COMMAND_DESCRIPTIONS = new Map(BUILTIN_SLASH_COMMANDS.map((command) => [command.name, command.description]))
const BUILTIN_COMMAND_NAMES = new Set(BUILTIN_COMMAND_DESCRIPTIONS.keys())

const SURFACE_COMMANDS = new Map<string, BrowserSlashCommandSurface>([
  ["settings", "settings"],
  ["model", "model"],
  ["thinking", "thinking"],
  ["git", "git"],
  ["resume", "resume"],
  ["name", "name"],
  ["fork", "fork"],
  ["compact", "compact"],
  ["login", "login"],
  ["logout", "logout"],
  ["session", "session"],
  ["export", "export"],
])

// --- SDD subcommand dispatch (S02) ---

const SDD_SURFACE_SUBCOMMANDS = new Map<string, BrowserSlashCommandSurface>([
  ["status", "sdd-status"],
  ["visualize", "sdd-visualize"],
  ["forensics", "sdd-forensics"],
  ["doctor", "sdd-doctor"],
  ["skill-health", "sdd-skill-health"],
  ["knowledge", "sdd-knowledge"],
  ["capture", "sdd-capture"],
  ["triage", "sdd-triage"],
  ["quick", "sdd-quick"],
  ["history", "sdd-history"],
  ["undo", "sdd-undo"],
  ["inspect", "sdd-inspect"],
  ["prefs", "sdd-prefs"],
  ["config", "sdd-config"],
  ["hooks", "sdd-hooks"],
  ["mode", "sdd-mode"],
  ["steer", "sdd-steer"],
  ["export", "sdd-export"],
  ["cleanup", "sdd-cleanup"],
  ["queue", "sdd-queue"],
])

const SDD_PASSTHROUGH_SUBCOMMANDS = new Set<string>([
  "auto",
  "next",
  "stop",
  "pause",
  "skip",
  "discuss",
  "run-hook",
  "migrate",
  "remote",
])

export const SDD_HELP_TEXT = `Available /sdd subcommands:

Workflow:    next · auto · stop · pause · skip · queue · quick · capture · triage
Diagnostics: status · visualize · forensics · doctor · skill-health · inspect
Context:     knowledge · history · undo · discuss
Settings:    prefs · config · hooks · mode · steer
Advanced:    export · cleanup · run-hook · migrate · remote

Type /sdd <subcommand> to run. Use /sdd help for this message.`

function dispatchSDDSubcommand(
  input: string,
  args: string,
  options: BrowserSlashCommandDispatchOptions,
): BrowserSlashCommandDispatchResult {
  const trimmedArgs = args.trim()
  const spaceIndex = trimmedArgs.search(/\s/)
  const subcommand = spaceIndex === -1 ? trimmedArgs : trimmedArgs.slice(0, spaceIndex)
  const subArgs = spaceIndex === -1 ? "" : trimmedArgs.slice(spaceIndex + 1).trim()

  // Bare `/sdd` — equivalent to `/sdd next`, pass through to bridge
  if (!subcommand) {
    return {
      kind: "prompt",
      input,
      slashCommandName: "sdd",
      command: {
        type: getPromptCommandType(options),
        message: input,
      },
    }
  }

  // `/sdd help` — render inline help locally
  if (subcommand === "help") {
    return {
      kind: "local",
      input,
      commandName: "sdd",
      action: "sdd_help",
    }
  }

  // `/sdd visualize` — navigate to the visualizer view directly
  if (subcommand === "visualize") {
    return {
      kind: "view-navigate",
      input,
      commandName: "sdd",
      view: "visualize",
    }
  }

  // Surface-routed subcommands — open browser-native UI
  const surface = SDD_SURFACE_SUBCOMMANDS.get(subcommand)
  if (surface) {
    return {
      kind: "surface",
      input,
      commandName: "sdd",
      surface,
      args: subArgs,
    }
  }

  // Bridge-passthrough subcommands — let the extension handle them
  if (SDD_PASSTHROUGH_SUBCOMMANDS.has(subcommand)) {
    return {
      kind: "prompt",
      input,
      slashCommandName: "sdd",
      command: {
        type: getPromptCommandType(options),
        message: input,
      },
    }
  }

  // Unknown subcommand — pass through; extension handler will show "Unknown"
  return {
    kind: "prompt",
    input,
    slashCommandName: "sdd",
    command: {
      type: getPromptCommandType(options),
      message: input,
    },
  }
}

function parseSlashCommand(input: string): { name: string; args: string } | null {
  if (!input.startsWith("/")) return null
  const body = input.slice(1).trim()
  if (!body) return null

  const firstSpaceIndex = body.search(/\s/)
  if (firstSpaceIndex === -1) {
    return { name: body, args: "" }
  }

  return {
    name: body.slice(0, firstSpaceIndex),
    args: body.slice(firstSpaceIndex + 1).trim(),
  }
}

function getPromptCommandType(options: BrowserSlashCommandDispatchOptions): BrowserSlashPromptCommandType {
  return options.isStreaming ? "follow_up" : "prompt"
}

function formatBuiltinDescription(commandName: string): string {
  return BUILTIN_COMMAND_DESCRIPTIONS.get(commandName) ?? "Browser handling is reserved for this built-in command."
}

function buildDeferredBuiltinReject(input: string, commandName: string): BrowserSlashCommandDispatchResult {
  const description = formatBuiltinDescription(commandName)
  return {
    kind: "reject",
    input,
    commandName,
    reason: `/${commandName} is a built-in pi command (${description}) that is not available in the browser yet.`,
    guidance: "It was blocked instead of falling through to the model.",
  }
}

export function isAuthoritativeBuiltinSlashCommand(commandName: string): boolean {
  return BUILTIN_COMMAND_NAMES.has(commandName)
}

export function dispatchBrowserSlashCommand(
  input: string,
  options: BrowserSlashCommandDispatchOptions = {},
): BrowserSlashCommandDispatchResult {
  const trimmed = input.trim()
  const parsed = parseSlashCommand(trimmed)

  if (trimmed === "/clear") {
    return {
      kind: "local",
      input: trimmed,
      commandName: "clear",
      action: "clear_terminal",
    }
  }

  if (trimmed === "/refresh") {
    return {
      kind: "local",
      input: trimmed,
      commandName: "refresh",
      action: "refresh_workspace",
    }
  }

  if (trimmed === "/state") {
    return {
      kind: "rpc",
      input: trimmed,
      commandName: "state",
      command: { type: "get_state" },
    }
  }

  if (trimmed === "/new-session") {
    return {
      kind: "rpc",
      input: trimmed,
      commandName: "new",
      command: { type: "new_session" },
    }
  }

  if (!parsed) {
    return {
      kind: "prompt",
      input: trimmed,
      slashCommandName: null,
      command: {
        type: getPromptCommandType(options),
        message: trimmed,
      },
    }
  }

  if (parsed.name === "new") {
    return {
      kind: "rpc",
      input: trimmed,
      commandName: "new",
      command: { type: "new_session" },
    }
  }

  // SDD subcommand dispatch — must precede SURFACE_COMMANDS to avoid
  // `/sdd export` colliding with the built-in `/export` surface.
  if (parsed.name === "sdd") {
    return dispatchSDDSubcommand(trimmed, parsed.args, options)
  }

  const browserSurface = SURFACE_COMMANDS.get(parsed.name)
  if (browserSurface) {
    return {
      kind: "surface",
      input: trimmed,
      commandName: parsed.name,
      surface: browserSurface,
      args: parsed.args,
    }
  }

  if (BUILTIN_COMMAND_NAMES.has(parsed.name)) {
    return buildDeferredBuiltinReject(trimmed, parsed.name)
  }

  return {
    kind: "prompt",
    input: trimmed,
    slashCommandName: parsed.name,
    command: {
      type: getPromptCommandType(options),
      message: trimmed,
    },
  }
}

export function getBrowserSlashCommandTerminalNotice(
  outcome: BrowserSlashCommandDispatchResult,
): BrowserSlashCommandTerminalNotice | null {
  switch (outcome.kind) {
    case "surface":
      return {
        type: "system",
        message: `/${outcome.commandName} is reserved for browser-native handling and was not sent to the model.`,
      }
    case "reject":
      return {
        type: "error",
        message: `${outcome.reason} ${outcome.guidance}`.trim(),
      }
    default:
      return null
  }
}
