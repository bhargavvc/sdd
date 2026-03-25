#!/usr/bin/env bash
# rename-to-sdd.sh — Rebrand SDD → SDD across the entire repo
# Run from repo root: bash scripts/rename-to-sdd.sh
#
# Safe to re-run after pulling upstream changes.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== SDD Rebrand Script ==="
echo "Working in: $REPO_ROOT"
echo ""

# ──────────────────────────────────────────────
# STEP 1: Rename files and directories (deepest first)
# ──────────────────────────────────────────────
echo "[1/4] Renaming files and directories..."

# Collect all paths with 'sdd' in their name (excluding .git)
# Process deepest paths first to avoid parent rename issues
find . -not -path './.git/*' -not -path './node_modules/*' -name '*gsd*' | sort -r | while read -r path; do
  dir=$(dirname "$path")
  base=$(basename "$path")
  newbase=$(echo "$base" | sed 's/sdd/sdd/g; s/GSD/SDD/g')
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

# File extensions to process
EXTENSIONS="ts tsx js jsx json md yml yaml sh ps1 toml rs css html mjs cjs"

for ext in $EXTENSIONS; do
  find . -not -path './.git/*' -not -path './node_modules/*' -name "*.$ext" -type f | while read -r file; do
    if grep -q -E 'gsd|GSD|Spec-Driven Development' "$file" 2>/dev/null; then
      # Order matters: longest matches first to avoid partial replacements
      sed -i \
        -e 's/Spec-Driven Development/Spec-Driven Development/g' \
        -e 's/Spec-Driven Development/Spec-Driven Development/g' \
        -e 's/bhargavvc\/sdd/bhargavvc\/sdd/g' \
        -e 's/bhargavvc/bhargavvc/g' \
        -e 's/sdd-pi/sdd-pi/g' \
        -e 's/sdd-cli/sdd-cli/g' \
        -e 's/sdd/sdd/g' \
        -e 's/SDD_VERSION/SDD_VERSION/g' \
        -e 's/SDD_LOGO/SDD_LOGO/g' \
        -e 's/SDD_/SDD_/g' \
        -e 's/"sdd"/"sdd"/g' \
        -e "s/'sdd'/'sdd'/g" \
        -e 's/\/gsd\//\/sdd\//g' \
        -e 's/sdd config/sdd config/g' \
        -e 's/sdd update/sdd update/g' \
        -e 's/sdd sessions/sdd sessions/g' \
        -e 's/sdd headless/sdd headless/g' \
        -e 's/sdd auto/sdd auto/g' \
        -e 's/sdd --web/sdd --web/g' \
        -e 's/Usage: sdd/Usage: sdd/g' \
        -e 's/sdd:/sdd:/g' \
        -e 's/\.gsd\//\.sdd\//g' \
        -e 's/\.sdd"/.sdd"/g' \
        -e "s/\.sdd'/.sdd'/g" \
        -e 's/@sdd/@sdd/g' \
        -e 's/SDD/SDD/g' \
        -e 's/SDD/SDD/g' \
        -e 's/ SDD / SDD /g' \
        -e 's/^GSD /SDD /g' \
        -e 's/ GSD$/ SDD/g' \
        -e 's/^GSD$/SDD/g' \
        -e 's/"SDD"/"SDD"/g' \
        -e "s/'SDD'/'SDD'/g" \
        "$file"
    fi
  done
done

# ──────────────────────────────────────────────
# STEP 3: Replace the ASCII logo
# ──────────────────────────────────────────────
echo ""
echo "[3/4] Replacing ASCII logo..."

# Find the logo file (may have been renamed to sdd already)
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
    -e 's/"name": "sdd-pi"/"name": "sdd-pi"/g' \
    -e 's/"sdd": "dist\/loader.js"/"sdd": "dist\/loader.js"/g' \
    -e 's/"sdd-cli": "dist\/loader.js"/"sdd-cli": "dist\/loader.js"/g' \
    -e 's/GSD — Spec-Driven Development coding agent/SDD — Spec-Driven Development coding agent/g' \
    -e 's|https://github.com/bhargavvc/sdd|https://github.com/bhargavvc/sdd|g' \
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
grep -rl 'gsd\|GSD' --include="*.ts" --include="*.js" --include="*.json" --include="*.md" . 2>/dev/null | grep -v '.git/' | grep -v 'node_modules/' | grep -v 'rename-to-sdd.sh' | head -20 || echo "  None found!"
echo ""
echo "Next steps:"
echo "  1. Review changes: git diff --stat"
echo "  2. Test build: npm install && npm run build"
echo "  3. Commit: git add -A && git commit -m 'rebrand: SDD → SDD (Spec-Driven Development)'"
echo "  4. Push: git push origin main"
