#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# modular-flutter-l10n — build & publish script
# Usage:
#   ./publish.sh            # build + package to .vsix (default, no upload)
#   ./publish.sh --publish  # actually publish to the VS Code Marketplace
# ─────────────────────────────────────────────────────────────────────────────

PUBLISH=false
for arg in "$@"; do
  [[ "$arg" == "--publish" ]] && PUBLISH=true
done

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

step()  { echo -e "\n${CYAN}▶ $1${RESET}"; }
ok()    { echo -e "${GREEN}✔ $1${RESET}"; }
warn()  { echo -e "${YELLOW}⚠ $1${RESET}"; }
fail()  { echo -e "${RED}✘ $1${RESET}"; exit 1; }

# ─── 1. Resolve script directory ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
step "Working directory: $SCRIPT_DIR"

# ─── 2. Read version from package.json ───────────────────────────────────────
VERSION=$(node -p "require('./package.json').version")
[[ -z "$VERSION" ]] && fail "Could not read version from package.json"
step "Extension version: $VERSION"

if ! grep -q "^## \[$VERSION\]" CHANGELOG.md; then
  fail "CHANGELOG.md has no '## [$VERSION]' entry. Add one before publishing."
fi
ok "CHANGELOG entry found for $VERSION"

# ─── 3. Verify required tools ────────────────────────────────────────────────
step "Checking required tools"
command -v node >/dev/null 2>&1 || fail "node not found in PATH"
command -v npx  >/dev/null 2>&1 || fail "npx not found in PATH"
ok "node $(node --version)"

# ─── 4. Clean install ────────────────────────────────────────────────────────
# `npm ci` rather than `npm install`: esbuild ships a platform-specific native
# binary, so a node_modules tree copied between machines fails the bundle step.
step "Installing dependencies (npm ci)"
npm ci
ok "Dependencies installed"

# ─── 5. Typecheck ────────────────────────────────────────────────────────────
step "Typechecking"
npx tsc -p ./ --noEmit
ok "No type errors"

# ─── 6. Bundle ───────────────────────────────────────────────────────────────
step "Bundling for production"
npm run bundle:prod
ok "Bundled to dist/extension.js"

# ─── 7. Package ──────────────────────────────────────────────────────────────
step "Packaging .vsix"
npx vsce package
ok "Created modular-flutter-l10n-$VERSION.vsix"

# ─── 8. Publish ──────────────────────────────────────────────────────────────
if [[ "$PUBLISH" == true ]]; then
  echo ""
  warn "About to publish modular-flutter-l10n v$VERSION to the VS Code Marketplace."
  read -r -p "  Are you sure? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

  step "Publishing to the Marketplace"
  npx vsce publish
  ok "Published modular-flutter-l10n v$VERSION"
else
  echo ""
  warn "Packaged only. Install locally to test:"
  echo "  code --install-extension modular-flutter-l10n-$VERSION.vsix --force"
  echo ""
  warn "When ready, publish with:"
  echo "  ./publish.sh --publish"
fi

echo ""
ok "Done."
