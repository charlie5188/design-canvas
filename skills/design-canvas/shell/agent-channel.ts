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
// - Only the canvas page itself may send, and browsers may not listen.
//   Otherwise any web page open in the browser could instruct the agent, or
//   read what was meant for it, through this port.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

export type AgentState = "off" | "listening" | "working";
export const AGENT_PATH = "/__design-canvas/agent";
/** Vite's HMR channel carries state changes to open pages. */
export const AGENT_EVENT = "design-canvas:agent";

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

export function agentChannel(): Plugin {
  return {
    name: "design-canvas:agent",
    apply: "serve",
    configureServer(server) {
      let listener: { response: ServerResponse; timer: Timer } | undefined;
      let busyUntil = 0;
      let busyTimer: Timer | undefined;

      const state = (): AgentState => (listener ? "listening" : Date.now() < busyUntil ? "working" : "off");
      const broadcast = () => server.ws.send(AGENT_EVENT, { state: state() });
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
          return sendJson(response, { state: state() });
        }

        if (request.method === "GET" && url.pathname === "/listen") {
          if (!localHost(request) || fromBrowser(request)) return send(response, 403, "Only the agent listens");
          const seconds = Number(url.searchParams.get("timeout"));
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
          return broadcast();
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
              sendJson(response, { delivered, state: state() });
              broadcast();
            },
            () => send(response, 413, "Too large"),
          );
          return;
        }

        next();
      });
    },
  };
}
