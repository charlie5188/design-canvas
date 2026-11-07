// Messages from an item frame to the canvas page. Frames are same-origin
// pages of this canvas; the page checks origin, source, and every field.

/**
 * A canvas that scripts/share.sh built into one HTML file marks its root
 * element. The file has no frame.html, so item frames load the file itself
 * with ?item=, and the annotation tools, which need the agent and the dev
 * server, are hidden.
 */
export const shared = document.documentElement.dataset.designCanvas === "shared";

export const FRAME_PAGE = "frame.html";

/**
 * Where a frame page runs: inside the canvas, nested in its own standalone
 * page, or (no context) opened directly in a tab.
 */
export type FrameContext = "canvas" | "page";

export const frameUrl = (id: string, context?: FrameContext) =>
  `${shared ? "" : FRAME_PAGE}?item=${encodeURIComponent(id)}${context ? `&in=${context}` : ""}`;

const SOURCE = "design-canvas";

// Opened from disk, as a shared file usually is, every file is its own opaque
// origin, so a frame's messages to "file://" are dropped. There, both sides
// address each other with "*" and rely on event.source, which every listener
// already checks, instead of the origin.
const fromDisk = window.location.protocol === "file:";
const messageTarget = fromDisk ? "*" : window.location.origin;

/** Whether a message comes from a page of this canvas. Listeners also check event.source. */
export const fromThisCanvas = (event: MessageEvent) =>
  fromDisk ? event.origin === "null" || event.origin === "file://" : event.origin === window.location.origin;
const MAX_LABEL = 200;
const MAX_HREF = 2000;

export type FrameMessage =
  | { type: "wheel"; dx: number; dy: number; x: number; y: number; zoom: boolean }
  | { type: "space"; down: boolean }
  | { type: "pick"; label: string }
  /** A link the frame blocked; the canvas reveals or reports it. */
  | { type: "link"; href: string }
  /** A form submit the frame blocked. */
  | { type: "form" }
  /** In annotate mode: the element clicked, at (x, y) in the frame. */
  | { type: "annotate"; label: string; x: number; y: number }
  /** Escape pressed inside the frame while annotating. */
  | { type: "escape" };

export function postToCanvas(message: FrameMessage) {
  window.parent.postMessage({ source: SOURCE, ...message }, messageTarget);
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Returns a validated message, or undefined for anything else on the channel. */
export function readFrameMessage(data: unknown): FrameMessage | undefined {
  const m = data as Record<string, unknown> | null;
  if (!m || typeof m !== "object" || m.source !== SOURCE) return undefined;
  if (m.type === "wheel" && finite(m.dx) && finite(m.dy) && finite(m.x) && finite(m.y) && typeof m.zoom === "boolean") {
    return { type: "wheel", dx: m.dx, dy: m.dy, x: m.x, y: m.y, zoom: m.zoom };
  }
  if (m.type === "space" && typeof m.down === "boolean") return { type: "space", down: m.down };
  if (m.type === "pick" && typeof m.label === "string" && m.label.length <= MAX_LABEL) {
    return { type: "pick", label: m.label };
  }
  if (m.type === "link" && typeof m.href === "string" && m.href.length <= MAX_HREF) {
    return { type: "link", href: m.href };
  }
  if (m.type === "form") return { type: "form" };
  if (m.type === "annotate" && typeof m.label === "string" && m.label.length <= MAX_LABEL && finite(m.x) && finite(m.y)) {
    return { type: "annotate", label: m.label, x: m.x, y: m.y };
  }
  if (m.type === "escape") return { type: "escape" };
  return undefined;
}

// Messages from the canvas page to its item frames.

const MAX_THEME = 64;

export type CanvasMessage =
  | { type: "theme"; id: string }
  /** Annotate mode: frames outline on hover and turn clicks into annotations. */
  | { type: "annotate-mode"; on: boolean };

export function postToFrame(frame: Window, message: CanvasMessage) {
  frame.postMessage({ source: SOURCE, ...message }, messageTarget);
}

export function readCanvasMessage(data: unknown): CanvasMessage | undefined {
  const m = data as Record<string, unknown> | null;
  if (!m || typeof m !== "object" || m.source !== SOURCE) return undefined;
  if (m.type === "theme" && typeof m.id === "string" && m.id.length <= MAX_THEME) return { type: "theme", id: m.id };
  if (m.type === "annotate-mode" && typeof m.on === "boolean") return { type: "annotate-mode", on: m.on };
  return undefined;
}

/** Mocked app routers dispatch this so a programmatic navigation also stays on the canvas. */
export const NAVIGATE_EVENT = "design-canvas:navigate";
