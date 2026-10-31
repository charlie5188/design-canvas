#!/usr/bin/env bash
# Bring an installed canvas up to date with this skill's shell.
# Usage: update.sh <canvas-folder>
#
# canvas/ is a plain copy of shell/: the installer fills no placeholders in it,
# and canvases leave it as installed. So the update replaces canvas/ with the
# current shell. Kit files, registry.tsx, and items/ belong to the canvas and
# stay as they are.
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shell="$skill_dir/shell"
die() { echo "design-canvas: $*" >&2; exit 1; }

dir="${1:-}"
[[ -n "$dir" ]] || die "usage: update.sh <canvas-folder>"
dir="${dir%/}"
# Check before replacing anything. A shell ported to another framework has no
# Canvas.tsx; port shell changes into it by hand.
[[ -f "$dir/registry.tsx" && -f "$dir/canvas/Canvas.tsx" ]] ||
  die "$dir is not a canvas with the React shell (expected registry.tsx and canvas/Canvas.tsx)"

# TESTING.md is not installed, and Finder's .DS_Store is not part of the shell.
skip() { [[ "$1" == TESTING.md || "$(basename "$1")" == .DS_Store ]]; }

changes=""
while IFS= read -r -d '' f; do
  rel="${f#"$shell/"}"
  skip "$rel" && continue
  if [[ ! -f "$dir/canvas/$rel" ]]; then changes+="  $rel (new)"$'\n'
  elif ! cmp -s "$f" "$dir/canvas/$rel"; then changes+="  $rel"$'\n'; fi
done < <(find "$shell" -type f -print0 | sort -z)
while IFS= read -r -d '' f; do
  rel="${f#"$dir/canvas/"}"
  skip "$rel" && continue
  [[ -f "$shell/$rel" ]] || changes+="  $rel (removed)"$'\n'
done < <(find "$dir/canvas" -type f -print0 | sort -z)

if [[ -z "$changes" ]]; then
  echo "The canvas is already up to date: $dir"
  exit 0
fi
rsync -a --delete --exclude TESTING.md --exclude .DS_Store "$shell/" "$dir/canvas/"
printf 'Updated the canvas shell in %s:\n%s' "$dir" "$changes"
