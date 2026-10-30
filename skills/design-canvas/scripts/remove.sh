#!/usr/bin/env bash
# Remove a design canvas from the current project.
# Usage: remove.sh <kit> <canvas-name>
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
private_kits="${DESIGN_CANVAS_KITS:-$HOME/.agents/design-canvas-kits}"
die() { echo "design-canvas: $*" >&2; exit 1; }

kit="${1:-}"
name="${2:-}"
[[ -n "$kit" && -n "$name" ]] || die "usage: remove.sh <kit> <canvas-name>"
[[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,47}$ ]] || die "invalid canvas name"
kit_dir="$private_kits/$kit"
[[ -f "$kit_dir/kit.env" ]] || kit_dir="$skill_dir/kits/$kit"
[[ -f "$kit_dir/kit.env" ]] || die "unknown kit '$kit'"
# shellcheck source=/dev/null
source "$kit_dir/kit.env"

if [[ -n "${KIT_APP_DIR:-}" ]]; then
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || die "kit '$kit' expects to run inside its git checkout"
  app="$root/$KIT_APP_DIR"
else
  app="$PWD"
  while [[ "$app" != "/" && ! -f "$app/package.json" ]]; do app="$(dirname "$app")"; done
fi

dest="$app/$KIT_PARENT/$name"
[[ -f "$dest/canvas/Canvas.tsx" ]] || die "$dest is not a design canvas"
rm -rf "$dest"
echo "Removed $dest"
