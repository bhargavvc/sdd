/**
 * /sdd migrate — one-shot migration from .planning to .sdd
 *
 * Thin UX orchestrator: resolves paths, runs the validate → parse → transform →
 * preview → write pipeline, and shows confirmation UI via showNextAction.
 * All business logic lives in the pipeline modules (S01–S03).
 *
 * After a successful write, offers an agent-driven review that audits the
 * output for SDD-2 standards compliance.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@sdd/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { sddRoot } from "../paths.js";
import { fileURLToPath } from "node:url";
import { showNextAction } from "../../shared/tui.js";
import {
  validatePlanningDirectory,
  parsePlanningDirectory,
  transformToSDD,
  generatePreview,
  writeSDDDirectory,
} from "./index.js";

import type { MigrationPreview } from "./writer.js";

/** Format preview stats for embedding in the review prompt. */
function formatPreviewStats(preview: MigrationPreview): string {
  const lines = [
    `- Milestones: ${preview.milestoneCount}`,
    `- Slices: ${preview.totalSlices} (${preview.doneSlices} done — ${preview.sliceCompletionPct}%)`,
    `- Tasks: ${preview.totalTasks} (${preview.doneTasks} done — ${preview.taskCompletionPct}%)`,
  ];
  if (preview.requirements.total > 0) {
    lines.push(
      `- Requirements: ${preview.requirements.total} (${preview.requirements.validated} validated, ${preview.requirements.active} active, ${preview.requirements.deferred} deferred)`,
    );
  }
  return lines.join("\n");
}

/** Load and interpolate the review-migration prompt template. */
function buildReviewPrompt(
  sourcePath: string,
  sddPath: string,
  preview: MigrationPreview,
): string {
  const promptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts");
  const templatePath = join(promptsDir, "review-migration.md");
  let content = readFileSync(templatePath, "utf-8");

  content = content.replaceAll("{{sourcePath}}", sourcePath);
  content = content.replaceAll("{{sddPath}}", sddPath);
  content = content.replaceAll("{{previewStats}}", formatPreviewStats(preview));

  return content.trim();
}

/** Dispatch the review prompt to the agent. */
function dispatchReview(
  pi: ExtensionAPI,
  sourcePath: string,
  sddPath: string,
  preview: MigrationPreview,
): void {
  const prompt = buildReviewPrompt(sourcePath, sddPath, preview);

  pi.sendMessage(
    {
      customType: "sdd-migrate-review",
      content: prompt,
      display: false,
    },
    { triggerTurn: true },
  );
}

export async function handleMigrate(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  // ── Resolve source path ────────────────────────────────────────────────────
  // Default to cwd when no args given; expand ~ to HOME
  let rawPath = args.trim() || ".";
  if (rawPath.startsWith("~/")) {
    rawPath = join(process.env.HOME ?? "~", rawPath.slice(2));
  } else if (rawPath === "~") {
    rawPath = process.env.HOME ?? "~";
  }

  let sourcePath = resolve(process.cwd(), rawPath);
  if (!sourcePath.endsWith(".planning")) {
    sourcePath = join(sourcePath, ".planning");
  }

  if (!existsSync(sourcePath)) {
    ctx.ui.notify(
      `Directory not found: ${sourcePath}\n\n` +
      'Migration converts a .planning/ directory (from older SDD versions) into .sdd/ format.\n' +
      'If you are starting a new project, use /sdd:new-project instead.\n' +
      'If migrating, ensure the path contains a .planning/ directory.',
      "error",
    );
    return;
  }

  // ── Validate ───────────────────────────────────────────────────────────────
  const validation = await validatePlanningDirectory(sourcePath);

  const warnings = validation.issues.filter((i) => i.severity === "warning");
  const fatals = validation.issues.filter((i) => i.severity === "fatal");

  for (const w of warnings) {
    ctx.ui.notify(`⚠ ${w.message} (${w.file})`, "warning");
  }
  for (const f of fatals) {
    ctx.ui.notify(`✖ ${f.message} (${f.file})`, "error");
  }

  if (!validation.valid) {
    ctx.ui.notify(
      "Migration blocked — fix the fatal issues above before retrying.",
      "error",
    );
    return;
  }

  // ── Parse → Transform → Preview ───────────────────────────────────────────
  const parsed = await parsePlanningDirectory(sourcePath);
  const project = transformToSDD(parsed);
  const preview = generatePreview(project);

  // ── Build preview text ─────────────────────────────────────────────────────
  const lines: string[] = [
    `Milestones: ${preview.milestoneCount}`,
    `Slices: ${preview.totalSlices} (${preview.doneSlices} done — ${preview.sliceCompletionPct}%)`,
    `Tasks: ${preview.totalTasks} (${preview.doneTasks} done — ${preview.taskCompletionPct}%)`,
  ];

  if (preview.requirements.total > 0) {
    lines.push(
      `Requirements: ${preview.requirements.total} (${preview.requirements.validated} validated, ${preview.requirements.active} active, ${preview.requirements.deferred} deferred)`,
    );
  }

  const targetSddExists = existsSync(sddRoot(process.cwd()));
  if (targetSddExists) {
    lines.push("");
    lines.push("⚠ A .sdd directory already exists in the current working directory — it will be overwritten.");
  }

  // ── Confirmation via showNextAction ────────────────────────────────────────
  const choice = await showNextAction(ctx, {
    title: "Migration preview",
    summary: lines,
    actions: [
      {
        id: "confirm",
        label: "Write .sdd directory",
        description: `Migrate ${preview.milestoneCount} milestone(s) to ${process.cwd()}/.sdd`,
        recommended: true,
      },
      {
        id: "cancel",
        label: "Cancel",
        description: "Exit without writing anything",
      },
    ],
    notYetMessage: "Run /sdd migrate again when ready.",
  });

  if (choice !== "confirm") {
    ctx.ui.notify("Migration cancelled — no files were written.", "info");
    return;
  }

  // ── Write ──────────────────────────────────────────────────────────────────
  ctx.ui.notify("Writing .sdd directory…", "info");

  const result = await writeSDDDirectory(project, process.cwd());
  const sddPath = sddRoot(process.cwd());

  ctx.ui.notify(
    `✓ Migration complete — ${result.paths.length} file(s) written to .sdd/`,
    "info",
  );

  // ── Post-write review offer ────────────────────────────────────────────────
  const reviewChoice = await showNextAction(ctx, {
    title: "Migration written",
    summary: [
      `${result.paths.length} files written to .sdd/`,
      "",
      "The agent can now review the migrated output against SDD-2 standards —",
      "checking structure, content quality, deriveState() round-trip, and",
      "requirement statuses. It will fix minor issues in-place.",
    ],
    actions: [
      {
        id: "review",
        label: "Review migration",
        description: "Agent audits the .sdd output and reports PASS/FAIL per category",
        recommended: true,
      },
      {
        id: "skip",
        label: "Skip review",
        description: "Trust the migration output as-is",
      },
    ],
    notYetMessage: "Run /sdd migrate again to re-migrate, or review .sdd manually.",
  });

  if (reviewChoice === "review") {
    dispatchReview(pi, sourcePath, sddPath, preview);
  }
}
