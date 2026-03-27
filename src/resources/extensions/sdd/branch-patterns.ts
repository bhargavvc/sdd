/**
 * SDD branch naming patterns — single source of truth.
 *
 * sdd/<worktree>/<milestone>/<slice>  → SLICE_BRANCH_RE
 * sdd/quick/<id>-<slug>               → QUICK_BRANCH_RE
 * sdd/<workflow>/<...>                 → WORKFLOW_BRANCH_RE (non-milestone sdd/ branches)
 */

/** Matches sdd/ slice branches: sdd/[worktree/]M001[-hash]/S01 */
export const SLICE_BRANCH_RE = /^sdd\/(?:([a-zA-Z0-9_-]+)\/)?(M\d+(?:-[a-z0-9]{6})?)\/(S\d+)$/;

/** Matches sdd/quick/ task branches */
export const QUICK_BRANCH_RE = /^sdd\/quick\//;

/** Matches sdd/ workflow branches (non-milestone, e.g. sdd/workflow-name/...) */
export const WORKFLOW_BRANCH_RE = /^sdd\/(?!M\d)[\w-]+\//;
