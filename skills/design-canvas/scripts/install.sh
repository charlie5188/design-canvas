#!/usr/bin/env bash
# Install a design canvas into the current project from a kit.
# Usage: install.sh <kit> <canvas-name> [title]
#
# Kits come from this skill's kits/ folder and from $DESIGN_CANVAS_KITS
# (default ~/.agents/design-canvas-kits), where project-specific kits can stay
# private. A private kit with the same name wins.
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
private_kits="${DESIGN_CANVAS_KITS:-$HOME/.agents/design-canvas-kits}"
die() { echo "design-canvas: $*" >&2; exit 1; }
warn() { echo "design-canvas: warning: $*" >&2; }

kit="${1:-}"
name="${2:-}"
title="${3:-$name}"
kits="$( (ls "$skill_dir/kits"; ls "$private_kits" 2>/dev/null) | sort -u | tr '\n' ' ')"
[[ -n "$kit" && -n "$name" ]] || die "usage: install.sh <kit> <canvas-name> [title]  (kits: $kits)"
[[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,47}$ ]] || die "canvas name must be lowercase kebab-case, up to 48 characters"

kit_dir="$private_kits/$kit"
[[ -f "$kit_dir/kit.env" ]] || kit_dir="$skill_dir/kits/$kit"
[[ -f "$kit_dir/kit.env" ]] || die "unknown kit '$kit' (kits: $kits)"
# shellcheck source=/dev/null
source "$kit_dir/kit.env"

# The app is a fixed folder of the repository for project kits, or else the
# nearest folder with a package.json.
if [[ -n "${KIT_APP_DIR:-}" ]]; then
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || die "kit '$kit' expects to run inside its git checkout"
  app="$root/$KIT_APP_DIR"
else
  app="$PWD"
  while [[ "$app" != "/" && ! -f "$app/package.json" ]]; do app="$(dirname "$app")"; done
  [[ -f "$app/package.json" ]] || die "no package.json from $PWD upward; run this inside the app"
fi
[[ -d "$app" ]] || die "$app does not exist"

dest="$app/$KIT_PARENT/$name"
[[ -e "$dest" ]] && die "$dest already exists; reuse that canvas instead of installing another"
if [[ -n "${KIT_CHECK:-}" && ! -e "$app/$KIT_CHECK" ]]; then
  hint="${KIT_CHECK_HINT:-install the app dependencies first}"
  warn "$KIT_CHECK is missing in $app; $hint"
elif [[ -n "${KIT_PREFLIGHT:-}" ]]; then
  (cd "$app" && eval "$KIT_PREFLIGHT" >/dev/null 2>&1) ||
    warn "dependencies are out of date for this checkout; fix with: ${KIT_PREFLIGHT_FIX:-reinstall dependencies}"
fi

mkdir -p "$dest/canvas"
rsync -a --exclude kit.env --exclude setup.sh "$kit_dir/" "$dest/"
rsync -a --exclude TESTING.md "$skill_dir/shell/" "$dest/canvas/"

# A stable port per canvas folder (4300-4999), so each canvas keeps one URL and
# its own saved layout, and an open tab never reloads into another canvas.
port=$(( 4300 + $(printf '%s' "$dest" | cksum | cut -d' ' -f1) % 700 ))
app_rel="$(perl -MFile::Spec -e 'print File::Spec->abs2rel($ARGV[0], $ARGV[1])' "$app" "$dest")"
html_title="$(printf '%s' "$title" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')"
find "$dest" -type f \( -name '*.ts' -o -name '*.mts' -o -name '*.tsx' -o -name '*.html' -o -name '*.md' -o -name '*.css' -o -name '*.json' \) -print0 |
  CANVAS_NAME="$name" CANVAS_TITLE="$html_title" APP_REL="$app_rel" CANVAS_PORT="$port" xargs -0 perl -pi -e \
    's/__CANVAS_NAME__/$ENV{CANVAS_NAME}/g; s/__CANVAS_TITLE__/$ENV{CANVAS_TITLE}/g; s/__APP_DIR__/$ENV{APP_REL}/g; s/__CANVAS_PORT__/$ENV{CANVAS_PORT}/g'

# Kit-specific detection, such as the app's global stylesheet or themes.
if [[ -f "$kit_dir/setup.sh" ]]; then
  APP_DIR="$app" CANVAS_DIR="$dest" bash "$kit_dir/setup.sh"
fi

run="${KIT_RUN//__CANVAS_NAME__/$name}"
cat <<EOF
Installed $KIT_LABEL canvas: $dest
Run from $app:
  $run
Then open http://127.0.0.1:$port/
EOF
