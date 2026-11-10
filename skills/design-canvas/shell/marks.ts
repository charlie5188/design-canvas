// Board marks: notes and sections a person adds, moves, resizes, or rewrites on
// the canvas. They are not content yet: the canvas is source files, so a mark is
// a request to the agent, shown on the canvas as a dashed "not applied" ghost
// until the agent writes it into the registry. It travels in the same message
// as annotations.
//
// Lifecycle: new → (queued while the agent is busy →) sent or copied ("sent")
// → removed once the registry shows it. A new note or section is shown by one
// more registry entry of its kind; a change to an existing one by the entry
// matching the mark's text, position, and size.

import { labels } from "./labels";

export type BoardKind = "note" | "section";

/** A note's width when the registry gives none. */
export const NOTE_WIDTH = 220;

/** What a note or section is, before or after a change: for comparing and for saying what changed. */
export type Geometry = { x: number; y: number; w?: number; h?: number; text: string };

export type BoardMark = {
  id: string;
  kind: BoardKind;
  /** The registry entry this changes. Absent for a new note or section. */
  target?: string;
  /** The entry as the registry has it, taken when the change began. Only with `target`. */
  from?: Geometry;
  /** Canvas units, the top-left corner. */
  x: number;
  y: number;
  /** A section's size, or a note's width and minimum height. */
  w?: number;
  h?: number;
  /** A note's text, or a section's title. */
  text: string;
  /**
   * Absent until sent. For a new mark: how many entries of its kind the
   * registry needs for it to count as applied (the count when it was sent, plus
   * its place among the new marks of that kind in the same message). For a
   * change to an entry: 0.
   */
  sent?: number;
  /** Sent while the agent was busy; goes out once it listens again. Never with `sent`. */
  queued?: boolean;
};

const VERSION = 2;
const MAX_MARKS = 50;
const MAX_TEXT = 1000;
const COORD_LIMIT = 100_000;
const SAME = 1;

const keyOf = (storageKey: string) => `${storageKey}:board`;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const size = (value: unknown): value is number => finite(value) && value > 0 && value <= COORD_LIMIT;
const near = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined ? a === b : Math.abs(a - b) <= SAME);

let counter = 0;
export const newMarkId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

export const limitMarkText = (text: string) => text.slice(0, MAX_TEXT);

const validGeometry = (value: unknown): Geometry | undefined => {
  const g = value as Partial<Geometry> | null;
  if (!g || typeof g !== "object" || !finite(g.x) || !finite(g.y) || typeof g.text !== "string") return undefined;
  return { x: g.x, y: g.y, ...(size(g.w) ? { w: g.w } : {}), ...(size(g.h) ? { h: g.h } : {}), text: g.text.slice(0, MAX_TEXT) };
};

const valid = (value: unknown): BoardMark | undefined => {
  const m = value as Partial<BoardMark> | null;
  if (!m || typeof m !== "object") return undefined;
  if (typeof m.id !== "string" || m.id.length > 40) return undefined;
  if (m.kind !== "note" && m.kind !== "section") return undefined;
  if (!finite(m.x) || !finite(m.y) || Math.abs(m.x) > COORD_LIMIT || Math.abs(m.y) > COORD_LIMIT) return undefined;
  if (typeof m.text !== "string" || !m.text.trim() || m.text.length > MAX_TEXT) return undefined;
  const dims = { ...(size(m.w) ? { w: m.w } : {}), ...(size(m.h) ? { h: m.h } : {}) };
  if (m.kind === "section" && !m.target && !(dims.w && dims.h)) return undefined;
  const target = typeof m.target === "string" && m.target.length <= 80 ? { target: m.target } : {};
  const from = "target" in target ? validGeometry(m.from) : undefined;
  if ("target" in target && !from) return undefined;
  const sent = finite(m.sent) && m.sent >= 0 ? { sent: m.sent } : {};
  const queued = m.queued === true && !("sent" in sent) ? { queued: true } : {};
  return { id: m.id, kind: m.kind, x: m.x, y: m.y, ...dims, text: m.text, ...target, ...(from ? { from } : {}), ...sent, ...queued };
};

export function loadMarks(storageKey: string): BoardMark[] {
  try {
    const raw = window.localStorage.getItem(keyOf(storageKey));
    if (!raw) return [];
    const doc = JSON.parse(raw) as { version?: unknown; marks?: unknown };
    if (doc?.version !== VERSION || !Array.isArray(doc.marks)) return [];
    return doc.marks
      .slice(0, MAX_MARKS)
      .map(valid)
      .filter((entry): entry is BoardMark => !!entry);
  } catch {
    return [];
  }
}

export function saveMarks(storageKey: string, marks: BoardMark[]) {
  try {
    const kept = marks.filter((m) => m.text.trim()).slice(0, MAX_MARKS);
    if (kept.length) window.localStorage.setItem(keyOf(storageKey), JSON.stringify({ version: VERSION, marks: kept }));
    else window.localStorage.removeItem(keyOf(storageKey));
  } catch {
    // Storage may be unavailable or full; marks still work for this session.
  }
}

/** The mark as a Geometry, for comparing with an entry. */
const geometryOf = (mark: BoardMark): Geometry => ({
  x: mark.x,
  y: mark.y,
  ...(mark.w ? { w: mark.w } : {}),
  ...(mark.h ? { h: mark.h } : {}),
  text: mark.text,
});

/** What differs between two states of one note or section. A size counts only when both sides state it. */
function differences(a: Geometry, b: Geometry) {
  return {
    text: a.text.trim() !== b.text.trim(),
    moved: !near(a.x, b.x) || !near(a.y, b.y),
    resized: (a.w !== undefined && b.w !== undefined && !near(a.w, b.w)) || (a.h !== undefined && b.h !== undefined && !near(a.h, b.h)),
  };
}

/** A change to an entry that ended where it began. */
export function isUnchanged(mark: BoardMark): boolean {
  if (!mark.target || !mark.from) return false;
  const d = differences(geometryOf(mark), mark.from);
  // A size the entry never stated (a note's height) is a change once it is set.
  const heightSet = mark.h !== undefined && mark.from.h === undefined;
  return !d.text && !d.moved && !d.resized && !heightSet;
}

/**
 * What to wait for after sending: new marks get the registry count that shows
 * them, in message order, per kind. `counts` is how many notes and sections the
 * registry holds now.
 */
export function sentTargets(list: BoardMark[], counts: Record<BoardKind, number>): Map<string, number> {
  const next = { ...counts };
  const targets = new Map<string, number>();
  for (const mark of list) {
    if (mark.target) targets.set(mark.id, 0);
    else targets.set(mark.id, ++next[mark.kind]);
  }
  return targets;
}

export type BoardContext = {
  /** A note or section as the registry has it now. */
  entryOf: (kind: BoardKind, id: string) => Geometry | undefined;
  /** Items inside a section's bounds, with the positions they have on the canvas now. */
  inside: (bounds: { x: number; y: number; w: number; h: number }) => { name: string; x: number; y: number }[];
};

/** One message for the conversation, in the same style as the annotation list. */
export function formatBoard(list: BoardMark[], context: BoardContext) {
  const quote = (text: string) => `“${text.trim().split(/\r?\n/).join(" ")}”`;
  const round = Math.round;
  const entries = list.map((mark, index) => {
    const n = index + 1;
    const where = `${round(mark.x)},${round(mark.y)}`;
    const dims = mark.w && mark.h ? `${round(mark.w)}×${round(mark.h)}` : mark.w ? `width ${round(mark.w)}` : "";
    const items =
      mark.kind === "section" && mark.w && mark.h
        ? context.inside({ x: mark.x, y: mark.y, w: mark.w, h: mark.h }).map((item) => `${item.name} (${round(item.x)},${round(item.y)})`)
        : [];
    if (!mark.target || !mark.from) {
      return mark.kind === "note"
        ? `${n}. ${labels.boardAddNote(where, dims, quote(mark.text))}`
        : `${n}. ${labels.boardAddSection(quote(mark.text), where, dims, items)}`;
    }
    const d = differences(geometryOf(mark), mark.from);
    const heightSet = mark.h !== undefined && mark.from.h === undefined;
    const parts = [
      d.text ? labels.boardPartText(mark.kind, quote(mark.text)) : "",
      d.moved ? labels.boardPartMove(where) : "",
      d.resized || heightSet ? labels.boardPartSize(dims) : "",
      // Items inside move with a section, so their new positions go back to source too.
      items.length && (d.moved || d.resized) ? labels.boardPartItems(items) : "",
    ].filter(Boolean);
    return `${n}. ${labels.boardChange(mark.kind, mark.target, parts)}`;
  });
  return [labels.boardHeading(list.length), ...entries, "", labels.boardHowTo].join("\n");
}

/** The ghost of a mark has been replaced by the real thing once the registry shows it. */
export function isApplied(mark: BoardMark, counts: Record<BoardKind, number>, context: BoardContext): boolean {
  if (mark.sent === undefined) return false;
  if (!mark.target) return counts[mark.kind] >= mark.sent;
  const entry = context.entryOf(mark.kind, mark.target);
  if (!entry) return false;
  const d = differences(geometryOf(mark), entry);
  // A height the mark sets must show up in the entry too.
  const heightMissing = mark.h !== undefined && entry.h === undefined;
  return !d.text && !d.moved && !d.resized && !heightMissing;
}

// Items the person moved on the canvas. The canvas keeps item positions in the
// browser, but the shared file and the next session use the registry's, so a
// moved item is a change to apply like a note: it is "moved" while its position
// differs from the registry's, "sent" or "queued" once it went out at that
// position, and nothing once the registry matches.

export type MovedItem = { id: string; name: string; x: number; y: number };
export type MoveSent = { x: number; y: number; state: "sent" | "queued" };
export type MoveStates = Record<string, MoveSent>;

const MAX_MOVES = 200;
const movesKey = (storageKey: string) => `${storageKey}:moves`;

export function loadMoves(storageKey: string): MoveStates {
  try {
    const raw = window.localStorage.getItem(movesKey(storageKey));
    if (!raw) return {};
    const doc = JSON.parse(raw) as { version?: unknown; moves?: unknown };
    if (doc?.version !== 1 || !doc.moves || typeof doc.moves !== "object") return {};
    const out: MoveStates = {};
    for (const [id, value] of Object.entries(doc.moves as Record<string, unknown>).slice(0, MAX_MOVES)) {
      const m = value as Partial<MoveSent> | null;
      if (m && finite(m.x) && finite(m.y) && (m.state === "sent" || m.state === "queued")) out[id] = { x: m.x, y: m.y, state: m.state };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveMoves(storageKey: string, moves: MoveStates) {
  try {
    if (Object.keys(moves).length) window.localStorage.setItem(movesKey(storageKey), JSON.stringify({ version: 1, moves }));
    else window.localStorage.removeItem(movesKey(storageKey));
  } catch {
    // Storage may be unavailable or full; moves still work for this session.
  }
}

/** The moved items as one message, in the same style as the other lists. */
export function formatMoves(list: MovedItem[]) {
  const entries = list.map((item, index) => `${index + 1}. ${labels.moveItem(item.name, item.id, `${Math.round(item.x)},${Math.round(item.y)}`)}`);
  return [labels.movesHeading(list.length), ...entries, "", labels.movesHowTo].join("\n");
}
