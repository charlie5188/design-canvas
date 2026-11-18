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
  die "$dir is not a canvas with the React shell (expected registry.tsx and canvas/Canvas.tsx). Pass the canvas folder, usually <app>/design-canvas/<name>. A shell ported to another framework takes shell changes by hand."

# TESTING.md is not installed, and Finder's .DS_Store is not part of the shell.
skip() { [[ "$1" == TESTING.md || "$1" == VERSION || "$(basename "$1")" == .DS_Store ]]; }

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

# Canvases installed before the agent channel need it added to their vite config, a kit file.
channel_note() {
  grep -qs "agentChannel" "$dir"/vite.config.* ||
    echo "This canvas cannot send annotations to the agent yet: add agentChannel() from ./canvas/agent-channel.ts to the plugins in its vite config, and allowImportingTsExtensions and noEmit to its tsconfig, as kits/react-vite does."
}

# Kit files belong to the canvas and are never replaced; say what an older canvas still needs
# from the kit's newer setup, for the agent to do (and the user to approve, where it is the app).
kit_notes() {
  local app_rel app parent
  app_rel="$(sed -nE 's/^const appDir = resolve\(canvasDir, "([^"]*)"\);.*/\1/p' "$dir"/vite.config.* 2>/dev/null | head -1)"
  app="$(cd "$dir/${app_rel:-../..}" 2>/dev/null && pwd)" || return 0
  [[ -f "$app/package.json" ]] || return 0
  parent="$(perl -MFile::Spec -e 'print File::Spec->abs2rel($ARGV[0], $ARGV[1])' "$(cd "$dir/.." && pwd)" "$app")"
  node "$skill_dir/scripts/check-app.mjs" "$app" "${parent%%/*}" | while IFS= read -r line; do if [[ -n "$line" ]]; then echo "$line"; fi; done
  # A canvas's tsconfig.json extends the app's; once the app leaves the canvas folder out, the
  # canvas's type check finds no files unless the canvas sets its own exclude.
  if [[ -f "$dir/tsconfig.json" ]] && ! grep -qs '"exclude"' "$dir/tsconfig.json" &&
    grep -qs "\"${parent%%/*}\"" "$app/tsconfig.json"; then
    echo "The app's tsconfig.json leaves ${parent%%/*} out, so this canvas's type check finds no files: add \"exclude\": [\"./node_modules\"] to $dir/tsconfig.json."
  fi
  # The stand-ins moved from the kit's mocks/ into the shell (canvas/stand-ins/), which now takes their place.
  local old
  old="$(cd "$dir" && ls mocks/next-*.ts mocks/next-*.tsx mocks/empty.ts mocks/react-router.tsx 2>/dev/null | tr '\n' ' ')"
  if [[ -n "$old" ]]; then
    echo "The shell's stand-ins (canvas/stand-ins/) now replace ${old% }: delete them unless you changed one on purpose."
  fi
  if grep -qs '"./mocks/react-router"' "$dir/providers.tsx"; then
    echo "In providers.tsx, import CanvasRouter from \"./canvas/stand-ins/react-router\" instead of \"./mocks/react-router\"."
  elif node -e 'const p = require(process.argv[1]); const d = { ...p.devDependencies, ...p.dependencies }; process.exit(["react-router", "react-router-dom"].some((n) => Number(String(d[n] || "").replace(/[^0-9.]/g, "").split(".")[0]) >= 6) ? 0 : 1)' "$app/package.json" &&
    ! grep -qs "ScreenRouter" "$dir/providers.tsx"; then
    echo "The app uses React Router: give each item a router driven by the canvas. In providers.tsx, import { ScreenRouter } from \"./canvas/routes\" and { CanvasRouter } from \"./canvas/stand-ins/react-router\", and wrap the children in <ScreenRouter.Provider value={CanvasRouter}>."
  fi
}

if [[ -z "$changes" ]]; then
  echo "The canvas is already up to date: $dir"
else
  rsync -a --delete --exclude TESTING.md --exclude VERSION --exclude .DS_Store "$shell/" "$dir/canvas/"
  printf 'Updated the canvas shell in %s:\n%s' "$dir" "$changes"
fi
# Written after the sync, so a canvas that was already current still learns its version.
cp "$skill_dir/VERSION" "$dir/canvas/VERSION"
channel_note
kit_notes || true
bash "$skill_dir/scripts/check-version.sh" || true
