// Annotations: notes pinned to elements in previews, sent to a listening agent
// or copied to the conversation as one numbered list. Saved beside the layout
// so a hot reload, which the agent's own edits often cause, never loses unsent
// annotations.
//
// Lifecycle: new → (queued while the agent is busy →) sent or copied ("sent",
// with a fingerprint of its item's rendered content) → removed once that item
// renders differently after a code update, which usually means the agent
// applied it. Only sent annotations are ever removed automatically, and only
// per item, so an agent that edits in several steps, or an unrelated update,
// never takes unsent work or other items' notes.
//
// A "new version" annotation asks for a new item beside the original instead
// of a change to it. The original never changes then, so it is sent with the
// number of items that name it as `from`, and leaves once that number grows.

import { labels } from "./labels";

export type Annotation = {
  id: string;
  itemId: string;
  /** Pin point in the item's preview, in unscaled canvas units. */
  x: number;
  y: number;
  /** "Item › role “label”", frozen when the annotation was placed. */
  ref: string;
  text: string;
  /**
   * Apply to a new item beside the original rather than change it. One choice
   * per item: every unsent annotation on an item shares it.
   */
  version?: boolean;
  /**
   * Absent until sent. Then a fingerprint of the item's rendered content, or
   * for a `version` annotation `v|<count of items made from it>`.
   */
  sent?: string;
  /**
   * Sent while the agent was busy: it waits on the page and goes out once the
   * agent listens again. Never together with `sent`.
   */
  queued?: boolean;
};

const VERSION = 1;
const MAX_ANNOTATIONS = 100;
const MAX_REF = 300;
const MAX_TEXT = 4000;
const COORD_LIMIT = 100_000;

const keyOf = (storageKey: string) => `${storageKey}:annotations`;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

let counter = 0;
export const newAnnotationId = () => `c${Date.now().toString(36)}${(counter++).toString(36)}`;

const valid = (value: unknown, ids: ReadonlySet<string>): Annotation | undefined => {
  const c = value as Partial<Annotation> | null;
  if (!c || typeof c !== "object") return undefined;
  if (typeof c.id !== "string" || c.id.length > 40 || typeof c.itemId !== "string" || !ids.has(c.itemId)) return undefined;
  if (!finite(c.x) || !finite(c.y) || Math.abs(c.x) > COORD_LIMIT || Math.abs(c.y) > COORD_LIMIT) return undefined;
  if (typeof c.ref !== "string" || c.ref.length > MAX_REF) return undefined;
  if (typeof c.text !== "string" || !c.text.trim() || c.text.length > MAX_TEXT) return undefined;
  const sent = typeof c.sent === "string" && c.sent.length <= 16 ? { sent: c.sent } : {};
  const version = c.version === true ? { version: true } : {};
  const queued = c.queued === true && !("sent" in sent) ? { queued: true } : {};
  return { id: c.id, itemId: c.itemId, x: c.x, y: c.y, ref: c.ref, text: c.text, ...version, ...sent, ...queued };
};

/** Saved annotations for items that still exist; anything invalid is dropped. */
export function loadAnnotations(storageKey: string, ids: ReadonlySet<string>): Annotation[] {
  try {
    const raw = window.localStorage.getItem(keyOf(storageKey));
    if (!raw) return [];
    const doc = JSON.parse(raw) as { version?: unknown; annotations?: unknown };
    if (doc?.version !== VERSION || !Array.isArray(doc.annotations)) return [];
    return doc.annotations
      .slice(0, MAX_ANNOTATIONS)
      .map((entry) => valid(entry, ids))
      .filter((entry): entry is Annotation => !!entry);
  } catch {
    return [];
  }
}

export function saveAnnotations(storageKey: string, annotations: Annotation[]) {
  try {
    const kept = annotations.filter((c) => c.text.trim()).slice(0, MAX_ANNOTATIONS);
    if (kept.length) window.localStorage.setItem(keyOf(storageKey), JSON.stringify({ version: VERSION, annotations: kept }));
    else window.localStorage.removeItem(keyOf(storageKey));
  } catch {
    // Storage may be unavailable or full; annotations still work for this session.
  }
}

export const limitText = (text: string) => text.slice(0, MAX_TEXT);

/**
 * A short fingerprint of what an item renders: its preview markup, or the
 * frame's root for `viewport` items (same origin, so readable). Undefined when
 * the content is not there yet, for example a frame still loading.
 */
export function fingerprintItem(preview: Element | null): string | undefined {
  if (!preview) return undefined;
  const frame = preview.querySelector<HTMLIFrameElement>("iframe[data-canvas-frame]");
  let html: string | undefined;
  if (frame) {
    try {
      html = frame.contentDocument?.querySelector(".canvas-frame-root")?.innerHTML;
    } catch {
      return undefined;
    }
  } else {
    html = preview.innerHTML;
  }
  if (!html) return undefined;
  // FNV-1a, 32-bit: enough to tell "changed" from "same".
  let hash = 0x811c9dc5;
  for (let i = 0; i < html.length; i++) {
    hash ^= html.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36) + html.length.toString(36);
}

/**
 * One message for the conversation: a heading, then each reference with its
 * note indented under it, numbered like the unsent pins. When some items
 * should get a new version, a last line names them with their numbers; the
 * rest change in place.
 */
export function formatAnnotations(annotations: Annotation[], nameOf: (itemId: string) => string) {
  const entries = annotations.map((annotation, index) => {
    const body = annotation.text.trim().split(/\r?\n/).join("\n   ");
    return `${index + 1}. ${annotation.ref}\n   ${body}`;
  });
  const versioned = new Map<string, number[]>();
  annotations.forEach((annotation, index) => {
    if (annotation.version) versioned.set(annotation.itemId, [...(versioned.get(annotation.itemId) ?? []), index + 1]);
  });
  const lines = [labels.annotationsHeading(annotations.length), ...entries];
  if (versioned.size) {
    const items = [...versioned].map(([itemId, numbers]) => `${nameOf(itemId)} (${numbers.join(", ")})`);
    lines.push("", labels.newVersionLine(items.join("; ")));
  }
  return lines.join("\n");
}
