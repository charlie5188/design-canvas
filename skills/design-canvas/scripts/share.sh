#!/usr/bin/env bash
# Build a canvas into one self-contained HTML file to share.
# Usage: share.sh <canvas-folder> [output.html]
#
# The file opens from disk with a double-click and needs no server, so people
# who do not run the canvas can try every item, and it imports into Figma as a
# code layer. It is a snapshot: share again after changing the canvas. The
# toolbar's Share button builds the same file; the build itself (the canvas's
# canvas/share.config.mts) warns about anything it could not put inside.
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
die() { echo "design-canvas: $*" >&2; exit 1; }

dir="${1:-}"
[[ -n "$dir" ]] || die "usage: share.sh <canvas-folder> [output.html]"
dir="${dir%/}"
[[ -f "$dir/registry.tsx" && -f "$dir/canvas/Canvas.tsx" ]] ||
  die "$dir is not a canvas with the React shell (expected registry.tsx and canvas/Canvas.tsx). Pass the canvas folder, usually <app>/design-canvas/<name>."
[[ -f "$dir/canvas/share.config.mts" ]] ||
  die "this canvas's shell is older than sharing. Run: bash $skill_dir/scripts/update.sh $dir, then share again."
[[ -f "$dir/index.html" ]] || die "$dir has no index.html, the canvas page that the shared file is built from"
dir="$(cd "$dir" && pwd)"
name="$(basename "$dir")"
out="${2:-$dir/shared/$name-$(date +%Y-%m-%d).html}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# From the canvas folder, npx finds the app's own Vite.
(cd "$dir" && DESIGN_CANVAS_SHARE_DIR="$tmp" npx --no-install vite build --config canvas/share.config.mts) ||
  die "the build failed. Fix the errors above, which a plain vite build of the canvas shows too, then share again."
[[ -f "$tmp/index.html" ]] || die "the build made no index.html; check the canvas's vite config"
mkdir -p "$(dirname "$out")"
mv "$tmp/index.html" "$out"

size="$(du -h "$out" | cut -f1 | tr -d ' ')"
cat <<EOF
Shared file: $out ($size)
It opens with a double-click, with no server. Annotations and sending to the agent are left out.
In Figma, drag the file onto the canvas to make a code layer, then press its play button or view it full screen.
In Notion, drag the file into a page to embed it as a live page.
EOF
