// Alignment snapping for a dragged item. Pure math, in canvas units: the canvas
// measures the boxes and draws the guides.
//
// Why it exists: versions are compared side by side, and a row that is a few
// pixels off reads as a difference between the versions. While an item is
// dragged, its preview's edges and centre catch on the edges and centres of the
// other previews, and a guide line shows what it caught on.
//
// The boxes are the previews, not the whole item: an item with a caption has a
// taller head, so aligning whole items would leave the previews uneven.

export type Box = { x: number; y: number; w: number; h: number };

/** A guide line. `at` is its place across the axis; `from` and `to` are its ends along it. */
export type Guide = { at: number; from: number; to: number };

export type Snap = {
  /** How far to shift the dragged box so it aligns. 0 on an axis that caught nothing. */
  dx: number;
  dy: number;
  /** The vertical line (a shared x) and the horizontal line (a shared y) to draw, if any. */
  vertical?: Guide;
  horizontal?: Guide;
};

/** How near, in screen pixels, an edge must come before it catches. */
export const SNAP_DISTANCE = 6;

// Start, centre, and end of a box on one axis.
const lines = (start: number, size: number) => [start, start + size / 2, start + size];

function snapAxis(
  moving: Box,
  others: readonly Box[],
  reach: number,
  axis: "x" | "y",
): { shift: number; guide?: Guide } {
  const along = axis === "x" ? "y" : "x";
  const size = axis === "x" ? "w" : "h";
  const alongSize = axis === "x" ? "h" : "w";
  const mine = lines(moving[axis], moving[size]);
  let best: number | undefined;
  for (const other of others) {
    for (const theirs of lines(other[axis], other[size])) {
      for (const line of mine) {
        const shift = theirs - line;
        // The nearest line wins; on a tie the first found stays, so the result is stable while dragging.
        if (Math.abs(shift) <= reach && (best === undefined || Math.abs(shift) < Math.abs(best))) best = shift;
      }
    }
  }
  if (best === undefined) return { shift: 0 };
  // The guide runs through every box that shares the line, so it shows the whole row or column.
  const same = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const landed = lines(moving[axis] + best, moving[size]);
  const theirLines = (other: Box) => lines(other[axis], other[size]);
  // One guide per axis: the first of the dragged box's lines that met another box.
  const at = landed.find((line) => others.some((other) => theirLines(other).some((theirs) => same(theirs, line))));
  if (at === undefined) return { shift: best };
  const guide: Guide = { at, from: moving[along], to: moving[along] + moving[alongSize] };
  for (const other of others) {
    if (!theirLines(other).some((theirs) => same(theirs, at))) continue;
    guide.from = Math.min(guide.from, other[along]);
    guide.to = Math.max(guide.to, other[along] + other[alongSize]);
  }
  return { shift: best, guide };
}

/**
 * Where a dragged box should land. `reach` is the catching distance in canvas
 * units (SNAP_DISTANCE divided by the zoom, so it feels the same at any zoom).
 * `free` names the axes that may snap: an axis locked with Shift stays put.
 */
export function snapBox(
  moving: Box,
  others: readonly Box[],
  reach: number,
  free: { x: boolean; y: boolean } = { x: true, y: true },
): Snap {
  const x = free.x ? snapAxis(moving, others, reach, "x") : { shift: 0 };
  const y = free.y ? snapAxis(moving, others, reach, "y") : { shift: 0 };
  return { dx: x.shift, dy: y.shift, vertical: x.guide, horizontal: y.guide };
}
