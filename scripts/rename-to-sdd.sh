#!/usr/bin/env bash
# rename-to-sdd.sh — Rebrand SDD → SDD across the entire repo
# Run from repo root: bash scripts/rename-to-sdd.sh
#
# Safe to re-run after pulling upstream changes.
# Uses hex encoding (\x67\x73\x64 = sdd) to prevent self-modification.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Hex-encoded source strings to prevent this script from modifying itself
FROM_LOWER=$(printf '\x67\x73\x64')        # sdd
FROM_UPPER=$(printf '\x47\x53\x44')        # SDD
FROM_LONG=$(printf '\x47\x65\x74\x20\x53\x68\x69\x74\x20\x44\x6f\x6e\x65')  # Spec-Driven Development
FROM_LONG2=$(printf '\x47\x65\x74\x20\x53\x74\x75\x66\x66\x20\x44\x6f\x6e\x65')  # Spec-Driven Development
FROM_PI=$(printf '\x67\x73\x64\x2d\x70\x69')    # sdd-pi
FROM_CLI=$(printf '\x67\x73\x64\x2d\x63\x6c\x69') # sdd-cli
FROM_BUILD=$(printf '\x67\x73\x64\x2d\x62\x75\x69\x6c\x64')  # bhargavvc
FROM_ORG_REPO=$(printf '\x67\x73\x64\x2d\x62\x75\x69\x6c\x64\x2f\x67\x73\x64\x2d\x32')  # bhargavvc/sdd

echo "=== SDD Rebrand Script ==="
echo "Working in: $REPO_ROOT"
echo ""

# ──────────────────────────────────────────────
# STEP 1: Rename files and directories (deepest first)
# ──────────────────────────────────────────────
echo "[1/4] Renaming files and directories..."

find . -not -path './.git/*' -not -path './node_modules/*' \
    -not -name 'rename-to-sdd.sh' \
    -not -name 'rebrand-sdd-to-sdd.sh' \
    -name "*${FROM_LOWER}*" | sort -r | while read -r path; do
  dir=$(dirname "$path")
  base=$(basename "$path")
  newbase=$(echo "$base" | sed "s/${FROM_LOWER}/sdd/g; s/${FROM_UPPER}/SDD/g")
  if [ "$base" != "$newbase" ]; then
    echo "  Rename: $path → $dir/$newbase"
    mv "$path" "$dir/$newbase"
  fi
done

# ──────────────────────────────────────────────
# STEP 2: Replace content inside files
# ──────────────────────────────────────────────
echo ""
echo "[2/4] Replacing content in files..."

EXTENSIONS="ts tsx js jsx json md yml yaml sh ps1 toml rs css html mjs cjs"

for ext in $EXTENSIONS; do
  find . -not -path './.git/*' -not -path './node_modules/*' -name "*.$ext" -type f | while read -r file; do
    if grep -q -E "${FROM_LOWER}|${FROM_UPPER}" "$file" 2>/dev/null; then
      sed -i \
        -e "s|${FROM_LONG}|Spec-Driven Development|g" \
        -e "s|${FROM_LONG2}|Spec-Driven Development|g" \
        -e "s|${FROM_ORG_REPO}|bhargavvc/sdd|g" \
        -e "s|${FROM_BUILD}|bhargavvc|g" \
        -e "s|${FROM_PI}|sdd-pi|g" \
        -e "s|${FROM_CLI}|sdd-cli|g" \
        -e "s|${FROM_UPPER}_VERSION|SDD_VERSION|g" \
        -e "s|${FROM_UPPER}_LOGO|SDD_LOGO|g" \
        -e "s|${FROM_UPPER}_|SDD_|g" \
        -e "s|\"${FROM_LOWER}\"|\"sdd\"|g" \
        -e "s|'${FROM_LOWER}'|'sdd'|g" \
        -e "s|/${FROM_LOWER}/|/sdd/|g" \
        -e "s|\.${FROM_LOWER}/|.sdd/|g" \
        -e "s|\.${FROM_LOWER}\"|.sdd\"|g" \
        -e "s|\.${FROM_LOWER}'|.sdd'|g" \
        -e "s|@${FROM_LOWER}|@sdd|g" \
        -e "s|${FROM_UPPER}|SDD|g" \
        -e "s|${FROM_LOWER}|sdd|g" \
        "$file"
    fi
  done
done

# ──────────────────────────────────────────────
# STEP 3: Replace the ASCII logo
# ──────────────────────────────────────────────
echo ""
echo "[3/4] Replacing ASCII logo..."

LOGO_FILE=""
if [ -f "src/logo.ts" ]; then
  LOGO_FILE="src/logo.ts"
fi

if [ -n "$LOGO_FILE" ]; then
  cat > "$LOGO_FILE" << 'LOGOEOF'
/**
 * Shared SDD block-letter ASCII logo.
 *
 * Single source of truth — imported by:
 *   - scripts/postinstall.js (via dist/logo.js)
 *   - src/loader.ts (via ./logo.js)
 */

/** Raw logo lines — no ANSI codes, no leading newline. */
export const SDD_LOGO: readonly string[] = [
  '  ███████╗██████╗ ██████╗ ',
  '  ██╔════╝██╔══██╗██╔══██╗',
  '  ███████╗██║  ██║██║  ██║',
  '  ╚════██║██║  ██║██║  ██║',
  '  ███████║██████╔╝██████╔╝',
  '  ╚══════╝╚═════╝ ╚═════╝ ',
]

/**
 * Render the logo block with a color function applied to each line.
 *
 * @param color — e.g. `(s) => `\x1b[36m${s}\x1b[0m`` or picocolors.cyan
 * @returns Ready-to-write string with leading/trailing newlines.
 */
export function renderLogo(color: (s: string) => string): string {
  return '\n' + SDD_LOGO.map(color).join('\n') + '\n'
}
LOGOEOF
  echo "  Logo replaced with SDD block letters"
fi

# ──────────────────────────────────────────────
# STEP 4: Update package.json specifics
# ──────────────────────────────────────────────
echo ""
echo "[4/4] Updating package.json..."

if [ -f "package.json" ]; then
  sed -i \
    -e "s/\"name\": \"${FROM_PI}\"/\"name\": \"sdd-pi\"/g" \
    -e "s/\"${FROM_LOWER}\": \"dist\/loader.js\"/\"sdd\": \"dist\/loader.js\"/g" \
    -e "s/\"${FROM_CLI}\": \"dist\/loader.js\"/\"sdd-cli\": \"dist\/loader.js\"/g" \
    -e "s/${FROM_UPPER} — Spec-Driven Development coding agent/SDD — Spec-Driven Development coding agent/g" \
    -e "s|https://github.com/${FROM_BUILD}/sdd-2|https://github.com/bhargavvc/sdd|g" \
    package.json
  echo "  package.json updated"
fi

# ──────────────────────────────────────────────
# SUMMARY
# ──────────────────────────────────────────────
echo ""
echo "=== Rebrand Complete ==="
echo ""
echo "Remaining SDD references (if any):"
grep -rl "${FROM_LOWER}\|${FROM_UPPER}" --include="*.ts" --include="*.js" --include="*.json" --include="*.md" . 2>/dev/null \
  | grep -v '.git/' | grep -v 'node_modules/' | grep -v 'rename-to-sdd.sh' | head -20 || echo "  None found!"
echo ""
echo "Next steps:"
echo "  1. Review changes: git diff --stat"
echo "  2. Test build: npm install && npm run build"
echo "  3. Commit: git add -A && git commit -m 'sync: upstream v2.59.1 + rebrand SDD→SDD'"
echo "  4. Push: git push origin main upstream-sync"
