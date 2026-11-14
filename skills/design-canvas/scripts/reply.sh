#!/usr/bin/env bash
# Answer one note from the design canvas on its pin.
# Usage: reply.sh <canvas-url> <note-id> <text>
#        reply.sh <canvas-url> <note-id> < file-with-the-text
#
# The note id is the last line of each entry in the message from the canvas,
# such as "(note cm3x9k0a)". The text is plain: no Markdown, one or two
# sentences. The person sees it beside the pin until they delete the note.
set -uo pipefail

die() { echo "design-canvas: $*" >&2; exit 1; }

url="${1:-}"
url="${url%/}"
id="${2:-}"
[[ "$url" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+$ ]] ||
  die "usage: reply.sh <canvas-url> <note-id> <text>, with a canvas URL such as http://127.0.0.1:4567/"
[[ "$id" =~ ^[A-Za-z0-9]{1,40}$ ]] ||
  die "the note id is the word after \"note\" on an entry's last line, such as cm3x9k0a"

# The words go as the request body, exactly as given, so quotes and other
# languages need no escaping.
if [[ $# -ge 3 ]]; then
  text="${*:3}"
else
  text="$(cat)"
fi
[[ -n "${text//[[:space:]]/}" ]] || die "give the reply as the third argument, or on standard input"

body="$(mktemp)"
trap 'rm -f "$body"' EXIT
status="$(printf '%s' "$text" | curl -sS -o "$body" -w '%{http_code} %{content_type}' --max-time 10 \
  -X POST -H 'Content-Type: text/plain; charset=utf-8' --data-binary @- \
  "$url/__design-canvas/agent/reply?id=$id" 2>/dev/null)" || status=""

case "${status%% *}" in
  200)
    [[ "$status" == "200 text/html"* ]] &&
      die "the canvas at $url/ cannot take replies. Run the skill's scripts/update.sh on it and restart its dev server, then reply again."
    echo "Replied on note $id."
    ;;
  "")
    die "the canvas at $url/ is not running. Start its dev server, then reply again, or answer in the chat."
    ;;
  413)
    die "$(cat "$body"). Shorten it, or answer in the chat and say so in the reply."
    ;;
  *)
    die "the canvas answered $status: $(head -c 200 "$body"). Answer in the chat instead."
    ;;
esac
