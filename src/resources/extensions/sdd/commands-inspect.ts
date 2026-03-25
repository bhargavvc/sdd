/**
 * SDD Inspect — SQLite DB diagnostics.
 *
 * Contains: InspectData type, formatInspectOutput, handleInspect
 */

import type { ExtensionCommandContext } from "@sdd/pi-coding-agent";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sddRoot } from "./paths.js";
import { getErrorMessage } from "./error-utils.js";

export interface InspectData {
  schemaVersion: number | null;
  counts: { decisions: number; requirements: number; artifacts: number };
  recentDecisions: Array<{ id: string; decision: string; choice: string }>;
  recentRequirements: Array<{ id: string; status: string; description: string }>;
}

export function formatInspectOutput(data: InspectData): string {
  const lines: string[] = [];
  lines.push("=== SDD Database Inspect ===");
  lines.push(`Schema version: ${data.schemaVersion ?? "unknown"}`);
  lines.push("");
  lines.push(`Decisions:    ${data.counts.decisions}`);
  lines.push(`Requirements: ${data.counts.requirements}`);
  lines.push(`Artifacts:    ${data.counts.artifacts}`);

  if (data.recentDecisions.length > 0) {
    lines.push("");
    lines.push("Recent decisions:");
    for (const d of data.recentDecisions) {
      lines.push(`  ${d.id}: ${d.decision} → ${d.choice}`);
    }
  }

  if (data.recentRequirements.length > 0) {
    lines.push("");
    lines.push("Recent requirements:");
    for (const r of data.recentRequirements) {
      lines.push(`  ${r.id} [${r.status}]: ${r.description}`);
    }
  }

  return lines.join("\n");
}

export async function handleInspect(ctx: ExtensionCommandContext): Promise<void> {
  try {
    const { isDbAvailable, _getAdapter, openDatabase } = await import("./sdd-db.js");

    if (!isDbAvailable()) {
      const sddDir = sddRoot(process.cwd());
      const dbPath = join(sddDir, "sdd.db");
      if (!existsSync(sddDir) || !existsSync(dbPath) || !openDatabase(dbPath)) {
        ctx.ui.notify("No SDD database available. Run /sdd auto to create one.", "info");
        return;
      }
    }

    const adapter = _getAdapter();
    if (!adapter) {
      ctx.ui.notify("No SDD database available. Run /sdd auto to create one.", "info");
      return;
    }

    const versionRow = adapter.prepare("SELECT MAX(version) as v FROM schema_version").get();
    const schemaVersion = versionRow ? (versionRow["v"] as number | null) : null;

    const dCount = adapter.prepare("SELECT count(*) as cnt FROM decisions").get();
    const rCount = adapter.prepare("SELECT count(*) as cnt FROM requirements").get();
    const aCount = adapter.prepare("SELECT count(*) as cnt FROM artifacts").get();

    const recentDecisions = adapter
      .prepare("SELECT id, decision, choice FROM decisions ORDER BY seq DESC LIMIT 5")
      .all() as Array<{ id: string; decision: string; choice: string }>;

    const recentRequirements = adapter
      .prepare("SELECT id, status, description FROM requirements ORDER BY id DESC LIMIT 5")
      .all() as Array<{ id: string; status: string; description: string }>;

    const data: InspectData = {
      schemaVersion,
      counts: {
        decisions: (dCount?.["cnt"] as number) ?? 0,
        requirements: (rCount?.["cnt"] as number) ?? 0,
        artifacts: (aCount?.["cnt"] as number) ?? 0,
      },
      recentDecisions,
      recentRequirements,
    };

    ctx.ui.notify(formatInspectOutput(data), "info");
  } catch (err) {
    process.stderr.write(`sdd-db: /sdd inspect failed: ${getErrorMessage(err)}\n`);
    ctx.ui.notify("Failed to inspect SDD database. Check stderr for details.", "error");
  }
}
