import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const script = new URL("../skills/design-canvas/scripts/listen-codex.mjs", import.meta.url);
const thread = "11111111-2222-4333-8444-555555555555";
async function until(predicate) {
  for (let i = 0; i < 500; i++) {
    if (await predicate()) return;
    await delay(10);
  }
  throw new Error("Timed out waiting for listener");
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "codex-listener-test-"));
  const cli = join(directory, "fake codex");
  const callsFile = join(directory, "calls.jsonl");
  await writeFile(cli, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'queue' && args[1] === '--help') {
  if (process.env.TEST_UNSUPPORTED) process.exit(1);
  console.log('Usage: codex queue --thread <THREAD> --message <TEXT>');
} else {
  fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify(args) + '\\n');
  if (process.env.TEST_QUEUE_FAIL) { console.error('Queue unavailable'); process.exit(1); }
  console.log('Queued message for thread.');
}
`, { mode: 0o700 });
  let listener;
  let listens = 0;
  let lastListen;
  const server = createServer((request, response) => {
    if (request.url === "/__design-canvas/agent") {
      if (options.noChannel) {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end("<html>Canvas</html>");
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ state: options.occupied || listener ? "listening" : "off" }));
    } else if (request.url.startsWith("/__design-canvas/agent/listen?")) {
      listens++;
      lastListen = new URL(request.url, "http://canvas");
      listener = response;
      request.on("close", () => { if (listener === response) listener = undefined; });
    } else {
      response.writeHead(404); response.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/`;
  let output = "";
  const child = spawn(process.execPath, [script.pathname, options.url ?? url], {
    env: {
      ...process.env,
      CODEX_THREAD_ID: thread,
      CODEX_APP_RUNTIME_CLI_PATH: cli,
      DESIGN_CANVAS_LISTEN_SECONDS: "1",
      TEST_CALLS: callsFile,
      ...(options.env ?? {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  async function exited() {
    if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
    return child.exitCode;
  }
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return {
    child, url, exited,
    get listens() { return listens; },
    get lastListen() { return lastListen; },
    get output() { return output; },
    async ready() { await until(() => !!listener); },
    send(body, status = 200) {
      assert.ok(listener, "Listener must be waiting before a send");
      const response = listener;
      listener = undefined;
      response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(body);
    },
    disconnect() { listener.destroy(); listener = undefined; },
    async calls() {
      try { return (await readFile(callsFile, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); }
      catch (error) { if (error.code === "ENOENT") return []; throw error; }
    },
  };
}

test("queues literal annotations to the bound chat and keeps listening across messages", async (t) => {
  const f = await fixture(t);
  await f.ready();
  const message = 'Annotations from the design canvas (1):\n1. Card › button “送信”\n   Keep "$HOME", `echo nope`, and $(echo nope) literal.\n\nKeep the original and add a new version: Card (1)';
  f.send(message);
  await until(async () => (await f.calls()).length === 1);
  await f.ready();
  let calls = await f.calls();
  assert.deepEqual(calls[0].slice(0, 4), ["queue", "--thread", thread, "--message"]);
  assert.equal(calls[0].length, 5);
  assert.ok(calls[0][4].startsWith(message + "\n\n"));
  assert.ok(calls[0][4].includes(f.url));
  assert.ok(!calls[0][4].includes("listen.sh"));
  assert.equal(f.child.exitCode, null, "Bridge must remain alive after delivery");
  f.send("Second batch");
  await until(async () => (await f.calls()).length === 2);
  await f.ready();
  assert.equal(f.listens, 3);
  calls = await f.calls();
  assert.ok(calls[1][4].startsWith("Second batch\n\n"));
});

test("quiet timeout reopens the long poll without queueing a message", async (t) => {
  const f = await fixture(t);
  await f.ready();
  f.send("", 204);
  await f.ready();
  assert.equal(f.listens, 2);
  assert.deepEqual(await f.calls(), []);
});

test("a replacement listener stops the bridge rather than stealing the canvas back", async (t) => {
  const f = await fixture(t);
  await f.ready();
  f.send("replaced", 409);
  assert.equal(await f.exited(), 0);
  assert.equal(f.listens, 1);
  assert.deepEqual(await f.calls(), []);
});

test("takes over from an older Claude or Codex listener, as listen.sh does", async (t) => {
  const f = await fixture(t, { occupied: true });
  await f.ready();
  assert.equal(f.listens, 1);
  assert.equal(f.child.exitCode, null, "The newer listener must keep the canvas");
  f.send("For the newest chat");
  await until(async () => (await f.calls()).length === 1);
  assert.equal((await f.calls())[0][2], thread);
});

test("keeps each long poll under Node's 300-second header timeout", async (t) => {
  const f = await fixture(t, { env: { DESIGN_CANVAS_LISTEN_SECONDS: "3600" } });
  await f.ready();
  assert.equal(f.lastListen.searchParams.get("timeout"), "240");
});

test("queue failure preserves a private recovery copy and never retries an ambiguous delivery", async (t) => {
  const f = await fixture(t, { env: { TEST_QUEUE_FAIL: "1" } });
  await f.ready();
  f.send("Important annotation");
  assert.equal(await f.exited(), 1);
  assert.equal((await f.calls()).length, 1);
  const pending = f.output.match(/Notes are saved in (.+\/pending\.json)\./)?.[1];
  assert.ok(pending, f.output);
  t.after(() => rm(dirname(pending), { recursive: true, force: true }));
  const saved = JSON.parse(await readFile(pending, "utf8"));
  assert.equal(saved.thread, thread);
  assert.equal(saved.canvas, f.url.slice(0, -1));
  assert.ok(saved.message.startsWith("Important annotation\n\n"));
  assert.equal((await stat(pending)).mode & 0o777, 0o600);
  assert.equal(f.listens, 1);
});

test("reconnects after a dropped dev-server connection", async (t) => {
  const f = await fixture(t);
  await f.ready();
  f.disconnect();
  await f.ready();
  assert.equal(f.listens, 2);
  assert.deepEqual(await f.calls(), []);
});

for (const [name, options] of [
  ["an unsupported CLI", { env: { TEST_UNSUPPORTED: "1" } }],
  ["a missing chat id", { env: { CODEX_THREAD_ID: "" } }],
  ["a missing Desktop CLI", { env: { CODEX_APP_RUNTIME_CLI_PATH: "" } }],
  ["a non-local canvas", { url: "http://example.com:1234/" }],
  ["an invalid timeout", { env: { DESIGN_CANVAS_LISTEN_SECONDS: "0" } }],
  ["a canvas without the agent channel", { noChannel: true }],
]) {
  test(`rejects ${name} before receiving any notes`, async (t) => {
    const f = await fixture(t, options);
    assert.equal(await f.exited(), 1, f.output);
    assert.equal(f.listens, 0);
    assert.deepEqual(await f.calls(), []);
  });
}
