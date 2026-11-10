#!/usr/bin/env bash
# Runs the smoke job's steps (.github/workflows/smoke.yml) on this machine: install
# the canvas, update an older one, typecheck, build, and load it in a browser.
#
# When everything passes on a clean commit that is pushed, it marks that commit
# "local-smoke" on GitHub. That is the check `main` requires, so the pull request can
# merge, or auto-merge, without waiting for GitHub's runner. GitHub's own smoke job
# still runs and shows its result, but it does not block.
#
# Usage: test/smoke-local.sh [--no-status]    (--no-status runs the checks and marks nothing)
set -euo pipefail

mark=1
[[ "${1:-}" == "--no-status" ]] && mark=0
root="$(git rev-parse --show-toplevel)"
step() { printf '\n== %s\n' "$1"; }

# The mark says "this commit passed", so what ran must be this commit and nothing else.
if [[ $mark == 1 && -n "$(git -C "$root" status --porcelain)" ]]; then
  echo "There are uncommitted changes, so a pass would not describe the commit. Commit them, or run with --no-status." >&2
  exit 1
fi

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
diff -r -x TESTING.md ../../skills/design-canvas/shell "$canvas"
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
if [[ $mark == 0 ]]; then exit 0; fi

sha="$(git -C "$root" rev-parse HEAD)"
if [[ -z "$(git -C "$root" branch -r --contains "$sha")" ]]; then
  echo "Passed, but ${sha:0:7} is not pushed yet. Push it, then run this again to mark it." >&2
  exit 1
fi
gh api -X POST "repos/{owner}/{repo}/statuses/$sha" -f state=success -f context=local-smoke -f description="Passed on this machine" > /dev/null
echo "Marked ${sha:0:7} as local-smoke."
