# Rebrand Manifest — SDD → SDD

> **Purpose:** Single source of truth for the SDD→SDD rebrand during upstream syncs.
> Read this BEFORE starting any upstream sync. Updated after every sync session.
>
> **Last updated:** 2026-03-28 (v2.54.0 sync — 309 commits, 5 fix iterations)
> **Referenced by:** `scripts/rebrand-sdd-to-sdd.sh`

---

## Quick Upstream Sync Checklist

```bash
# 1. Fetch + merge upstream into clean branch
git fetch upstream
git checkout upstream-sync
git merge upstream/main          # Always fast-forward

# 2. Merge into main (accept upstream on conflicts)
git checkout main
git merge -X theirs upstream-sync

# 3. Resolve conflicts (see "Conflict Resolution" section below)

# 4. Run rebrand script
bash scripts/rebrand-sdd-to-sdd.sh

# 5. MANUAL FIXES — script doesn't catch everything (see section below)

# 6. Verify
npm install
npm run build
npx tsc --noEmit --project tsconfig.extensions.json   # THIS IS WHAT CI RUNS

# 7. Commit and push
git add -A && git commit -m "sync: merge upstream sdd-2 vX.Y.Z + rebrand"
git push origin main

# 8. Monitor CI
gh run list --repo bhargavvc/sdd --limit 3
gh run view <RUN_ID> --repo bhargavvc/sdd
```

---

## Conflict Resolution Guide

### Conflict Types (from 2026-03-28 sync)

| Type | Example | How to Resolve |
|------|---------|----------------|
| **modify/delete** | `docker/docker-compose.yml` deleted upstream, modified in ours | `git rm <file>` — accept upstream's deletion |
| **file location** | New file added in `extensions/sdd/` but we have `extensions/sdd/` | `git checkout --theirs <file> && git add <file>` |
| **rename/rename** | `preferences.md` renamed to `PREFERENCES.md` upstream | `git show :3:<path> > <dest> && git add <dest>` |
| **rename/delete** | `auto-worktree-sync.ts` renamed by us, deleted upstream | `git rm <file>` |

### Step-by-step for conflicts

```bash
# List all conflicted files
git diff --name-only --diff-filter=U

# For files deleted by upstream:
git rm <file>

# For file location conflicts (most common):
git diff --name-only --diff-filter=U | while read f; do
  git checkout --theirs "$f" 2>/dev/null && git add "$f"
done

# For any that fail --theirs (no stage 3):
git ls-files -u <file>
# If only stages 1 and 2 → upstream deleted it → git rm <file>
# If stage 3 exists → git show <hash> > <file> && git add <file>
```

---

## What the Rebrand Script Does

The script (`scripts/rebrand-sdd-to-sdd.sh`) handles:

1. **File/directory renames** — `*sdd*` → `*sdd*`, `*SDD*` → `*SDD*`
2. **Content replacement** — compound terms first, then catch-all `\bsdd\b` → `sdd`
3. **camelCase variables** — `sddDir` → `sddDir`, `bootstrapGsd` → `bootstrapSdd`, etc.
4. **Branding text** — "Spec-Driven Development" / "Spec-Driven Development" → "Spec-Driven Development"
5. **Logo** — Rewrites `src/logo.ts` with SDD block letters
6. **@bhargavvc restore** — Undoes accidental replacement of upstream npm scope

### Anti-self-modification trick
The script uses `printf '\x67\x73\x64'` to construct "sdd" at runtime, so its own sed commands can never modify the script itself.

---

## What the Script MISSES (Manual Fixes Required)

These were discovered during the 2026-03-28 sync after 5 CI iterations:

### 1. Web components (`web/`) — PascalCase class names
The script only processes `src/` for camelCase. Web files have their own patterns.

**Files affected:**
- `web/lib/sdd-workspace-store.tsx` — `SDDWorkspaceStore`, `SDDWorkspaceProvider`, `useSDDWorkspaceState`, `useSDDWorkspaceActions`
- `web/lib/initial-sdd-header-filter.ts` — `filterInitialGsdHeader`, `InitialGsdHeaderFilterResult`, `TITLE_PATTERN`
- `web/components/sdd/app-shell.tsx` — `SDDAppShell`
- `web/components/sdd/shell-terminal.tsx` — `hideInitialGsdHeader`
- `web/components/sdd/dual-terminal.tsx` — `hideInitialGsdHeader`
- `web/components/sdd/chat-mode.tsx` — `SDDActionDef`
- `web/components/sdd/files-view.tsx` — `sddTree`, `sddExpanded`, `getGsdRoot`
- `web/app/api/files/route.ts` — `getGsdRoot`
- `web/app/page.tsx` — `SDDAppShell`

**Fix:**
```bash
# After running the main script, do:
grep -rl 'SDD\|Gsd\|\bsdd\b' web/ --include="*.ts" --include="*.tsx" 2>/dev/null \
  | grep -v node_modules | while read -r f; do
    sed -i 's/SDD/SDD/g; s/Gsd/Sdd/g; s/\bsdd\b/sdd/g' "$f"
  done
```

### 2. Header filter title pattern
`web/lib/initial-sdd-header-filter.ts` line 9 has a regex:
```typescript
const TITLE_PATTERN = /Spec-Driven Development v\d+\.\d+\.\d+/i
```
Must be changed to:
```typescript
const TITLE_PATTERN = /Spec-Driven Development v\d+\.\d+\.\d+/i
```

### 3. Test logo pattern
`src/tests/initial-sdd-header-filter.test.ts` has a hardcoded SDD logo (block letters that spell G-S-D). Must be replaced with the SDD logo:
```typescript
const SDD_LOGO_LINES = [
  "  ███████╗██████╗ ██████╗ ",
  "  ██╔════╝██╔══██╗██╔══██╗",
  "  ███████╗██║  ██║██║  ██║",
  "  ╚════██║██║  ██║██║  ██║",
  "  ███████║██████╔╝██████╔╝",
  "  ╚══════╝╚═════╝ ╚═════╝ ",
]
```

### 4. Dockerfile
`docker/Dockerfile.sandbox` has `sdd-pi` and `SDD_VERSION` — script doesn't always catch Docker files.

### 5. `packages/mcp-server/src/server.ts` — variable names
Has `sddDir` variable that points to `.sdd/` — the `Gsd` camelCase sweep only covers `src/`, not `packages/`.

---

## Complete Replacement Pattern Reference

### File/Directory Renames
| Pattern | Replacement | Example |
|---------|-------------|---------|
| `*sdd*` in filename | `*sdd*` | `sdd-db.ts` → `sdd-db.ts` |
| `*SDD*` in filename | `*SDD*` | `SDD-WORKFLOW.md` → `SDD-WORKFLOW.md` |
| `sdd/` directory | `sdd/` directory | `extensions/sdd/` → `extensions/sdd/` |
| `sdd-parser/` | `sdd-parser/` | Rust native parser directory |
| `sdd_parser.rs` | `sdd_parser.rs` | Rust source file |

### Branding Text
| Old | New |
|-----|-----|
| `Spec-Driven Development` | `Spec-Driven Development` |
| `Spec-Driven Development` | `Spec-Driven Development` |
| `get stuff done` | `spec-driven development` |

### Package Names & Paths
| Old | New | Notes |
|-----|-----|-------|
| `sdd-pi` | `sdd-pi` | npm package name |
| `sdd-cli` | `sdd-cli` | CLI binary name |
| `@sdd/` | `@sdd/` | Workspace package scope |
| `"sdd"` / `'sdd'` | `"sdd"` / `'sdd'` | Quoted identifiers |
| `.sdd/` | `.sdd/` | Project state directory |
| `/sdd/` | `/sdd/` | Path segments |
| `sdd:` | `sdd:` | Command prefixes |

### Variable Names — camelCase (`sdd*`)
| Old | New | Found In |
|-----|-----|----------|
| `sddDir` | `sddDir` | headless.ts, headless-context.ts, server.ts, tests |
| `sddRoot` | `sddRoot` | loader.ts |
| `sddVersion` | `sddVersion` | loader.ts |
| `sddBin` | `sddBin` | session-manager.ts |
| `sddPath` | `sddPath` | various |
| `sddState` | `sddState` | various |
| `sddNodeModules` | `sddNodeModules` | loader.ts |
| `sddExtensionPath` | `sddExtensionPath` | headless-query.ts |
| `sddScopeDir` | `sddScopeDir` | loader.ts |
| `sddHome` | `sddHome` | remote-questions/ |
| `sddTree` | `sddTree` | files-view.tsx |
| `sddExpanded` | `sddExpanded` | files-view.tsx |

### Function Names — PascalCase mid-word (`*Gsd*`)
| Old | New | Found In |
|-----|-----|----------|
| `bootstrapGsdProject` | `bootstrapSddProject` | headless-context.ts |
| `syncGsdStateToWorktree` | `syncSddStateToWorktree` | auto-worktree.ts, tests |
| `getBundledGsdVersion` | `getBundledSddVersion` | resource-loader.ts |
| `getGsdHome` | `getSddHome` | remote-questions/ |
| `getGsdRoot` | `getSddRoot` | web/app/api/files/route.ts |
| `resolveGsdRootFile` | `resolveSddRootFile` | auto-prompts.ts |
| `relGsdRootFile` | `relSddRootFile` | auto-prompts.ts |
| `inlineGsdRootFile` | `inlineSddRootFile` | auto/phases.ts |
| `filterInitialGsdHeader` | `filterInitialSddHeader` | web/lib/ |
| `hideInitialGsdHeader` | `hideInitialSddHeader` | shell-terminal.tsx |

### Function/Type Names — UPPERCASE (`*SDD*`)
| Old | New | Found In |
|-----|-----|----------|
| `runSDDDoctor` | `runSDDDoctor` | app-smoke.test.ts |
| `loadEffectiveSDDPreferences` | `loadEffectiveSDDPreferences` | preferences.ts, imports everywhere |
| `SDDPreferences` | `SDDPreferences` | preferences-types.ts |
| `SDDState` | `SDDState` | types.ts |
| `SDDWorkspaceStore` | `SDDWorkspaceStore` | sdd-workspace-store.tsx |
| `SDDWorkspaceProvider` | `SDDWorkspaceProvider` | sdd-workspace-store.tsx |
| `useSDDWorkspaceState` | `useSDDWorkspaceState` | sdd-workspace-store.tsx |
| `useSDDWorkspaceActions` | `useSDDWorkspaceActions` | sdd-workspace-store.tsx |
| `SDDAppShell` | `SDDAppShell` | app-shell.tsx |
| `SDDActionDef` | `SDDActionDef` | chat-mode.tsx |
| `InitialGsdHeaderFilterResult` | `InitialSddHeaderFilterResult` | initial-sdd-header-filter.ts |
| `SDD_VERSION` | `SDD_VERSION` | constants, Dockerfile |
| `SDD_LOGO` | `SDD_LOGO` | logo.ts |

### Uppercase Constants
| Old | New |
|-----|-----|
| `SDD_VERSION` | `SDD_VERSION` |
| `SDD_LOGO` | `SDD_LOGO` |
| `SDD_` prefix | `SDD_` prefix |
| `"SDD"` / `'SDD'` | `"SDD"` / `'SDD'` |

---

## Exceptions — DO NOT Replace

| Pattern | Reason | Where Found |
|---------|--------|-------------|
| `@bhargavvc/*` | Upstream npm package scope (native engine binaries) | package.json, imports |
| `bhargavvc/sdd` | Upstream GitHub repo URL (issues, PRs, changelog) | forensics.ts, loader.ts, changelog.ts |
| `@bhargavvc/engine-*` | Native addon packages in optionalDependencies | package.json |
| `@bhargavvc/mcp-server` | Upstream MCP server package | packages/mcp-server/package.json |
| `@bhargavvc/rpc-client` | Upstream RPC client package | packages/rpc-client/package.json |

**Important:** The rebrand script's `@bhargavvc` restore step MUST run after every replacement pass, or these get corrupted.

---

## Known CI Test Failures (NOT Rebrand Bugs)

These fail on CI regardless of rebrand and can be ignored:

| Test | Error | Reason |
|------|-------|--------|
| `showSecretsSummary: produces lines with correct status glyphs` | `Native function 'truncateToWidth' is not available on win32-x64` | Native Rust addon not installed in CI |
| `collectOneSecret: guidance lines appear in render output` | Same native function error | Same |
| `matches across multiple deltas (buffering)` | Native text processing unavailable | Same |
| `visualizer-views.test.ts` | Timeout (5207ms) | Heavy test, sometimes times out in CI |

---

## Mistakes Made During 2026-03-28 Sync (Lessons Learned)

### Mistake 1: Old rename script was self-rebranded
**What happened:** `scripts/rename-to-sdd.sh` had been run through a previous rebrand, turning all its `sed 's/sdd/sdd/g'` into `sed 's/sdd/sdd/g'` (no-ops).
**Impact:** Script did nothing when re-run.
**Fix:** Created new script using `printf '\x67\x73\x64'` hex encoding to construct "sdd" at runtime.
**Lesson:** NEVER include the rebrand script in its own replacement scope.

### Mistake 2: Script renamed itself
**What happened:** `find -name '*sdd*'` matched `rebrand-sdd-to-sdd.sh` and renamed it to `rebrand-sdd-to-sdd.sh`.
**Impact:** Script broke mid-execution.
**Fix:** Added `-not -name "$SELF_NAME"` to the find command.
**Lesson:** Always exclude self from file renames.

### Mistake 3: Per-extension find loop was too slow on OneDrive
**What happened:** First script version iterated `for ext in $EXTENSIONS; do find ... -name "*.$ext" ...` — ran for 10+ minutes on OneDrive and hung.
**Impact:** Had to kill the process.
**Fix:** Changed to `grep -rl` first (fast) → then `sed` on the result list.
**Lesson:** On OneDrive/cloud-synced repos, always grep-first-then-sed, never find-then-grep-then-sed per extension.

### Mistake 4: camelCase variables missed
**What happened:** `sddDir`, `sddRoot`, `sddVersion`, `bootstrapGsdProject`, `syncGsdStateToWorktree` etc. were NOT caught by the main `\bsdd\b` → `sdd` replacement because `\b` doesn't match at camelCase boundaries.
**Impact:** TypeScript build passed locally (compiled to JS which doesn't typecheck), but `typecheck:extensions` on CI caught the mismatches.
**Fix:** Added dedicated Step 2b with explicit camelCase patterns + PascalCase `Gsd` → `Sdd` replacement.
**Lesson:** `\bsdd\b` does NOT match inside camelCase. Need explicit patterns for every `sdd[A-Z]` and `[a-z]Gsd[A-Z]` combination.

### Mistake 5: `web/` directory not covered by camelCase sweep
**What happened:** Step 2b only grepped in `src/` but web components in `web/` had `SDDWorkspaceStore`, `SDDAppShell`, `useSDDWorkspaceState`, `filterInitialGsdHeader`, `hideInitialGsdHeader`, etc.
**Impact:** CI test failures — imported names didn't match exports.
**Fix:** Added `web/` to the camelCase sweep.
**Lesson:** ALWAYS process both `src/` AND `web/` for camelCase patterns.

### Mistake 6: Header filter regex and test logo not updated
**What happened:** `web/lib/initial-sdd-header-filter.ts` had `TITLE_PATTERN = /Spec-Driven Development v.../i` and the test had hardcoded SDD block-letter logo.
**Impact:** `filterInitialSddHeader` returned `needs-more` instead of `matched` because regex didn't match "Spec-Driven Development".
**Fix:** Updated regex to `/Spec-Driven Development v.../i` and test logo to SDD block letters.
**Lesson:** Hardcoded visual patterns (logos, regex) need manual verification — sed can't catch these.

### Mistake 7: `Gsd` → `Sdd` replacement broke `@bhargavvc` URLs
**What happened:** Blanket `sed 's/Gsd/Sdd/g'` also matched `bhargavvc/sdd` URLs, turning them into `bhargavvc/sdd-2`.
**Impact:** Forensics test expected `bhargavvc/sdd` but found `bhargavvc/sdd-2`.
**Fix:** Added restore step after Gsd sweep: `s/@sdd-build/@bhargavvc/g` etc.
**Lesson:** EVERY replacement pass must be followed by the @bhargavvc restore step.

### Mistake 8: Dockerfile not in standard extension list
**What happened:** The grep for content replacement only covers standard file extensions. Dockerfile has no extension.
**Impact:** `docker/Dockerfile.sandbox` kept `sdd-pi` and `SDD_VERSION`.
**Fix:** Added explicit Dockerfile check.
**Lesson:** Add `--include="Dockerfile*"` or explicit Dockerfile processing.

### Mistake 9: `sdd-2` in URLs got rebranded to `sdd-2`
**What happened:** `\bsdd\b → sdd` also matched `sdd-2` in `bhargavvc/sdd` URLs, making `bhargavvc/sdd-2`.
**Impact:** `forensics-issue-routing.test.ts` regex expected `bhargavvc/sdd` but found `bhargavvc/sdd-2`.
**Fix:** Manually fixed the regex. Also, the @bhargavvc restore step needs to also restore `bhargavvc/sdd`.
**Lesson:** The restore step must cover BOTH `@bhargavvc` scope AND `bhargavvc/sdd` repo URLs. Check: `grep -rn 'bhargavvc/sdd' src/ --include="*.ts"` after every sync.

### Mistake 10: Alphabetical sort order changed (sdd → sdd)
**What happened:** `web-command-parity-contract.test.ts` expected `["exit", "sdd", "kill", ...]` but `sdd` sorts after `kill` alphabetically (unlike `sdd` which sorted before `kill`).
**Impact:** `deepStrictEqual` failed because array order differed.
**Fix:** Updated expected array to match new alphabetical order: `["exit", "kill", "sdd", "worktree", "wt"]`.
**Lesson:** After rename, check any test that asserts on sorted arrays of command names.

### Mistake 11: TTSR rule-loader had `sddHome` variable
**What happened:** `src/resources/extensions/ttsr/rule-loader.ts` had `const sddHome = ...` — missed because the camelCase sweep only covered `src/resources/extensions/sdd/` patterns.
**Fix:** Added to the manual fix list.
**Lesson:** Extensions outside `sdd/` directory (like `ttsr/`, `remote-questions/`) also have sdd variables.

---

## Pre-existing CI Failures (NOT Rebrand Bugs)

| Test | Error | Root Cause |
|------|-------|------------|
| `showSecretsSummary` | `Native function 'truncateToWidth' not available on win32-x64` | Native Rust addon not installed in CI |
| `collectOneSecret` | Same native function error | Same |
| `matches across multiple deltas (buffering)` | `0 !== 1` | TTSR JS fallback has 50ms throttle; test sends 3 synchronous deltas (0ms apart) → throttled |
| `buffers are isolated by stream key` | `0 !== 1` | Same TTSR throttle issue |
| `visualizer-views.test.ts` | Timeout (5207ms) | Heavy test, sometimes times out in CI |

---

## Files That Are ALWAYS Safe to Ignore

| File/Path | Why |
|-----------|-----|
| `package-lock.json` | Auto-regenerated on `npm install` |
| `scripts/rebrand-sdd-to-sdd.sh` | Self — must not be modified |
| `scripts/rename-to-sdd.sh` | Old broken script — kept for reference |
| `packages/mcp-server/` | Mostly `@bhargavvc` refs — correct |
| `packages/rpc-client/` | Mostly `@bhargavvc` refs — correct |
| `native/npm/*/package.json` | `@bhargavvc/engine-*` — correct |

---

## Verification Checklist (Run After Every Sync)

```bash
# 1. Build passes
npm run build

# 2. Extension typecheck passes (THIS IS WHAT CI CHECKS)
npx tsc --noEmit --project tsconfig.extensions.json

# 3. No SDD in source (except @bhargavvc)
grep -rn '\bSDD\b\|\bsdd\b' src/ web/ --include="*.ts" --include="*.tsx" \
  | grep -v '@bhargavvc' | grep -v 'bhargavvc/' | grep -v node_modules \
  | head -20

# 4. Check camelCase remnants
grep -rn 'sdd[A-Z]\|[a-z]Gsd[A-Z]' src/ web/ --include="*.ts" --include="*.tsx" \
  | grep -v node_modules | head -20

# 5. Check package names
grep '"name"' package.json packages/*/package.json

# 6. Check branding
grep -rn 'Spec-Driven Development\|Spec-Driven Development' src/ web/ --include="*.ts" --include="*.tsx" \
  | head -5
```
