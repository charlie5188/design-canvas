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
// - Only the canvas page itself may send, and browsers may not listen.
//   Otherwise any web page open in the browser could instruct the agent, or
//   read what was meant for it, through this port.
//
// The same plugin serves the toolbar's Share button: `<SHARE_PATH>` builds the
// canvas into one HTML file with share.config.mts, in memory, and returns it
// for the page to download. Only the canvas page may ask.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "vite";
import { AGENT_EVENT, AGENT_PATH, EDIT_PATH, SHARE_PATH, VERSION_PATH } from "./channel.ts";
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
const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/;

type Timer = ReturnType<typeof setTimeout>;

// A Host check stops DNS rebinding, where another site's name resolves to this
// machine and so makes its pages same-origin with the canvas.
const localHost = (request: IncomingMessage) => LOCAL_HOST.test(request.headers.host ?? "");
const fromCanvasPage = (request: IncomingMessage) =>
  localHost(request) && request.headers.origin === `http://${request.headers.host}`;
// Browsers always send Origin or Sec-Fetch-Site; curl sends neither.
const fromBrowser = (request: IncomingMessage) => !!(request.headers.origin || request.headers["sec-fetch-site"]);

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

/** Builds the canvas at `root` into one HTML file with its share.config.mts, in memory. */
async function buildSharedFile(root: string): Promise<SharedFile> {
  const vite = (await load("vite")) as typeof import("vite");
  const result = await vite.build({ configFile: `${root}/canvas/share.config.mts`, build: { write: false } });
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
      return renderInPlace(code, id, root);
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
          return sendJson(response, status());
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
              if (next !== original) await writeFile(path, next);
              return { applied: result.applied, missing: result.missing, rejected, unremoved, ids };
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

      // One build at a time: a second click while it runs gets the same file.
      let sharing: Promise<SharedFile> | undefined;
      server.middlewares.use(SHARE_PATH, (request, response, next) => {
        if (request.method !== "POST" || (request.url ?? "/") !== "/") return next();
        if (!fromCanvasPage(request)) return send(response, 403, "Not allowed");
        sharing ??= buildSharedFile(server.config.root).finally(() => {
          sharing = undefined;
        });
        sharing.then(
          (file) => sendJson(response, file),
          (error: unknown) => send(response, 500, error instanceof Error ? error.message : String(error)),
        );
      });
    },
  };
}
