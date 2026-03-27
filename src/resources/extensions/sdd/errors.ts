/**
 * SDD Error Types — Typed error hierarchy for diagnostics and crash recovery.
 *
 * All SDD-specific errors extend SDDError, which carries a stable `code`
 * string suitable for programmatic matching. Error codes are defined as
 * constants so callers can switch on them without string-matching.
 */

// ─── Error Codes ──────────────────────────────────────────────────────────────

export const SDD_STALE_STATE = "SDD_STALE_STATE";
export const SDD_LOCK_HELD = "SDD_LOCK_HELD";
export const SDD_ARTIFACT_MISSING = "SDD_ARTIFACT_MISSING";
export const SDD_GIT_ERROR = "SDD_GIT_ERROR";
export const SDD_MERGE_CONFLICT = "SDD_MERGE_CONFLICT";
export const SDD_PARSE_ERROR = "SDD_PARSE_ERROR";
export const SDD_IO_ERROR = "SDD_IO_ERROR";

// ─── Base Error ───────────────────────────────────────────────────────────────

export class SDDError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SDDError";
    this.code = code;
  }
}
