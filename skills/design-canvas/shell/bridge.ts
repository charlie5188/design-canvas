// Messages from an item frame to the canvas page. Frames are same-origin
// pages of this canvas; the page checks origin, source, and every field.

/**
 * A canvas that scripts/share.sh built into one HTML file marks its root
 * element. The file has no frame.html, so item frames load the file itself
 * (see frameSource), and the annotation tools, which need the agent and the
 * dev server, are hidden.
 */
export const shared = document.documentElement.dataset.designCanvas === "shared";

/**
 * When the shared file was built. Each file keeps its layout under its own key,
 * so a newer file of the same canvas opens as it was shared, not with the
 * layout someone saved in an older one: files opened from disk share one origin.
 */
export const sharedStorageKey = (storageKey: string) => {
  const built = document.documentElement.dataset.designCanvasBuilt;
  return shared && built ? `${storageKey}@${built}` : storageKey;
};

export const FRAME_PAGE = "frame.html";

/**
 * Where a frame page runs: inside the canvas, nested in its own standalone
 * page, or (no context) opened directly in a tab.
 */
export type FrameContext = "canvas" | "page";

/**
 * Whether this page has an address of its own to reopen: on the dev server, a
 * web address, or a file on disk. A shared file shown inside another page,
 * such as a preview pane or an embed, is loaded from memory instead (a blob or
 * srcdoc document) and has none.
 */
export const hasAddress = /^(https?|file):$/.test(window.location.protocol);

/** A link that opens one item alone in a tab. Only for a page with an address (hasAddress). */
export const frameUrl = (id: string, context?: FrameContext) =>
  `${shared ? "" : FRAME_PAGE}?${frameQuery(id, context)}`;

const frameQuery = (id: string, context?: FrameContext) =>
  `item=${encodeURIComponent(id)}${context ? `&in=${context}` : ""}`;

/**
 * The shared file's own markup, read before anything renders. Item frames in a
 * shared file load it from memory (srcdoc) and read their item from their frame
 * name, so they show wherever the file is opened. Reopening the file's address
 * with ?item= works from disk and from a web address, but a file shown inside
 * another page has no address, and every frame stayed blank.
 */
const sharedPage = shared ? `<!doctype html>\n${document.documentElement.outerHTML}` : "";
const FRAME_NAME = "design-canvas-frame?";

/** Where an item frame's document comes from, as props for its iframe. */
export const frameSource = (id: string, context: FrameContext): { src: string } | { srcDoc: string; name: string } =>
  shared ? { srcDoc: sharedPage, name: FRAME_NAME + frameQuery(id, context) } : { src: frameUrl(id, context) };

/** This page's item and context: from its frame name in a shared file, otherwise from its address. */
export const frameParams = () =>
  shared && window.name.startsWith(FRAME_NAME)
    ? new URLSearchParams(window.name.slice(FRAME_NAME.length))
    : new URLSearchParams(window.location.search);

const SOURCE = "design-canvas";

// Only a page on a web address has an origin that a target origin can name.
// Opened from disk, every file is its own opaque origin; loaded from memory,
// the canvas and its srcdoc frames share whatever origin the host page gives
// them, often an opaque one. There, both sides address each other with "*" and
// rely on event.source, which every listener already checks, and on their own
// shared origin.
const onWeb = /^https?:$/.test(window.location.protocol);
const messageTarget = onWeb ? window.location.origin : "*";

/** Whether a message comes from a page of this canvas. Listeners also check event.source. */
export const fromThisCanvas = (event: MessageEvent) =>
  onWeb
    ? event.origin === window.location.origin
    : event.origin === self.origin || event.origin === "null" || event.origin === "file://";
const MAX_LABEL = 200;
const MAX_HREF = 2000;

export type FrameMessage =
  | { type: "wheel"; dx: number; dy: number; x: number; y: number; zoom: boolean }
  | { type: "space"; down: boolean }
  /** Z pressed or released inside the frame: the canvas's Figma-style zoom. `out`: Alt was down too. */
  | { type: "zoom-key"; down: boolean; out: boolean }
  | { type: "pick"; label: string }
  /** A link the frame blocked; the canvas reveals or reports it. */
  | { type: "link"; href: string }
  /** A form submit the frame blocked. */
  | { type: "form" }
  /** In annotate mode: the element clicked, at (x, y) in the frame. */
  | { type: "annotate"; label: string; x: number; y: number }
  /** In annotate mode: an area drawn in the frame, described by the frame. */
  | { type: "annotate-area"; label: string; x: number; y: number; w: number; h: number }
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
  if (m.type === "zoom-key" && typeof m.down === "boolean" && typeof m.out === "boolean") {
    return { type: "zoom-key", down: m.down, out: m.out };
  }
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
  if (
    m.type === "annotate-area" &&
    typeof m.label === "string" &&
    m.label.length <= MAX_LABEL * 3 &&
    finite(m.x) &&
    finite(m.y) &&
    finite(m.w) &&
    finite(m.h) &&
    m.w > 0 &&
    m.h > 0
  ) {
    return { type: "annotate-area", label: m.label, x: m.x, y: m.y, w: m.w, h: m.h };
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
