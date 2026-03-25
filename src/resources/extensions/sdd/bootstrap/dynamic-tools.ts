import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@sdd/pi-coding-agent";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@sdd/pi-coding-agent";

import { DEFAULT_BASH_TIMEOUT_SECS } from "../constants.js";

export async function ensureDbOpen(): Promise<boolean> {
  try {
    const db = await import("../sdd-db.js");
    if (db.isDbAvailable()) return true;

    const basePath = process.cwd();
    const sddDir = join(basePath, ".sdd");
    const dbPath = join(sddDir, "sdd.db");

    // Open existing DB file
    if (existsSync(dbPath)) {
      return db.openDatabase(dbPath);
    }

    // No DB file — create + migrate from Markdown if .sdd/ has content
    if (existsSync(sddDir)) {
      const hasDecisions = existsSync(join(sddDir, "DECISIONS.md"));
      const hasRequirements = existsSync(join(sddDir, "REQUIREMENTS.md"));
      const hasMilestones = existsSync(join(sddDir, "milestones"));
      if (hasDecisions || hasRequirements || hasMilestones) {
        const opened = db.openDatabase(dbPath);
        if (opened) {
          try {
            const { migrateFromMarkdown } = await import("../md-importer.js");
            migrateFromMarkdown(basePath);
          } catch (err) {
            process.stderr.write(
              `sdd-db: ensureDbOpen auto-migration failed: ${(err as Error).message}\n`,
            );
          }
        }
        return opened;
      }
    }

    return false;
  } catch {
    return false;
  }
}

export function registerDynamicTools(pi: ExtensionAPI): void {
  const baseBash = createBashTool(process.cwd(), {
    spawnHook: (ctx) => ({ ...ctx, cwd: process.cwd() }),
  });
  const dynamicBash = {
    ...baseBash,
    execute: async (
      toolCallId: string,
      params: { command: string; timeout?: number },
      signal?: AbortSignal,
      onUpdate?: unknown,
      ctx?: unknown,
    ) => {
      const paramsWithTimeout = {
        ...params,
        timeout: params.timeout ?? DEFAULT_BASH_TIMEOUT_SECS,
      };
      return (baseBash as any).execute(toolCallId, paramsWithTimeout, signal, onUpdate, ctx);
    },
  };
  pi.registerTool(dynamicBash as any);

  const baseWrite = createWriteTool(process.cwd());
  pi.registerTool({
    ...baseWrite,
    execute: async (
      toolCallId: string,
      params: { path: string; content: string },
      signal?: AbortSignal,
      onUpdate?: unknown,
      ctx?: unknown,
    ) => {
      const fresh = createWriteTool(process.cwd());
      return (fresh as any).execute(toolCallId, params, signal, onUpdate, ctx);
    },
  } as any);

  const baseRead = createReadTool(process.cwd());
  pi.registerTool({
    ...baseRead,
    execute: async (
      toolCallId: string,
      params: { path: string; offset?: number; limit?: number },
      signal?: AbortSignal,
      onUpdate?: unknown,
      ctx?: unknown,
    ) => {
      const fresh = createReadTool(process.cwd());
      return (fresh as any).execute(toolCallId, params, signal, onUpdate, ctx);
    },
  } as any);

  const baseEdit = createEditTool(process.cwd());
  pi.registerTool({
    ...baseEdit,
    execute: async (
      toolCallId: string,
      params: { path: string; oldText: string; newText: string },
      signal?: AbortSignal,
      onUpdate?: unknown,
      ctx?: unknown,
    ) => {
      const fresh = createEditTool(process.cwd());
      return (fresh as any).execute(toolCallId, params, signal, onUpdate, ctx);
    },
  } as any);
}

