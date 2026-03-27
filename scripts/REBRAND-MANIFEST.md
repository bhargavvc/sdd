# Rebrand Manifest — GSD → SDD

> **Purpose:** Index of all rebrand-related patterns, known exceptions, and affected areas.
> Referenced by `scripts/rebrand-gsd-to-sdd.sh` during upstream syncs.

## Replacement Patterns

### 1. File/Directory Renames
| Pattern | Replacement | Example |
|---------|-------------|---------|
| `*gsd*` in filename | `*sdd*` | `gsd-db.ts` → `sdd-db.ts` |
| `*GSD*` in filename | `*SDD*` | `GSD-WORKFLOW.md` → `SDD-WORKFLOW.md` |
| `gsd/` directory | `sdd/` directory | `extensions/gsd/` → `extensions/sdd/` |
| `gsd-parser/` | `sdd-parser/` | Rust native parser directory |

### 2. Content Replacements (ordered by specificity)

#### Branding
| Old | New |
|-----|-----|
| `Get Shit Done` | `Spec-Driven Development` |
| `Get Stuff Done` | `Spec-Driven Development` |

#### Package Names & Paths
| Old | New | Notes |
|-----|-----|-------|
| `gsd-pi` | `sdd-pi` | npm package name |
| `gsd-cli` | `sdd-cli` | CLI binary name |
| `@gsd/` | `@sdd/` | Workspace package scope |
| `"gsd"` / `'gsd'` | `"sdd"` / `'sdd'` | Quoted identifiers |
| `.gsd/` | `.sdd/` | Project state directory |
| `/gsd/` | `/sdd/` | Path segments |

#### Variable Names (camelCase)
| Old | New | Notes |
|-----|-----|-------|
| `gsdDir` | `sddDir` | Directory path variables |
| `gsdRoot` | `sddRoot` | Root path variables |
| `gsdVersion` | `sddVersion` | Version variables |
| `gsdBin` | `sddBin` | Binary path variables |
| `gsdPath` | `sddPath` | Generic path variables |
| `gsdState` | `sddState` | State variables |
| `gsdNodeModules` | `sddNodeModules` | Node modules path |
| `gsdExtensionPath` | `sddExtensionPath` | Extension path helper |
| `gsdScopeDir` | `sddScopeDir` | Scope directory |
| `bootstrapGsd*` | `bootstrapSdd*` | Bootstrap functions |
| `syncGsd*` | `syncSdd*` | Sync functions |
| `getBundledGsd*` | `getBundledSdd*` | Version functions |
| `getGsdHome` | `getSddHome` | Home directory function |
| `resolveGsdRootFile` | `resolveSddRootFile` | File resolution |
| `relGsdRootFile` | `relSddRootFile` | Relative path helper |
| `inlineGsdRootFile` | `inlineSddRootFile` | Inline file helper |
| `runGSDDoctor` | `runSDDDoctor` | Doctor function |
| `loadEffectiveGSD*` | `loadEffectiveSDD*` | Preferences loader |

#### Uppercase Constants
| Old | New |
|-----|-----|
| `GSD_VERSION` | `SDD_VERSION` |
| `GSD_LOGO` | `SDD_LOGO` |
| `GSD_` prefix | `SDD_` prefix |
| `"GSD"` / `'GSD'` | `"SDD"` / `'SDD'` |

#### Type Names (PascalCase)
| Old | New |
|-----|-----|
| `GSDPreferences` | `SDDPreferences` |
| `GSDState` | `SDDState` |

### 3. Exceptions — DO NOT Replace
| Pattern | Reason |
|---------|--------|
| `@gsd-build/*` | Upstream npm package scope (native engine binaries) |
| `gsd-build/gsd-2` | Upstream GitHub repo URL (issues, PRs) |
| `@gsd-build/engine-*` | Native addon packages in optionalDependencies |
| `@gsd-build/mcp-server` | Upstream MCP server package |
| `@gsd-build/rpc-client` | Upstream RPC client package |

## Known Trouble Spots After Upstream Sync

### Files That Always Get New GSD References
These areas get the most new upstream code with GSD references:

1. **`src/resources/extensions/sdd/`** — Main extension code (80% of changes)
2. **`src/resources/extensions/sdd/tests/`** — Test files with GSD function imports
3. **`src/cli.ts`** / **`src/loader.ts`** — CLI entry points
4. **`src/headless*.ts`** — Headless mode files
5. **`web/components/sdd/`** — Web UI components
6. **`web/lib/`** — Web utilities
7. **`packages/mcp-server/`** — MCP server (mostly @gsd-build refs — expected)
8. **`packages/rpc-client/`** — RPC client (mostly @gsd-build refs — expected)

### Common Failure Patterns in CI
| Error | Cause | Fix |
|-------|-------|-----|
| `has no exported member 'loadEffectiveGSDPreferences'` | Function renamed in source but not in imports | Rebrand missed a camelCase pattern |
| `Cannot find module '.../extensions/gsd/...'` | Test imports old `gsd/` path | Directory rename not reflected in test |
| `Property 'syncGsdStateToWorktree' does not exist` | camelCase function not renamed | Add pattern to camelCase replacements |
| `core extension 'gsd' is discoverable` | Test assertion checks old name | Catch-all `\bgsd\b` → `sdd` needed |

## Upstream Sync Workflow (Quick Reference)

```bash
# 1. Fetch + merge upstream into clean branch
git fetch upstream && git checkout upstream-sync && git merge upstream/main

# 2. Merge into main (accept upstream on conflicts)
git checkout main && git merge -X theirs upstream-sync

# 3. Resolve remaining conflicts
#    - Delete files removed by upstream: git rm <file>
#    - For file location conflicts: git checkout --theirs <file> && git add <file>

# 4. Run rebrand script
bash scripts/rebrand-gsd-to-sdd.sh

# 5. Verify
npm install && npm run build
npx tsc --noEmit --project tsconfig.extensions.json

# 6. Commit and push
git add -A && git commit -m "sync: merge upstream gsd-2 vX.Y.Z + rebrand"
git push origin main
```
