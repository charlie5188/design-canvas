// What a pick touches, and where the trash's "Set aside" puts an item. (The board applies
// both and saves them: Canvas.tsx, pickVersion and setAsideFromTrash.)
//
// A pick only marks the version the person chose. Nothing moves: versions sit in rows by
// the item they were made from (lineage.ts), so the canvas is already the record of what
// was compared, and the path from the original to the pick (LineagePaths.tsx) says how the
// exploration got there. Moving the others away would break that record.
//
// A pick takes the mark off an earlier pick among the versions it was compared with: the
// items linked to it by `from`, either way and at any distance (also through a version in
// the trash), and the items in the same outermost section (a round of directions is a
// section, and its cards have no `from`). Trashing a picked version takes its pick off
// (Trash.tsx), so the trash never holds the answer.
import { labels } from "./labels";
import { ITEM_HEAD, type Position } from "./layout";
import type { DirectAdd, DirectEdit } from "./registry-edit.ts";
import { type CanvasItem, type CanvasNote, type CanvasSection, SET_ASIDE_ID } from "./types";

/** Inside the set-aside frame: room around the items, and between them. */
const ASIDE_PAD = 24;
const ASIDE_GAP = 40;
/** Clear space between the lowest thing on the canvas and a new set-aside frame, its title tab included. */
const ASIDE_ROOM = 120;
/** A note's height when the registry gives none: enough for a few lines. */
const NOTE_HEIGHT_GUESS = 120;

/** The canvas as it is when the person picks, or sets an item aside from the trash. */
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
};

/** The versions `item` was compared with (see the top of this file), not counting itself. */
export function comparedWith(item: CanvasItem, { items, trash, sections: all, removed: gone, positions }: Omit<PickBoard, "notes">): CanvasItem[] {
  const visible = items.filter((entry) => !trash.includes(entry.id));
  const frames = all.filter((s) => !gone.has(`section:${s.id}`));
  const centreOf = (entry: CanvasItem) => {
    const p = positions[entry.id] ?? { x: entry.x, y: entry.y };
    return { x: p.x + entry.width / 2, y: p.y + (ITEM_HEAD + entry.height) / 2 };
  };
  const outermost = (entry: CanvasItem) => {
    const c = centreOf(entry);
    return frames
      .filter((f) => c.x >= f.x && c.x <= f.x + f.width && c.y >= f.y && c.y <= f.y + f.height)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0]?.id;
  };
  const home = outermost(item);
  const family = new Set([item.id]);
  // Linked by `from`, either way: walk until nothing new joins. Through the trash too, so a
  // version tidied away between two rounds still links them, as it does their path (lineage.ts).
  for (let grew = true; grew; ) {
    grew = false;
    for (const entry of items) {
      if (family.has(entry.id)) continue;
      const parent = entry.from && family.has(entry.from);
      const child = items.some((other) => family.has(other.id) && other.from === entry.id);
      if (parent || child) {
        family.add(entry.id);
        grew = true;
      }
    }
  }
  return visible.filter((entry) => entry.id !== item.id && (family.has(entry.id) || (home !== undefined && outermost(entry) === home)));
}

/**
 * Where an item from the trash goes when the person sets it aside from there, instead of
 * putting it back where it was: into the `set-aside` frame, at the right end of its row
 * (the frame grows to hold it), or into a new frame below everything. For a person who
 * drops versions into the trash and then wants one kept on the canvas as a record.
 */
export function planAside(
  item: CanvasItem,
  { items, trash, notes: noteList, sections: all, removed: gone, positions }: PickBoard,
): { place: Position; edits: DirectEdit[]; adds: DirectAdd[] } {
  const frames = all.filter((s) => !gone.has(`section:${s.id}`));
  const placeOf = (entry: CanvasItem): Position => positions[entry.id] ?? { x: entry.x, y: entry.y };
  const visible = items.filter((entry) => entry.id !== item.id && !trash.includes(entry.id));
  const height = ITEM_HEAD + item.height;
  const moved = (place: Position): DirectEdit => ({ kind: "item", id: item.id, set: { ...place, ...(item.picked ? { picked: false } : {}) } });
  const frame = frames.find((s) => s.id === SET_ASIDE_ID);
  if (frame) {
    const x = frame.x + frame.width - ASIDE_PAD + ASIDE_GAP;
    const place = { x: Math.round(x), y: Math.round(frame.y + ASIDE_PAD) };
    const grown = {
      width: Math.round(x + item.width + ASIDE_PAD - frame.x),
      height: Math.round(Math.max(frame.height, height + ASIDE_PAD * 2)),
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
  const place = { x: Math.round(x), y: Math.round(top) };
  const section: DirectAdd = {
    kind: "section",
    id: SET_ASIDE_ID,
    text: labels.setAside,
    x: place.x - ASIDE_PAD,
    y: place.y - ASIDE_PAD,
    width: item.width + ASIDE_PAD * 2,
    height: height + ASIDE_PAD * 2,
  };
  return { place, edits: [moved(place)], adds: [section] };
}
