#!/usr/bin/env node
// Codex Desktop consumes queued messages even when its agent is idle. Keep the
// canvas's existing long poll open; command completion is not a wake-up signal.
import { execFile } from "node:child_process";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
// Node's fetch drops a request that gets no response headers for 300 s. A
// longer poll would drop and reconnect every 5 minutes, and ten drops in a row
// read as "canvas not running". A shorter one ends with the canvas's own 204.
const MAX_POLL_S = 240;
const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => shutdown.abort());
}
const log = (text) => console.log(`design-canvas: ${text}`);

async function main() {
  const input = process.argv[2] ?? "";
  if (process.argv.length !== 3 || !/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+\/?$/.test(input)) {
    throw new Error("usage: node listen-codex.mjs http://127.0.0.1:<port>/");
  }
  const url = new URL(input);
  if (url.port === "0") throw new Error("Expected a local canvas port.");
  const thread = process.env.CODEX_THREAD_ID;
  const cli = process.env.CODEX_APP_RUNTIME_CLI_PATH;
  if (!thread || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(thread) || !cli || !isAbsolute(cli)) {
    throw new Error("Start this listener from the intended Codex Desktop chat; CODEX_THREAD_ID and CODEX_APP_RUNTIME_CLI_PATH are required.");
  }
  const seconds = Number(process.env.DESIGN_CANVAS_LISTEN_SECONDS ?? MAX_POLL_S);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
    throw new Error("DESIGN_CANVAS_LISTEN_SECONDS must be between 1 and 3600.");
  }
  const wait = Math.min(seconds, MAX_POLL_S);
  const help = await exec(cli, ["queue", "--help"], { timeout: 10_000 });
  if (!help.stdout.includes("--thread") || !help.stdout.includes("--message")) {
    throw new Error("This Codex CLI does not support queue --thread --message. Use Copy annotations instead.");
  }

  const base = `${url.origin}/__design-canvas/agent`;
  const get = (path, timeout) => fetch(`${base}${path}`, {
    redirect: "error",
    signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(timeout)]),
  });
  // Like listen.sh, take over from any older listener, Claude or Codex: the
  // person's most recent chat should get the notes, not one they left. The
  // older listener gets 409 and stops.
  async function listen() {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const status = await get("", 5_000);
        if (!(status.headers.get("content-type") ?? "").startsWith("application/json")) {
          throw new Error("Canvas cannot send annotations. Add agentChannel() to its vite.config first.");
        }
        if (!status.ok) throw new Error(`Canvas status returned HTTP ${status.status}.`);
        await status.body?.cancel();
        return await get(`/listen?timeout=${wait}`, (wait + 60) * 1000);
      } catch (error) {
        if (shutdown.signal.aborted) return null;
        // Only retry dropped connections, as listen.sh does on a Vite restart.
        if (!(error instanceof TypeError) && error.name !== "TimeoutError") throw error;
        if (attempt === 9) throw new Error("Canvas is not running or could not reconnect.", { cause: error });
        await delay(2000, undefined, { signal: shutdown.signal });
      }
    }
  }

  const recovery = await mkdtemp(join(tmpdir(), "design-canvas-codex-"));
  let pending;
  let received;
  try {
    log(`Listening at ${url.origin}/ for Codex chat ${thread}. Keep Codex Desktop open. A listener started later, from any chat, takes over.`);
    while (!shutdown.signal.aborted) {
      const response = await listen();
      if (!response) break;
      if (response.status === 409) {
        log("Another session took over this canvas's notes. Stopping without reconnecting.");
        break;
      }
      if (response.status === 204) continue;
      if (response.status !== 200) throw new Error(`Canvas listen returned HTTP ${response.status}.`);
      if (!(response.headers.get("content-type") ?? "").startsWith("text/plain")) {
        throw new Error("Canvas returned a page instead of annotations. Check agentChannel().");
      }
      const annotations = await response.text();
      if (!annotations.trim()) throw new Error("Canvas sent an empty annotation message.");
      const message = `${annotations}\n\n(Sent from the design canvas at ${url.origin}/ by the person you are working with. Handle every annotation. The Codex listener keeps running; do not start another listener.)`;
      // The canvas has already acknowledged receipt. Keep a private recovery
      // copy until queue succeeds; never retry an ambiguous CLI failure because
      // the message may have been queued just before the process failed.
      received = message;
      const file = join(recovery, "pending.json");
      await writeFile(file, JSON.stringify({ thread, canvas: url.origin, message }, null, 2), { mode: 0o600, flag: "wx" });
      pending = file;
      // Use the Desktop's own CLI and an explicit chat id, never --last or a
      // shell command. Annotation text must remain literal, including quotes.
      // --resume is unnecessary for Desktop and can warn despite successful delivery.
      await exec(cli, ["queue", "--thread", thread, "--message", message], { timeout: 30_000, maxBuffer: 1024 * 1024 });
      await unlink(pending);
      pending = undefined;
      received = undefined;
      log(`Annotations queued for chat ${thread}; listening again.`);
    }
  } finally {
    if (pending) {
      console.error(`design-canvas: Delivery was not confirmed. Notes are saved in ${pending}. Check the target chat before resending to avoid duplicates.`);
    } else if (received) {
      console.error(`design-canvas: Could not save the recovery file in ${recovery}. Received notes follow:\n${received}`);
    } else {
      await rmdir(recovery);
    }
  }
}

main().catch((error) => {
  if (shutdown.signal.aborted && error.name === "AbortError") return;
  console.error(`design-canvas: ${error.stderr?.trim() || error.message}`);
  process.exitCode = 1;
});
