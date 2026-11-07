#!/usr/bin/env bash
# Says when GitHub has a newer version of this skill than the copy running it.
# install.sh and update.sh run it. It prints nothing when this copy is current,
# when the machine is offline, or with DESIGN_CANVAS_NO_UPDATE_CHECK=1.
#
# VERSION is a whole number that goes up when installed copies should update.
set -uo pipefail

[[ -n "${DESIGN_CANVAS_NO_UPDATE_CHECK:-}" ]] && exit 0
skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
url="${DESIGN_CANVAS_VERSION_URL:-https://raw.githubusercontent.com/charlie5188/design-canvas/main/skills/design-canvas/VERSION}"

current="$(tr -dc '0-9' <"$skill_dir/VERSION" 2>/dev/null)"
latest="$(curl -fsS --max-time 3 "$url" 2>/dev/null | tr -dc '0-9')"
[[ -n "$current" && -n "$latest" ]] || exit 0
((10#$latest > 10#$current)) || exit 0

# A git checkout of this repository updates with git; a copy from `npx skills add`
# updates with npx. A copy inside some other repository is not that checkout.
top="$(git -C "$skill_dir" rev-parse --show-toplevel 2>/dev/null)"
if [[ -n "$top" && "$(cd "$top/skills/design-canvas" 2>/dev/null && pwd -P)" == "$(cd "$skill_dir" && pwd -P)" ]]; then
  fix="git -C \"$top\" pull --ff-only"
else
  fix="npx skills update design-canvas"
fi
echo "design-canvas: version $latest of this skill is out; this copy is version $current. Tell the person in one line, with the command to update: $fix"
