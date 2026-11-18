// The canvas's line to the agent, served by the canvas's own Vite dev server.
// The kit's vite.config adds `agentChannel()` to its plugins.
//
// The agent runs scripts/listen.sh as a background command. It holds a request
// to `<AGENT_PATH>/listen` open until the page sends annotations, prints them,
// and exits, and the exit wakes the agent. While someone listens, the page
// offers "Send to agent" in place of copying.
//
// - One listener: a newer one replaces the older, so a session that never
//   stopped listening cannot take messages meant for the current one.
// - After a delivery or a quiet timeout the agent is "working": it is expected
//   back soon, and the page queues what the person sends meanwhile. After
//   BUSY_MS without a new listener it counts as gone.
// - `handling` is separate: the agent has the person's notes and has not said
//   it is done. The page shows it, so people know their notes arrived and when
//   the agent finished. listen.sh says done by listening again. The Codex
//   listener listens again right after it queues a message (`keep=1`), so
//   there the agent says done with a POST to `<AGENT_PATH>/done`.
// - The agent answers a note on its pin with a POST to `<AGENT_PATH>/reply`
//   (scripts/reply.sh): a question gets its answer where it was asked, and a
//   note the agent could not apply says why, instead of both being lost in the
//   chat. The last answers are kept here for a page that opens later.
// - Only the canvas page itself may send, and browsers may not listen or reply.
//   Otherwise any web page open in the browser could instruct the agent, or
//   read what was meant for it, through this port.
//
// The same plugin serves the toolbar's Share button: `<SHARE_PATH>` builds the
// canvas into one HTML file with share.config.mts, in memory, and returns it
// for the page to download. Only the canvas page may ask.

import type { IncomingMessage, ServerResponse } from "node:http";
import { access, chmod, constants, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Plugin } from "vite";
import { AGENT_EVENT, AGENT_PATH, type AgentReply, EDIT_PATH, MAX_REPLY, NOTE_ID, PROPS_PATH, REPLY_EVENT, SHARE_PATH, THEME_PATH, VERSION_PATH } from "./channel.ts";
import { componentProps, sourceProps } from "./props-types.ts";
import { readStylesheet, tailwindTheme } from "./tailwind-theme.ts";
import { addEntry, applyEdits, type DirectAdd, type DirectEdit, type DirectRemove, placeableItems, removeEntry, validAdd, validEdit, validRemove } from "./registry-edit.ts";

export type AgentState = "off" | "listening" | "working";
/** What the page hears: `finished` only on the update that ends `handling` because the agent said done. */
export type AgentStatus = { state: AgentState; handling: boolean; finished?: boolean };
export { AGENT_EVENT, AGENT_PATH, EDIT_PATH, SHARE_PATH, VERSION_PATH } from "./channel.ts";
/** The shared file the Share button downloads, and the files that could not go inside it. */
export type SharedFile = { name: string; html: string; missing: string[] };

const DEFAULT_WAIT_S = 3600;
const BUSY_MS = 15 * 60_000;
const MAX_BODY = 256 * 1024;
/** How often a canvas edit starts again when registry.tsx changes under it before it gives up. */
const EDIT_ATTEMPTS = 5;
const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/;

type Timer = ReturnType<typeof setTimeout>;

// A Host check stops DNS rebinding, where another site's name resolves to this
// machine and so makes its pages same-origin with the canvas.
const localHost = (request: IncomingMessage) => LOCAL_HOST.test(request.headers.host ?? "");
const fromCanvasPage = (request: IncomingMessage) =>
  localHost(request) && request.headers.origin === `http://${request.headers.host}`;
// Browsers always send Origin or Sec-Fetch-Site; curl sends neither.
const fromBrowser = (request: IncomingMessage) => !!(request.headers.origin || request.headers["sec-fetch-site"]);

/**
 * Puts new text in a file in one step. A plain write empties the file first, and a
 * hot update that reads it in that moment gets a module with nothing in it: the page
 * then logs "does not provide an export named 'notes'" and stops updating until the
 * next change. So the text is written to a file beside it, and that file is renamed
 * over it, which leaves no moment when the file is empty or half written.
 *
 * A file the person made read-only is still refused, as a plain write refuses it
 * (a rename would not). Where a rename over the file is not possible, for example
 * while another program holds it open on Windows, the plain write is used.
 *
 * The file is replaced only while it still holds `expected`, the text the change was
 * made from. Someone else may have written it since, such as the agent adding an item
 * while the canvas saves a move; writing over that would undo their change without a
 * word. Then nothing is written, and the result is false. The check runs just before
 * the swap. Without a lock, which the agent's edits do not take, a write that opens the
 * file between the two can still be lost: in a test that aimed writes at that moment,
 * about one in seven that collided with a save, where every one was lost before.
 */
async function replaceFile(path: string, text: string, expected: string): Promise<boolean> {
  await access(path, constants.W_OK);
  // The file itself, so a link to it stays a link.
  const target = await realpath(path);
  const beside = join(dirname(target), `.${basename(target)}.saving`);
  const unchanged = async () => (await readFile(target, "utf8")) === expected;
  let swapped = false;
  try {
    await writeFile(beside, text);
    await chmod(beside, (await stat(target)).mode);
    if (await unchanged()) {
      await rename(beside, target);
      swapped = true;
    }
  } catch {
    // Falls back to the plain write below.
  }
  if (swapped) return true;
  await rm(beside, { force: true }).catch(() => {});
  if (!(await unchanged())) return false;
  await writeFile(target, text);
  return true;
}

function send(response: ServerResponse, status: number, body: string, type = "text/plain") {
  response.writeHead(status, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" });
  response.end(body);
}
const sendJson = (response: ServerResponse, body: unknown) => send(response, 200, JSON.stringify(body), "application/json");

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error("too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

// The page imports this file for its constants, so server-only modules load by
// name at run time, where no bundler follows them into the page.
const load = (name: string): Promise<unknown> => import(/* @vite-ignore */ name);

/** What a shared file leaves out, by registry id: the trash, and what lies outside what the person chose to share. */
export type LeaveOut = { items: string[]; notes: string[]; sections: string[] };
const SHARE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/i;
/** A leave-out list from the browser, checked before it goes near the build. */
function validLeaveOut(value: unknown): LeaveOut | undefined {
  const ids = (list: unknown) => (Array.isArray(list) && list.every((id) => typeof id === "string" && SHARE_ID.test(id)) ? (list as string[]) : undefined);
  const raw = (value ?? {}) as Record<string, unknown>;
  const items = ids(raw.items ?? []);
  const notes = ids(raw.notes ?? []);
  const sections = ids(raw.sections ?? []);
  return items && notes && sections ? { items, notes, sections } : undefined;
}

/**
 * Takes entries out of registry.tsx as the shared file is built, never on disk: what the file
 * leaves out is then not in it at all (its component's code included), not only hidden.
 */
function leaveOutOfRegistry(root: string, leave: LeaveOut): Plugin {
  const registry = join(root, "registry.tsx").replace(/\\/g, "/");
  return {
    name: "design-canvas:leave-out",
    enforce: "pre",
    transform(code, id) {
      if (id.split("?")[0]!.replace(/\\/g, "/") !== registry) return undefined;
      let source = code;
      const kinds = [["item", leave.items], ["note", leave.notes], ["section", leave.sections]] as const;
      for (const [kind, ids] of kinds) for (const entry of ids) source = removeEntry(source, kind, entry) ?? source;
      return { code: source, map: null };
    },
  };
}

/** Builds the canvas at `root` into one HTML file with its share.config.mts, in memory. */
async function buildSharedFile(root: string, leave?: LeaveOut): Promise<SharedFile> {
  const vite = (await load("vite")) as typeof import("vite");
  const result = await vite.build({
    configFile: `${root}/canvas/share.config.mts`,
    build: { write: false },
    ...(leave ? { plugins: [leaveOutOfRegistry(root, leave)] } : {}),
  });
  const files = (Array.isArray(result) ? result : [result]).flatMap(
    (entry) => (entry as { output?: { fileName: string; source?: unknown }[] }).output ?? [],
  );
  const page = files.find((file) => file.fileName === "index.html");
  if (typeof page?.source !== "string") throw new Error("the build made no page");
  // share.config.mts lists what it could not put inside the file.
  const report = files.find((file) => file.fileName === "design-canvas-share.json");
  let missing: string[] = [];
  try {
    missing = (JSON.parse(String(report?.source ?? "{}")) as { missing?: string[] }).missing ?? [];
  } catch {
    // No list: report nothing missing rather than fail the download.
  }
  const now = new Date();
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
  const name = root.split("/").filter(Boolean).pop() ?? "canvas";
  return { name: `${name}-${date}.html`, html: page.source, missing };
}

const STYLESHEET = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/;
type HotModule = { id?: string | null; url?: string; importers: Set<HotModule> };
type HotUpdate = { file: string; modules: HotModule[] };

/**
 * A save into registry.tsx changes data, not styles. But Tailwind reads every
 * source file, so Vite lists its stylesheet as depending on the registry, and
 * each save rebuilt the stylesheet and sent it to every page. The module that
 * imports the stylesheet (the kit's providers.tsx) then loaded anew, React saw a
 * new Providers and remounted the whole canvas, and every frame reloaded: the
 * page flashed on each move, note, or trash. Vite keeps that dependency as a
 * module of its own, imported only by the stylesheet, so a change to registry.tsx
 * now leaves that module out and updates only the pages that import the registry.
 * The next time a stylesheet is built, because another file changed, Tailwind
 * reads the registry again.
 */
function keepStylesOut(file: string, modules: HotModule[], root: string): HotModule[] | undefined {
  if (file.replace(/\\/g, "/") !== join(root, "registry.tsx").replace(/\\/g, "/")) return undefined;
  const onlyForStyles = (mod: HotModule) =>
    mod.importers.size > 0 && [...mod.importers].every((importer) => STYLESHEET.test(importer.id ?? importer.url ?? ""));
  const kept = modules.filter((mod) => !onlyForStyles(mod));
  // With nothing left Vite would reload the page, so then it updates as before.
  return kept.length && kept.length < modules.length ? kept : undefined;
}

const RENDER = /createRoot\(\s*document\.getElementById\((["'])root\1\)!?\s*\)\.render\(/;

/**
 * A save into registry.tsx must not reload the page: a reload cuts off a drag the
 * person has already started, and flickers. registry.tsx is not a component, so
 * Vite has nothing to swap and reloads. This makes the canvas's main.tsx and
 * frame.tsx accept the update instead, keeping one React root and rendering into
 * it again with the new registry. An entry file of another shape is left alone
 * and reloads as before.
 */
function renderInPlace(code: string, id: string, root: string): { code: string; map: null } | undefined {
  const normal = (path: string) => path.replace(/\\/g, "/");
  // Both pages that read the registry: the canvas, and frame.html, which `viewport` items load in iframes.
  // If either could not take the update, Vite would reload every page.
  const file = normal(id.split("?")[0]!);
  const entry = ["main.tsx", "frame.tsx"].some((name) => file === normal(join(root, name)));
  if (!entry || code.includes("import.meta.hot") || !RENDER.test(code)) return undefined;
  const next = code.replace(
    RENDER,
    '(import.meta.hot ? (import.meta.hot.data.root ??= createRoot(document.getElementById("root")!)) : createRoot(document.getElementById("root")!)).render(',
  );
  return { code: `${next}\nif (import.meta.hot) {\n  import.meta.hot.accept();\n}\n`, map: null };
}

const DEVTOOLS_HOOK = `if (!window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
  const renderers = new Map();
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers, supportsFiber: true, isDisabled: false,
    inject(internals) { const id = renderers.size + 1; renderers.set(id, internals); return id; },
    onCommitFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {}, checkDCE() {}, setStrictMode() {},
  };
}`;

export function agentChannel(): Plugin {
  let root = "";
  return {
    name: "design-canvas:agent",
    apply: "serve",
    // Before the other transforms, so main.tsx is still the file the kit wrote.
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    transform(code, id) {
      // The app's stylesheets, as written: their Tailwind theme, for Inspect (tailwind-theme.ts).
      if (/\.css(?:$|\?)/.test(id)) readStylesheet(id.split("?")[0]!, code);
      return renderInPlace(code, id, root);
    },
    // Inspect previews a prop change live through the hook React's dev build reports to (as React
    // DevTools does). React looks for it once, as it loads, so it must exist before any module runs.
    // An installed DevTools extension brings its own, which works the same.
    transformIndexHtml() {
      return [{ tag: "script", injectTo: "head-prepend", children: DEVTOOLS_HOOK }];
    },
    // Vite 6 and later call hotUpdate; Vite 5 calls handleHotUpdate. Typed loosely, as Vite 5's types lack hotUpdate.
    ...({
      hotUpdate: ({ file, modules }: HotUpdate) => keepStylesOut(file, modules, root),
      handleHotUpdate: ({ file, modules }: HotUpdate) => keepStylesOut(file, modules, root),
    } as object),
    configureServer(server) {
      let listener: { response: ServerResponse; timer: Timer } | undefined;
      let busyUntil = 0;
      let busyTimer: Timer | undefined;
      let handling = false;
      let handlingTimer: Timer | undefined;
      // Newest last. A restart of the dev server forgets them; the page keeps the ones it showed.
      let replies: AgentReply[] = [];

      const state = (): AgentState => (listener ? "listening" : Date.now() < busyUntil ? "working" : "off");
      const status = (finished = false): AgentStatus => {
        const now = state();
        // A gone agent handles nothing, so the page never shows a stale "working".
        if (now === "off") setHandling(false);
        return finished ? { state: now, handling, finished } : { state: now, handling };
      };
      const broadcast = (finished = false) => server.ws.send(AGENT_EVENT, status(finished));
      // An agent that never says done stops showing as working after BUSY_MS.
      function setHandling(next: boolean) {
        clearTimeout(handlingTimer);
        handling = next;
        if (next)
          handlingTimer = setTimeout(() => {
            handling = false;
            broadcast();
          }, BUSY_MS);
      }
      /** The agent finished the notes it had; the page says so once. */
      const finish = () => {
        if (!handling) return false;
        setHandling(false);
        return true;
      };
      const setBusy = (busy: boolean) => {
        clearTimeout(busyTimer);
        busyUntil = busy ? Date.now() + BUSY_MS : 0;
        if (busy) busyTimer = setTimeout(broadcast, BUSY_MS + 50);
      };
      /** Answers the listener, which ends its wait and wakes the agent. */
      const release = (status: number, body: string, busy: boolean) => {
        if (!listener) return;
        const { response, timer } = listener;
        listener = undefined;
        clearTimeout(timer);
        setBusy(busy);
        send(response, status, body);
      };

      server.middlewares.use(AGENT_PATH, (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://canvas");

        if (request.method === "GET" && url.pathname === "/") {
          if (!localHost(request)) return send(response, 403, "Not allowed");
          return sendJson(response, { ...status(), replies });
        }

        if (request.method === "POST" && url.pathname === "/reply") {
          if (!localHost(request) || fromBrowser(request)) return send(response, 403, "Only the agent replies");
          const id = url.searchParams.get("id") ?? "";
          if (!NOTE_ID.test(id)) return send(response, 400, "Expected ?id=<note id>, as the message gave it");
          readBody(request).then(
            (body) => {
              // Plain text, not JSON: the agent sends the words as they are, with no quoting to get wrong.
              const text = body.trim();
              if (!text) return send(response, 400, "Expected the reply as the request body");
              if (text.length > MAX_REPLY) return send(response, 413, `A reply is at most ${MAX_REPLY} characters; put a longer answer in the chat`);
              const reply: AgentReply = { id, text, at: Date.now() };
              replies = [...replies.filter((entry) => entry.id !== id), reply].slice(-100);
              server.ws.send(REPLY_EVENT, reply);
              send(response, 200, "Shown on the note's pin\n");
            },
            () => send(response, 413, "Too large"),
          );
          return;
        }

        if (request.method === "GET" && url.pathname === "/listen") {
          if (!localHost(request) || fromBrowser(request)) return send(response, 403, "Only the agent listens");
          const seconds = Number(url.searchParams.get("timeout"));
          // listen.sh listens again only after handling what it printed; a kept listener reconnects right away.
          const finished = url.searchParams.get("keep") !== "1" && finish();
          const wait = Number.isFinite(seconds) && seconds >= 1 && seconds <= DEFAULT_WAIT_S ? seconds : DEFAULT_WAIT_S;
          // 409 tells the older session to stop, so two sessions never take turns replacing each other.
          release(409, "replaced", false);
          const entry = {
            response,
            // 204: nothing sent in time. The agent normally listens again, so it counts as busy meanwhile.
            timer: setTimeout(() => release(204, "", true), wait * 1000),
          };
          listener = entry;
          // The listener went away without an answer: stopped, or its session ended.
          request.on("close", () => {
            if (listener !== entry) return;
            listener = undefined;
            clearTimeout(entry.timer);
            setBusy(false);
            broadcast();
          });
          return broadcast(finished);
        }

        if (request.method === "POST" && url.pathname === "/done") {
          if (!localHost(request) || fromBrowser(request)) return send(response, 403, "Only the agent says done");
          broadcast(finish());
          return send(response, 204, "");
        }

        if (request.method === "POST" && url.pathname === "/send") {
          if (!fromCanvasPage(request)) return send(response, 403, "Not allowed");
          readBody(request).then(
            (body) => {
              let text: unknown;
              try {
                text = (JSON.parse(body) as { text?: unknown }).text;
              } catch {
                // Falls through to the 400 below.
              }
              if (typeof text !== "string" || !text.trim()) return send(response, 400, "Expected { text }");
              const delivered = !!listener;
              release(200, text, true);
              if (delivered) setHandling(true);
              sendJson(response, { delivered, ...status() });
              broadcast();
            },
            () => send(response, 413, "Too large"),
          );
          return;
        }

        next();
      });

      // Moves, resizes, and text changes are written into registry.tsx as they happen.
      // Writes run one after another, so two edits never read the same file state.
      let writing: Promise<unknown> = Promise.resolve();
      server.middlewares.use(EDIT_PATH, (request, response, next) => {
        // Which items a move or resize could be saved for, so the page can warn up front.
        if (request.method === "GET" && request.url === "/check") {
          // A same-origin GET carries no Origin header, so the Host check alone applies; it reads only item ids.
          if (!localHost(request)) return send(response, 403, "Not allowed");
          readFile(join(server.config.root, "registry.tsx"), "utf8").then(
            (source) => sendJson(response, { placeable: placeableItems(source) }),
            (error: unknown) => send(response, 500, error instanceof Error ? error.message : String(error)),
          );
          return;
        }
        if (request.method !== "POST" || (request.url ?? "/") !== "/") return next();
        if (!fromCanvasPage(request)) return send(response, 403, "Not allowed");
        readBody(request).then(
          (body) => {
            let parsed: { edits?: unknown; adds?: unknown; removes?: unknown } = {};
            try {
              parsed = JSON.parse(body) as typeof parsed;
            } catch {
              // Falls through to the 400 below.
            }
            const rawEdits = Array.isArray(parsed.edits) ? parsed.edits : [];
            const rawAdds = Array.isArray(parsed.adds) ? parsed.adds : [];
            const rawRemoves = Array.isArray(parsed.removes) ? parsed.removes : [];
            if (!rawEdits.length && !rawAdds.length && !rawRemoves.length) return send(response, 400, "Expected { edits }, { adds }, or { removes }");
            const edits = rawEdits.map(validEdit);
            const adds = rawAdds.map(validAdd);
            const removes = rawRemoves.map(validRemove);
            if (edits.some((edit) => !edit) || adds.some((add) => !add) || removes.some((remove) => !remove)) return send(response, 400, "Invalid edit");
            const path = join(server.config.root, "registry.tsx");
            const job = writing.then(async () => {
              // When the file changes while an edit is made (replaceFile), the edit starts again from
              // the new text, so it lands on top of that change instead of undoing it.
              for (let attempt = 1; ; attempt++) {
                const original = await readFile(path, "utf8");
                const result = applyEdits(original, edits as DirectEdit[]);
                let next = result.source;
                // Removals first, so an entry that is removed and added back in one request ends up present.
                const unremoved: string[] = [];
                for (const remove of removes as DirectRemove[]) {
                  const removed = removeEntry(next, remove.kind, remove.id);
                  if (removed === undefined) unremoved.push(remove.id);
                  else next = removed;
                }
                // New entries go in order, so their place in the array matches their place in the request.
                const rejected: number[] = [];
                const ids: (string | null)[] = [];
                (adds as DirectAdd[]).forEach((add, index) => {
                  const added = addEntry(next, add);
                  if (added) {
                    next = added.source;
                    ids[index] = added.id;
                  } else {
                    rejected.push(index);
                    ids[index] = null;
                  }
                });
                if (next === original || (await replaceFile(path, next, original))) {
                  return { applied: result.applied, missing: result.missing, rejected, unremoved, ids };
                }
                if (attempt === EDIT_ATTEMPTS) throw new Error("registry.tsx kept changing while the canvas saved; try again");
              }
            });
            writing = job.catch(() => {});
            job.then(
              (result) => sendJson(response, result),
              (error: unknown) => send(response, 500, error instanceof Error ? error.message : String(error)),
            );
          },
          () => send(response, 413, "Too large"),
        );
      });

      // The canvas's own version (written by install.sh and update.sh) and GitHub's newest, asked at most once an hour.
      // Offline, or with DESIGN_CANVAS_NO_UPDATE_CHECK set, there is no answer, and the page shows nothing.
      let latest: { at: number; value: number | null } | undefined;
      const newest = async () => {
        if (process.env.DESIGN_CANVAS_NO_UPDATE_CHECK) return null;
        if (latest && Date.now() - latest.at < 3_600_000) return latest.value;
        const url = process.env.DESIGN_CANVAS_VERSION_URL ?? "https://raw.githubusercontent.com/charlie5188/design-canvas/main/skills/design-canvas/VERSION";
        let value: number | null = null;
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
          const number = parseInt((await response.text()).replace(/\D/g, ""), 10);
          if (response.ok && Number.isFinite(number)) value = number;
        } catch {
          // Offline: no answer.
        }
        latest = { at: Date.now(), value };
        return value;
      };
      // Inspect: a component's props and the values each allows. It reads only type declarations
      // inside the named package, found from this folder as Node would.
      server.middlewares.use(PROPS_PATH, (request, response, next) => {
        if (request.method !== "GET") return next();
        if (!localHost(request)) return send(response, 403, "Not allowed");
        const query = new URL(request.url ?? "/", "http://canvas").searchParams;
        const pkg = query.get("package") ?? "";
        const component = query.get("component") ?? "";
        if (pkg && !/^(@[\w.-]+\/)?[\w.-]+$/.test(pkg)) return send(response, 400, "Bad package");
        try {
          // A system with no package (shadcn/ui) has its components in the app's own source.
          const props = pkg ? componentProps(server.config.root, pkg, component) : sourceProps(server.config.root, component);
          sendJson(response, { props });
        } catch (error) {
          send(response, 500, error instanceof Error ? error.message : String(error));
        }
      });
      server.middlewares.use(THEME_PATH, (request, response, next) => {
        if (request.method !== "GET") return next();
        if (!localHost(request)) return send(response, 403, "Not allowed");
        sendJson(response, { theme: tailwindTheme(server.config.root) });
      });
      server.middlewares.use(VERSION_PATH, (request, response, next) => {
        if (request.method !== "GET" || (request.url ?? "/") !== "/") return next();
        // A same-origin GET carries no Origin header, so the Host check alone applies; it reads only version numbers and this folder's path.
        if (!localHost(request)) return send(response, 403, "Not allowed");
        Promise.all([readFile(join(server.config.root, "canvas", "VERSION"), "utf8").catch(() => ""), newest()]).then(
          ([own, newer]) => {
            const current = parseInt(own.replace(/\D/g, ""), 10);
            sendJson(response, { current: Number.isFinite(current) ? current : null, latest: newer, folder: server.config.root });
          },
          (error: unknown) => send(response, 500, error instanceof Error ? error.message : String(error)),
        );
      });

      // One build per choice at a time: a second click while it runs gets the same file.
      const sharing = new Map<string, Promise<SharedFile>>();
      server.middlewares.use(SHARE_PATH, (request, response, next) => {
        if (request.method !== "POST" || (request.url ?? "/") !== "/") return next();
        if (!fromCanvasPage(request)) return send(response, 403, "Not allowed");
        readBody(request).then(
          (body) => {
            let leave: LeaveOut | undefined;
            try {
              leave = validLeaveOut(body.trim() ? (JSON.parse(body) as { leaveOut?: unknown }).leaveOut : undefined);
            } catch {
              leave = undefined;
            }
            if (!leave) return send(response, 400, "Bad request");
            const key = JSON.stringify(leave);
            let build = sharing.get(key);
            if (!build) {
              build = buildSharedFile(server.config.root, leave).finally(() => sharing.delete(key));
              sharing.set(key, build);
            }
            build.then(
              (file) => sendJson(response, file),
              (error: unknown) => send(response, 500, error instanceof Error ? error.message : String(error)),
            );
          },
          () => send(response, 400, "Bad request"),
        );
      });
    },
  };
}
