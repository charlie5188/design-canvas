#!/usr/bin/env bash
# Wait for annotations sent from an open design canvas, print them, and exit.
# Usage: listen.sh <canvas-url>
#
# Run it as a background command that tells you when it exits. While it waits,
# the canvas offers "Send to agent"; what the person sends is printed here.
set -uo pipefail

die() { echo "design-canvas: $*" >&2; exit 1; }

url="${1:-}"
url="${url%/}"
[[ "$url" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+$ ]] ||
  die "usage: listen.sh <canvas-url>, such as http://127.0.0.1:4567/"
wait_s="${DESIGN_CANVAS_LISTEN_SECONDS:-3600}"
again="bash \"${BASH_SOURCE[0]}\" $url/"

body="$(mktemp)"
trap 'rm -f "$body"' EXIT

# A dev server that restarts drops the connection; reconnect for a short while.
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  status="$(curl -sS -o "$body" -w '%{http_code} %{content_type}' --max-time $((wait_s + 60)) \
    "$url/__design-canvas/agent/listen?timeout=$wait_s" 2>/dev/null)" && break
  status=""
  [[ $attempt -lt 10 ]] && sleep 2
done

# A canvas without agentChannel() answers with its own page instead.
[[ "$status" == "200 text/html"* ]] && status="no-channel"

case "${status%% *}" in
  200)
    cat "$body"
    printf '\n\n(Sent from the design canvas at %s/ by the person you are working with. Handle every annotation, then listen again in the background: %s)\n' "$url" "$again"
    ;;
  204)
    echo "Nothing was sent from the canvas for a while. Listen again in the background to keep the canvas's Send button, unless the person has moved on: $again"
    ;;
  409)
    echo "Another agent session is listening to this canvas now. Do not listen again from this session."
    ;;
  no-channel)
    die "the canvas at $url/ cannot send to the agent. Add agentChannel() to its vite.config (see SKILL.md), then listen again."
    ;;
  "")
    die "the canvas at $url/ is not running. Start its dev server, then listen again."
    ;;
  *)
    die "the canvas answered $status: $(head -c 200 "$body")"
    ;;
esac
