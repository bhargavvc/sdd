// Barrel export for old .planning migration module

export { handleMigrate } from './command.js';
export { parsePlanningDirectory } from './parser.js';
export { validatePlanningDirectory } from './validator.js';
export { transformToSDD } from './transformer.js';
export { writeSDDDirectory } from './writer.js';
export type { WrittenFiles, MigrationPreview } from './writer.js';
export { generatePreview } from './preview.js';
export type {
  // Input types (old .planning format)
  PlanningProject,
  PlanningPhase,
  PlanningPlan,
  PlanningPlanFrontmatter,
  PlanningPlanMustHaves,
  PlanningSummary,
  PlanningSummaryFrontmatter,
  PlanningSummaryRequires,
  PlanningRoadmap,
  PlanningRoadmapMilestone,
  PlanningRoadmapEntry,
  PlanningRequirement,
  PlanningResearch,
  PlanningConfig,
  PlanningQuickTask,
  PlanningMilestone,
  PlanningState,
  PlanningPhaseFile,
  ValidationResult,
  ValidationIssue,
  ValidationSeverity,
  // Output types (SDD format)
  SDDProject,
  SDDMilestone,
  SDDSlice,
  SDDTask,
  SDDRequirement,
  SDDSliceSummaryData,
  SDDTaskSummaryData,
  SDDBoundaryEntry,
} from './types.js';
