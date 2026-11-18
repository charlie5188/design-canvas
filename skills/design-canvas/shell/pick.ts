// What a pick changes on the canvas. (The board applies it, saves it, and undoes it: Canvas.tsx, pickVersion.)
//
// "The versions it was compared with" are the items in the same section, or, for
// an item in no section, the other items in no section: a section is how a person
// says "these belong together", so another section's items are never touched.
// When sections sit inside a section, the outermost one is the comparison, and
// the sections inside it, except the picked version's own, move whole.
// They move into one section with the id `set-aside`, below everything else, in
// reading order. The camera stays where it is: the view is the person's.
import { labels } from "./labels";
import { ITEM_HEAD, type Position } from "./layout";
import { type BoardMark, NOTE_WIDTH } from "./marks";
import type { DirectAdd, DirectEdit, DirectRemove } from "./registry-edit.ts";
import { type CanvasItem, type CanvasNote, type CanvasSection, isSetAside, SET_ASIDE_ID } from "./types";

/** Inside the set-aside frame: room around the items, and between them. */
const ASIDE_PAD = 24;
const ASIDE_GAP = 40;
/** Clear space between the lowest thing on the canvas and a new set-aside frame, its title tab included. */
const ASIDE_ROOM = 120;
/** Canvas units kept above a section moved into "Set aside", for its title tab (about 28px on screen at 100%). */
const SECTION_TAB_ROOM = 40;
/**
 * Room kept above each item in the frame for its caption, which grows upward from the
 * item's name so that previews side by side line up (canvas.css, `.canvas-item-head`).
 * About three lines; a longer caption reaches over the frame's top edge.
 */
const CAPTION_ROOM = 48;
/** A note's height when the registry gives none: enough for a few lines. */
const NOTE_HEIGHT_GUESS = 120;

/** The canvas as it is when the person picks. */
type PickBoard = {
  /** Every item. The ones in `trash` take no part. */
  items: CanvasItem[];
  trash: string[];
  notes: CanvasNote[];
  sections: CanvasSection[];
  /** Notes and sections deleted here that the registry may still have, as `note:<id>` and `section:<id>`. */
  removed: ReadonlySet<string>;
  /** Where the items are now, which may be newer than the registry. */
  positions: Record<string, Position>;
  marks: BoardMark[];
};

/**
 * One pick as registry changes. `others`: the versions set aside. `placed` and `before`: where
 * each moved item goes and where it was. `edits` and `adds` make the pick; `inverse` and
 * `removes` take it back.
 */
export type PickPlan = {
  others: CanvasItem[];
  placed: Record<string, Position>;
  before: Record<string, Position>;
  edits: DirectEdit[];
  inverse: DirectEdit[];
  adds: DirectAdd[];
  removes: DirectRemove[];
};

/** Works out a pick of `item`. Null when the item is in a set-aside frame: it is out of the running, so there is nothing to pick. */
export function planPick(item: CanvasItem, { items, trash, notes: noteList, sections: all, removed: gone, positions, marks }: PickBoard): PickPlan | null {
  const frames = all.filter((s) => !gone.has(`section:${s.id}`));
  const placeOf = (entry: CanvasItem): Position => positions[entry.id] ?? { x: entry.x, y: entry.y };
  const centreOf = (entry: CanvasItem) => {
    const p = placeOf(entry);
    return { x: p.x + entry.width / 2, y: p.y + (ITEM_HEAD + entry.height) / 2 };
  };
  const holds = (f: CanvasSection, x: number, y: number) => x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height;
  const within = (inner: CanvasSection, outer: CanvasSection) =>
    inner.id !== outer.id && inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
  // Sections can sit inside a section, as a round of directions with one section
  // for each tradeoff does. The comparison is the outermost section: the whole
  // round, not only the tradeoff the picked version is on.
  const outermost = (x: number, y: number) => frames.filter((f) => holds(f, x, y)).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const centre = centreOf(item);
  if (frames.some((f) => isSetAside(f) && holds(f, centre.x, centre.y))) return null;
  const home = outermost(centre.x, centre.y);
  const visible = items.filter((entry) => !trash.includes(entry.id));
  const members = visible.filter((entry) => {
    if (entry.id === item.id) return false;
    const p = centreOf(entry);
    return outermost(p.x, p.y)?.id === home?.id;
  });
  // The other sections inside the comparison move whole, with the items, notes,
  // and sections they hold, so a set-aside version still shows which tradeoff it
  // answered. The picked version's own section stays with it; the other versions
  // in it move one by one, as in a section with no sections inside.
  const inner = home ? frames.filter((f) => !isSetAside(f) && within(f, home)) : [];
  const units = inner.filter((f) => !inner.some((g) => within(f, g)) && !holds(f, centre.x, centre.y));
  const carried = new Map<string, CanvasItem[]>(units.map((unit) => [unit.id, []]));
  const loose: CanvasItem[] = [];
  for (const entry of members) {
    const p = centreOf(entry);
    const unit = units.find((u) => holds(u, p.x, p.y));
    if (unit) carried.get(unit.id)!.push(entry);
    else loose.push(entry);
  }
  const others = [...loose, ...[...carried.values()].flat()];
  // Notes with a change still on its way are left where they are: moving them here would race that change.
  const notesIn = (unit: CanvasSection) =>
    noteList.filter(
      (n) =>
        !gone.has(`note:${n.id}`) &&
        !marks.some((m) => m.target === n.id) &&
        holds(unit, n.x + (n.width ?? NOTE_WIDTH) / 2, n.y + (n.height ?? NOTE_HEIGHT_GUESS) / 2),
    );
  type Piece = { kind: "item"; entry: CanvasItem; x: number; y: number; w: number; h: number } | { kind: "unit"; unit: CanvasSection; x: number; y: number; w: number; h: number };
  // Reading order: rows top to bottom, then left to right, so the set-aside row reads as the comparison did.
  const pieces: Piece[] = [
    ...loose.map((entry): Piece => ({ kind: "item", entry, ...placeOf(entry), w: entry.width, h: ITEM_HEAD + entry.height })),
    ...units.map((unit): Piece => ({ kind: "unit", unit, x: unit.x, y: unit.y, w: unit.width, h: SECTION_TAB_ROOM + unit.height })),
  ].sort((a, b) => Math.round(a.y / 200) - Math.round(b.y / 200) || a.x - b.x);

  const before: Record<string, Position> = {};
  const placed: Record<string, Position> = {};
  const edits: DirectEdit[] = [];
  const inverse: DirectEdit[] = [];
  const adds: DirectAdd[] = [];
  const removes: DirectRemove[] = [];
  const moveItem = (entry: CanvasItem, place: Position) => {
    before[entry.id] = placeOf(entry);
    placed[entry.id] = place;
    // A version picked earlier and now passed over loses its mark with the move.
    edits.push({ kind: "item", id: entry.id, set: { ...place, ...(entry.picked ? { picked: false } : {}) } });
    inverse.push({ kind: "item", id: entry.id, set: { x: entry.x, y: entry.y, ...(entry.picked ? { picked: true } : {}) } });
  };
  if (pieces.length) {
    const frame = frames.find((s) => s.id === SET_ASIDE_ID);
    let x: number;
    let top: number;
    if (frame) {
      // Picked before: the new ones join the row at its right end, and the frame grows to hold them.
      x = frame.x + frame.width - ASIDE_PAD + ASIDE_GAP;
      top = frame.y + ASIDE_PAD;
    } else {
      const bottoms = [
        ...visible.map((entry) => placeOf(entry).y + ITEM_HEAD + entry.height),
        ...noteList.filter((n) => !gone.has(`note:${n.id}`)).map((n) => n.y + (n.height ?? NOTE_HEIGHT_GUESS)),
        ...frames.map((f) => f.y + f.height),
      ];
      x = Math.min(...visible.map((entry) => placeOf(entry).x));
      top = Math.max(...bottoms) + ASIDE_ROOM + ASIDE_PAD;
    }
    const frameX = frame ? frame.x : x - ASIDE_PAD;
    const frameY = frame ? frame.y : top - ASIDE_PAD;
    for (const piece of pieces) {
      if (piece.kind === "item") {
        moveItem(piece.entry, { x: Math.round(x), y: Math.round(top + CAPTION_ROOM) });
      } else {
        // The section, the sections inside it, and what they hold all shift by the same amount.
        const { unit } = piece;
        const dx = Math.round(x - unit.x);
        const dy = Math.round(top + SECTION_TAB_ROOM - unit.y);
        for (const f of [unit, ...inner.filter((g) => within(g, unit))]) {
          edits.push({ kind: "section", id: f.id, set: { x: f.x + dx, y: f.y + dy } });
          inverse.push({ kind: "section", id: f.id, set: { x: f.x, y: f.y } });
        }
        for (const entry of carried.get(unit.id) ?? []) {
          const p = placeOf(entry);
          moveItem(entry, { x: Math.round(p.x + dx), y: Math.round(p.y + dy) });
        }
        for (const n of notesIn(unit)) {
          edits.push({ kind: "note", id: n.id, set: { x: n.x + dx, y: n.y + dy } });
          inverse.push({ kind: "note", id: n.id, set: { x: n.x, y: n.y } });
        }
      }
      x += piece.w + ASIDE_GAP;
    }
    const width = Math.round(x - ASIDE_GAP + ASIDE_PAD - frameX);
    const height = Math.round(Math.max(...pieces.map((piece) => piece.h + (piece.kind === "item" ? CAPTION_ROOM : 0))) + ASIDE_PAD * 2);
    if (frame) {
      edits.push({ kind: "section", id: frame.id, set: { width, height: Math.max(frame.height, height) } });
      inverse.push({ kind: "section", id: frame.id, set: { width: frame.width, height: frame.height } });
    } else {
      adds.push({ kind: "section", id: SET_ASIDE_ID, text: labels.setAside, x: Math.round(frameX), y: Math.round(frameY), width, height });
      removes.push({ kind: "section", id: SET_ASIDE_ID });
    }
  }
  edits.push({ kind: "item", id: item.id, set: { picked: true } });
  inverse.push({ kind: "item", id: item.id, set: { picked: false } });
  return { others, placed, before, edits, inverse, adds, removes };
}

/**
 * Where an item from the trash goes when the person sets it aside from there, instead of
 * putting it back where it was: into the same `set-aside` frame a pick fills, at the right
 * end of its row (the frame grows to hold it), or into a new frame below everything, as a
 * first pick makes one. For a person who drops versions one by one into the trash rather
 * than picking, so the ones worth keeping as a record end up where a pick puts them.
 */
export function planAside(
  item: CanvasItem,
  { items, trash, notes: noteList, sections: all, removed: gone, positions }: Omit<PickBoard, "marks">,
): { place: Position; edits: DirectEdit[]; adds: DirectAdd[] } {
  const frames = all.filter((s) => !gone.has(`section:${s.id}`));
  const placeOf = (entry: CanvasItem): Position => positions[entry.id] ?? { x: entry.x, y: entry.y };
  const visible = items.filter((entry) => entry.id !== item.id && !trash.includes(entry.id));
  const height = ITEM_HEAD + item.height;
  const moved = (place: Position): DirectEdit => ({ kind: "item", id: item.id, set: { ...place, ...(item.picked ? { picked: false } : {}) } });
  const frame = frames.find((s) => s.id === SET_ASIDE_ID);
  if (frame) {
    const x = frame.x + frame.width - ASIDE_PAD + ASIDE_GAP;
    const place = { x: Math.round(x), y: Math.round(frame.y + ASIDE_PAD + CAPTION_ROOM) };
    const grown = {
      width: Math.round(x + item.width + ASIDE_PAD - frame.x),
      height: Math.round(Math.max(frame.height, CAPTION_ROOM + height + ASIDE_PAD * 2)),
    };
    return { place, edits: [moved(place), { kind: "section", id: frame.id, set: grown }], adds: [] };
  }
  const bottoms = [
    ...visible.map((entry) => placeOf(entry).y + ITEM_HEAD + entry.height),
    ...noteList.filter((n) => !gone.has(`note:${n.id}`)).map((n) => n.y + (n.height ?? NOTE_HEIGHT_GUESS)),
    ...frames.map((f) => f.y + f.height),
  ];
  const x = visible.length ? Math.min(...visible.map((entry) => placeOf(entry).x)) : item.x;
  const top = bottoms.length ? Math.max(...bottoms) + ASIDE_ROOM + ASIDE_PAD : item.y;
  const place = { x: Math.round(x), y: Math.round(bottoms.length ? top + CAPTION_ROOM : top) };
  const section: DirectAdd = {
    kind: "section",
    id: SET_ASIDE_ID,
    text: labels.setAside,
    x: place.x - ASIDE_PAD,
    y: place.y - CAPTION_ROOM - ASIDE_PAD,
    width: item.width + ASIDE_PAD * 2,
    height: CAPTION_ROOM + height + ASIDE_PAD * 2,
  };
  return { place, edits: [moved(place)], adds: [section] };
}
