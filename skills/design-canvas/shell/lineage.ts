// Where a new version lands. Versions made from the same item (`from`) are one
// round of options, so they share one row, right under the item they came from.
// The canvas then reads as a tree that grows downward: each row is one comparison,
// and the next round, made from the version the person liked, starts under it.
// Nobody arranges anything by hand, and existing items never move.
import type { CanvasItem } from "./types";

/** A box in canvas units, caption included. `lift` is the caption's height above the item's position. */
export type Box = { x: number; y: number; w: number; h: number; lift: number };
export type Rect = { x: number; y: number; w: number; h: number };

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The top-left of a new version's box.
 *
 * - `origin`: the item it was made from.
 * - `siblings`: the versions already made from that item (not counting any set aside).
 * - `size`: the new version's box; only `w`, `h`, and `lift` are read.
 * - `taken`: everything it must not cover: other items, notes, and sections it does not belong in.
 *
 * The first version of a round goes under its original, left edges lined up. Each
 * later one goes right of the last version in that row, its preview level with theirs.
 * A spot that is taken moves on: along the row for a later version, so the round stays
 * one row, and down for a first one, so it stays under its original.
 */
export function versionSpot(origin: Box, siblings: Box[], size: Box, taken: Rect[], gap: number): { x: number; y: number } {
  const levelOf = (b: Box) => b.y + b.lift;
  const along = siblings.length > 0;
  const box: Rect = { x: origin.x, y: origin.y + origin.h + gap, w: size.w, h: size.h };
  if (along) {
    // The newest row: the lowest one, should the person have spread the round over two.
    const level = Math.max(...siblings.map(levelOf));
    const row = siblings.filter((b) => Math.abs(levelOf(b) - level) <= 8);
    const last = row.reduce((a, b) => (b.x + b.w > a.x + a.w ? b : a));
    box.x = last.x + last.w + gap;
    box.y = level - size.lift;
  }
  // Bounded, so a canvas full of odd shapes still gives an answer.
  for (let i = 0; i < 200; i++) {
    const hit = taken.find((other) => overlaps(box, other));
    if (!hit) break;
    if (along) box.x = hit.x + hit.w + gap;
    else box.y = hit.y + hit.h + gap;
  }
  return { x: box.x, y: box.y };
}

/** One step of a path: the item a version was made from, and the version. */
export type Step = { from: CanvasItem; to: CanvasItem };

/**
 * The paths from each picked version back to the item its exploration started from,
 * following `from` through every round, as steps from parent to child, each step once.
 * Only `shown` items take part: a step stops at an item in the trash or gone.
 */
export function pickedPaths(shown: CanvasItem[], isPicked: (item: CanvasItem) => boolean): Step[] {
  const byId = new Map(shown.map((item) => [item.id, item]));
  const steps: Step[] = [];
  const seen = new Set<string>();
  for (const pick of shown.filter(isPicked)) {
    let child = pick;
    const visited = new Set([child.id]);
    for (let parent = child.from ? byId.get(child.from) : undefined; parent && !visited.has(parent.id); parent = parent.from ? byId.get(parent.from) : undefined) {
      const key = `${parent.id}>${child.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        steps.push({ from: parent, to: child });
      }
      visited.add(parent.id);
      child = parent;
    }
  }
  return steps;
}
