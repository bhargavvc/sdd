#!/usr/bin/env bash
##############################################################################
# rebrand-sdd-to-sdd.sh
#
# Converts all G.S.D references to S.D.D after an upstream sync.
# IDEMPOTENT — safe to re-run. Excludes itself from modification.
#
# USAGE:  bash scripts/rebrand-sdd-to-sdd.sh
# RUN AFTER:  git merge upstream-sync  (into main)
# MANIFEST:  scripts/REBRAND-MANIFEST.md — lists all patterns, exceptions, trouble spots
##############################################################################

set -eu
# Note: pipefail removed intentionally — grep returns 1 for "no matches"
# which is normal/expected when patterns are already replaced.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Build literal strings to avoid self-modification by sed
OLD_LC=$(printf '\x67\x73\x64')       # g-s-d
OLD_UC=$(printf '\x47\x53\x44')       # G-S-D
NEW_LC="sdd"
NEW_UC="SDD"

SELF_NAME="rebrand-$(echo "${OLD_LC}")-to-${NEW_LC}.sh"
OLD_SCRIPT="rename-to-${NEW_LC}.sh"

echo "=== ${NEW_UC} Rebrand Script ==="
echo "Working in: $REPO_ROOT"

# ─── STEP 1: Rename files ────────────────────────────────────────────────────
echo ""
echo "[1/4] Renaming files..."

find . -not -path './.git/*' -not -path './node_modules/*' \
  -not -name "$SELF_NAME" \
  \( -name "*${OLD_LC}*" -o -name "*${OLD_UC}*" \) \
  -type f 2>/dev/null | sort -r | while read -r path; do
  dir=$(dirname "$path")
  base=$(basename "$path")
  newbase=$(echo "$base" | sed "s/${OLD_LC}/${NEW_LC}/g; s/${OLD_UC}/${NEW_UC}/g")
  [ "$base" = "$newbase" ] && continue
  echo "  $path -> $dir/$newbase"
  mv "$path" "$dir/$newbase"
done

echo "  Renaming directories..."
find . -not -path './.git/*' -not -path './node_modules/*' \
  \( -name "*${OLD_LC}*" -o -name "*${OLD_UC}*" \) \
  -type d 2>/dev/null | sort -r | while read -r path; do
  dir=$(dirname "$path")
  base=$(basename "$path")
  newbase=$(echo "$base" | sed "s/${OLD_LC}/${NEW_LC}/g; s/${OLD_UC}/${NEW_UC}/g")
  [ "$base" = "$newbase" ] && continue
  echo "  $path -> $dir/$newbase"
  mv "$path" "$dir/$newbase"
done
echo "  Done."

# ─── STEP 2: Replace content ─────────────────────────────────────────────────
echo ""
echo "[2/4] Finding files with content to replace..."

grep -rl --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --include="*.json" --include="*.md" --include="*.yml" --include="*.yaml" \
  --include="*.sh" --include="*.ps1" --include="*.toml" --include="*.rs" \
  --include="*.css" --include="*.html" --include="*.mjs" --include="*.cjs" \
  -E "${OLD_LC}|${OLD_UC}" . 2>/dev/null \
  | grep -v '\.git/' | grep -v 'node_modules/' \
  | grep -v "$SELF_NAME" | grep -v "$OLD_SCRIPT" \
  | grep -v 'package-lock.json' \
  > /tmp/${NEW_LC}-rebrand-files.txt || true

FCOUNT=$(wc -l < /tmp/${NEW_LC}-rebrand-files.txt)
echo "  Found $FCOUNT files."

echo "  Replacing..."
while IFS= read -r file; do
  [ -z "$file" ] && continue

  # Targeted replacements first (compound terms)
  sed -i \
    -e "s/Spec-Driven Development/Spec-Driven Development/g" \
    -e "s/get stuff done/spec-driven development/g" \
    -e "s/${OLD_LC}-pi/${NEW_LC}-pi/g" \
    -e "s/${OLD_LC}-cli/${NEW_LC}-cli/g" \
    -e "s/${OLD_LC}-headless/${NEW_LC}-headless/g" \
    -e "s/${OLD_LC}-db/${NEW_LC}-db/g" \
    -e "s/${OLD_LC}-web/${NEW_LC}-web/g" \
    -e "s/${OLD_LC}-workspace/${NEW_LC}-workspace/g" \
    -e "s/${OLD_LC}-skill/${NEW_LC}-skill/g" \
    -e "s/${OLD_LC}-orchestrator/${NEW_LC}-orchestrator/g" \
    -e "s/${OLD_LC}_parser/${NEW_LC}_parser/g" \
    -e "s/${OLD_LC}_version/${NEW_LC}_version/g" \
    -e "s/${OLD_LC} config/${NEW_LC} config/g" \
    -e "s/${OLD_LC} update/${NEW_LC} update/g" \
    -e "s/${OLD_LC} sessions/${NEW_LC} sessions/g" \
    -e "s/${OLD_LC} headless/${NEW_LC} headless/g" \
    -e "s/${OLD_LC} auto/${NEW_LC} auto/g" \
    -e "s/${OLD_LC} --web/${NEW_LC} --web/g" \
    -e "s/Usage: ${OLD_LC}/Usage: ${NEW_LC}/g" \
    -e "s/${OLD_LC}:/${NEW_LC}:/g" \
    -e "s/\/${OLD_LC}\//\/${NEW_LC}\//g" \
    -e "s/\.${OLD_LC}\//\.${NEW_LC}\//g" \
    -e "s/\.${OLD_LC}\"/.${NEW_LC}\"/g" \
    -e "s/\.${OLD_LC}'/.${NEW_LC}'/g" \
    -e "s/\"${OLD_LC}\"/\"${NEW_LC}\"/g" \
    -e "s/'${OLD_LC}'/'${NEW_LC}'/g" \
    -e "s/@${OLD_LC}\//@${NEW_LC}\//g" \
    -e "s/${OLD_UC}_VERSION/${NEW_UC}_VERSION/g" \
    -e "s/${OLD_UC}_LOGO/${NEW_UC}_LOGO/g" \
    -e "s/${OLD_UC}_/${NEW_UC}_/g" \
    -e "s/\"${OLD_UC}\"/\"${NEW_UC}\"/g" \
    -e "s/'${OLD_UC}'/'${NEW_UC}'/g" \
    "$file"

  # Catch-all: remaining standalone instances
  sed -i \
    -e "s/\b${OLD_LC}\b/${NEW_LC}/g" \
    -e "s/\b${OLD_UC}\b/${NEW_UC}/g" \
    -e "s/${OLD_LC}\./${NEW_LC}\./g" \
    -e "s/${OLD_LC}-/${NEW_LC}-/g" \
    -e "s/_${OLD_LC}/_${NEW_LC}/g" \
    -e "s/${OLD_LC}_/${NEW_LC}_/g" \
    -e "s/\/${OLD_LC}/\/${NEW_LC}/g" \
    "$file"

  # Restore @bhargavvc (upstream npm scope — must stay)
  if grep -q "${NEW_LC}-build" "$file" 2>/dev/null; then
    sed -i \
      -e "s/@${NEW_LC}-build/@${OLD_LC}-build/g" \
      -e "s/${NEW_LC}-build\/engine/${OLD_LC}-build\/engine/g" \
      -e "s/${NEW_LC}-build\/${OLD_LC}/${OLD_LC}-build\/${OLD_LC}/g" \
      "$file"
  fi
done < /tmp/${NEW_LC}-rebrand-files.txt

rm -f /tmp/${NEW_LC}-rebrand-files.txt
echo "  Done."

# ─── STEP 2b: Fix camelCase variables and branding ────────────────────────────
echo ""
echo "[2b/4] Fixing camelCase variables and branding..."

# Fix camelCase: sddDir→sddDir, sddRoot→sddRoot, etc.
# See REBRAND-MANIFEST.md for full pattern list
OLD_CC=$(printf '\x47\x73\x64')   # G-s-d (PascalCase mid-word)
NEW_CC="Sdd"
{ grep -rl "${OLD_LC}[A-Z]\|${OLD_CC}" src/ --include="*.ts" 2>/dev/null || true; } | grep -v node_modules | while read -r f; do
  sed -i \
    -e "s/${OLD_LC}Dir/${NEW_LC}Dir/g" \
    -e "s/${OLD_LC}Root/${NEW_LC}Root/g" \
    -e "s/${OLD_LC}ExtensionPath/${NEW_LC}ExtensionPath/g" \
    -e "s/${OLD_LC}ScopeDir/${NEW_LC}ScopeDir/g" \
    -e "s/${OLD_LC}NodeModules/${NEW_LC}NodeModules/g" \
    -e "s/${OLD_LC}Version/${NEW_LC}Version/g" \
    -e "s/${OLD_LC}Bin/${NEW_LC}Bin/g" \
    -e "s/${OLD_LC}Path/${NEW_LC}Path/g" \
    -e "s/${OLD_LC}State/${NEW_LC}State/g" \
    -e "s/${OLD_LC}Home/${NEW_LC}Home/g" \
    -e "s/bootstrap${OLD_CC}/bootstrap${NEW_CC}/g" \
    -e "s/sync${OLD_CC}/sync${NEW_CC}/g" \
    -e "s/getBundled${OLD_CC}/getBundled${NEW_CC}/g" \
    -e "s/get${OLD_CC}/get${NEW_CC}/g" \
    -e "s/resolve${OLD_CC}/resolve${NEW_CC}/g" \
    -e "s/rel${OLD_CC}/rel${NEW_CC}/g" \
    -e "s/inline${OLD_CC}/inline${NEW_CC}/g" \
    -e "s/run${OLD_UC}/run${NEW_UC}/g" \
    -e "s/loadEffective${OLD_UC}/loadEffective${NEW_UC}/g" \
    -e "s/${OLD_UC}Preferences/${NEW_UC}Preferences/g" \
    -e "s/${OLD_UC}State/${NEW_UC}State/g" \
    "$f"
  # Restore @bhargavvc in case mid-word replacement broke it
  if grep -q "${NEW_LC}-build" "$f" 2>/dev/null; then
    sed -i -e "s/@${NEW_LC}-build/@${OLD_LC}-build/g" "$f"
  fi
done

# Fix branding text (src/ AND web/)
{ grep -rl 'Spec-Driven Development\|Spec-Driven Development' src/ web/ --include="*.ts" --include="*.tsx" 2>/dev/null || true; } | while read -r f; do
  sed -i \
    -e 's/Spec-Driven Development/Spec-Driven Development/g' \
    -e 's/Spec-Driven Development/Spec-Driven Development/g' \
    "$f"
done

# Fix web/ components — PascalCase and camelCase (Lesson: web/ has its own patterns)
echo "  Fixing web/ components..."
{ grep -rl "${OLD_UC}\|${OLD_CC}\|${OLD_LC}[A-Z]" web/ --include="*.ts" --include="*.tsx" 2>/dev/null || true; } \
  | grep -v node_modules | while read -r f; do
  sed -i \
    -e "s/${OLD_UC}WorkspaceStore/${NEW_UC}WorkspaceStore/g" \
    -e "s/${OLD_UC}WorkspaceProvider/${NEW_UC}WorkspaceProvider/g" \
    -e "s/use${OLD_UC}WorkspaceState/use${NEW_UC}WorkspaceState/g" \
    -e "s/use${OLD_UC}WorkspaceActions/use${NEW_UC}WorkspaceActions/g" \
    -e "s/${OLD_UC}AppShell/${NEW_UC}AppShell/g" \
    -e "s/${OLD_UC}ActionDef/${NEW_UC}ActionDef/g" \
    -e "s/Initial${OLD_CC}Header/Initial${NEW_CC}Header/g" \
    -e "s/filterInitial${OLD_CC}/filterInitial${NEW_CC}/g" \
    -e "s/hideInitial${OLD_CC}/hideInitial${NEW_CC}/g" \
    -e "s/${OLD_LC}Tree/${NEW_LC}Tree/g" \
    -e "s/${OLD_LC}Expanded/${NEW_LC}Expanded/g" \
    -e "s/get${OLD_CC}Root/get${NEW_CC}Root/g" \
    -e "s/${OLD_UC}/${NEW_UC}/g" \
    -e "s/${OLD_CC}/${NEW_CC}/g" \
    -e "s/\b${OLD_LC}\b/${NEW_LC}/g" \
    "$f"
  # Restore @bhargavvc
  if grep -q "${NEW_LC}-build" "$f" 2>/dev/null; then
    sed -i -e "s/@${NEW_LC}-build/@${OLD_LC}-build/g" "$f"
  fi
done

# Fix header filter title pattern
HEADER_FILTER="web/lib/initial-${NEW_LC}-header-filter.ts"
if [ -f "$HEADER_FILTER" ]; then
  sed -i "s/Spec-Driven Development v/Spec-Driven Development v/g" "$HEADER_FILTER"
fi

# Fix Dockerfiles (Lesson: not in standard extension list)
find . -name "Dockerfile*" -not -path './.git/*' 2>/dev/null | while read -r f; do
  if grep -q "${OLD_LC}\|${OLD_UC}" "$f" 2>/dev/null; then
    sed -i \
      -e "s/${OLD_LC}-pi/${NEW_LC}-pi/g" \
      -e "s/${OLD_UC}_VERSION/${NEW_UC}_VERSION/g" \
      -e "s/${OLD_UC}_/${NEW_UC}_/g" \
      "$f"
    echo "  Fixed: $f"
  fi
done

# Fix packages/ camelCase (Lesson: packages/ also has sddDir, sddBin)
{ grep -rl "${OLD_LC}[A-Z]\|${OLD_CC}" packages/ --include="*.ts" 2>/dev/null || true; } \
  | grep -v node_modules | while read -r f; do
  sed -i \
    -e "s/${OLD_LC}Dir/${NEW_LC}Dir/g" \
    -e "s/${OLD_LC}Bin/${NEW_LC}Bin/g" \
    -e "s/${OLD_LC}Path/${NEW_LC}Path/g" \
    -e "s/${OLD_LC}Home/${NEW_LC}Home/g" \
    "$f"
done

echo "  Done."

# ─── STEP 3: Fix logo if needed ──────────────────────────────────────────────
echo ""
echo "[3/4] Checking logo..."
if [ -f "src/logo.ts" ] && grep -q "${OLD_UC}" "src/logo.ts" 2>/dev/null; then
  cat > "src/logo.ts" << 'LOGOEOF'
/**
 * Shared SDD block-letter ASCII logo.
 */
export const SDD_LOGO: readonly string[] = [
  '  ███████╗██████╗ ██████╗ ',
  '  ██╔════╝██╔══██╗██╔══██╗',
  '  ███████╗██║  ██║██║  ██║',
  '  ╚════██║██║  ██║██║  ██║',
  '  ███████║██████╔╝██████╔╝',
  '  ╚══════╝╚═════╝ ╚═════╝ ',
]

export function renderLogo(color: (s: string) => string): string {
  return '\n' + SDD_LOGO.map(color).join('\n') + '\n'
}
LOGOEOF
  echo "  Logo replaced."
else
  echo "  Logo OK."
fi

# ─── STEP 4: Verify ──────────────────────────────────────────────────────────
echo ""
echo "[4/4] Verifying..."

# Fix main package.json name
sed -i "s/\"name\": \"${OLD_LC}-pi\"/\"name\": \"${NEW_LC}-pi\"/g" package.json 2>/dev/null || true

echo "  Package names:"
grep '"name"' package.json packages/*/package.json 2>/dev/null | head -10

# Also fix sdd variable names in source (sddDir, sddBin, etc.)
{ grep -rl --include="*.ts" --include="*.js" "${OLD_LC}Dir\|${OLD_LC}Bin\|${OLD_LC}Path" . 2>/dev/null || true; } \
  | grep -v '\.git/' | grep -v 'node_modules/' \
  | while read -r f; do
    sed -i \
      -e "s/${OLD_LC}Dir/${NEW_LC}Dir/g" \
      -e "s/${OLD_LC}Bin/${NEW_LC}Bin/g" \
      -e "s/${OLD_LC}Path/${NEW_LC}Path/g" \
      "$f"
  done

echo ""
REMAIN=$(grep -rl --include="*.ts" --include="*.js" --include="*.json" --include="*.md" \
  -E "\b${OLD_LC}\b|\b${OLD_UC}\b" . 2>/dev/null \
  | grep -v '\.git/' | grep -v 'node_modules/' \
  | grep -v "$SELF_NAME" | grep -v "$OLD_SCRIPT" \
  | grep -v 'package-lock.json' || true)

if [ -z "$REMAIN" ]; then
  echo "  No remaining references!"
else
  RCOUNT=$(echo "$REMAIN" | grep -c '.' || echo 0)
  echo "  $RCOUNT files still have refs (@${OLD_LC}-build expected):"
  echo "$REMAIN" | head -20
fi

echo ""
echo "=== Rebrand Complete ==="
echo "Next: npm install && npm run build"
