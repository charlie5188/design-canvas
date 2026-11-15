#!/usr/bin/env bash
# Runs the smoke job's steps (.github/workflows/smoke.yml) on this machine: install
# the canvas, update an older one, typecheck, build, and load it in a browser.
#
# Use it to find a failure before pushing. It is not a merge check: `main` requires
# GitHub's own smoke job, which runs on a slower machine and has caught timing
# problems that passed here. It used to mark the commit "local-smoke" on GitHub,
# and that was the merge check, until a pass here was followed by a failure there.
#
# Usage: test/smoke-local.sh
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
step() { printf '\n== %s\n' "$1"; }

cd "$root/test/fixture-app"
# What an earlier run left behind (all of it ignored by git).
rm -rf design-canvas install.log test-results playwright-report

step "Install dependencies"
npm ci --no-audit --no-fund

step "Install the canvas"
bash ../../skills/design-canvas/scripts/install.sh react-vite smoke "Smoke" | tee install.log
CANVAS_URL="$(grep -o 'http://127.0.0.1:[0-9]*/' install.log)"
export CANVAS_URL

step "Update an older canvas"
# Makes the canvas look like one installed before later shell changes: a missing file,
# an edited file, and a file the shell no longer has. The update must restore the shell
# exactly, and a second run must find nothing to do.
canvas=design-canvas/smoke/canvas
rm "$canvas/annotations.ts"
echo '// older' >> "$canvas/Canvas.tsx"
touch "$canvas/dropped.ts"
bash ../../skills/design-canvas/scripts/update.sh design-canvas/smoke
diff -r -x TESTING.md -x VERSION ../../skills/design-canvas/shell "$canvas"
bash ../../skills/design-canvas/scripts/update.sh design-canvas/smoke | grep -q 'already up to date'

step "Typecheck the canvas"
npx tsc --noEmit -p design-canvas/smoke/tsconfig.json

step "Build the canvas"
npx vite build --config design-canvas/smoke/vite.config.mts

step "Load the canvas in a browser"
npx playwright install --only-shell chromium
npx playwright test

echo
echo "All smoke steps passed."
