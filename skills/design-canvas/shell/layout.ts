// Camera math and the saved layout. Only the camera, positions keyed by
// registry ID, and the trash are stored; names, sizes, and membership always
// come from source. On the dev server the registry holds the trash (`trashed`),
// so the browser keeps only its order and the items the registry could not take.

export type Camera = { x: number; y: number; z: number };
export type Position = { x: number; y: number };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
/**
 * The trash as this browser saved it. `ids`: most recent first; in a shared file,
 * the whole trash. `kept`: items the registry could not take, kept here instead.
 * `inRegistry`: this browser's trash has been written into the registry, so `ids`
 * is only its order. Without it, `ids` is a trash from an older shell, kept only
 * in the browser, to be written into the registry once.
 */
export type SavedTrash = { ids: string[]; kept: string[]; inRegistry: boolean };
const NO_TRASH: SavedTrash = { ids: [], kept: [], inRegistry: false };

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 3;
const COORD_LIMIT = 100_000;
const VERSION = 1;
const MAX_DOCUMENT = 20_000;
const MAX_POSITIONS = 200;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const inRange = (value: number) => Math.abs(value) <= COORD_LIMIT;

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/**
 * The levels the zoom buttons and the + and − keys step between, as design tools
 * do, so a press lands on 50% or 100% rather than 94% or 144%. Wheel and pinch
 * stay continuous. The ends are the zoom limits.
 */
export const ZOOM_STOPS = [ZOOM_MIN, 0.25, 0.5, 1, 2, ZOOM_MAX];

/** The next level above (direction 1) or below (-1) `z`; from between two levels, the nearer one in that direction. */
export function nextZoomStop(z: number, direction: 1 | -1): number {
  const margin = 0.005;
  const stops = direction > 0 ? ZOOM_STOPS : [...ZOOM_STOPS].reverse();
  const next = stops.find((stop) => (direction > 0 ? stop > z + margin : stop < z - margin));
  return next ?? stops[stops.length - 1]!;
}

export function sanitizeCamera(camera: Camera): Camera {
  const clamp = (v: number) => Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, finite(v) ? v : 0));
  return { x: clamp(camera.x), y: clamp(camera.y), z: clampZoom(finite(camera.z) ? camera.z : 1) };
}

export function sanitizePosition(position: Position): Position {
  const clamp = (v: number) => Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, finite(v) ? Math.round(v) : 0));
  return { x: clamp(position.x), y: clamp(position.y) };
}

/** Zoom by `factor`, keeping the canvas point under (px, py) fixed on screen. */
export function zoomAt(camera: Camera, factor: number, px: number, py: number): Camera {
  const z = clampZoom(camera.z * factor);
  const worldX = (px - camera.x) / camera.z;
  const worldY = (py - camera.y) / camera.z;
  return { x: px - worldX * z, y: py - worldY * z, z };
}

/** The camera that shows `bounds` whole and centred. `max` caps the zoom: fit all stops at 100%, a zoom to an area may go further. */
export function fitBounds(bounds: Bounds, width: number, height: number, padding = 48, max = 1): Camera {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const z = clampZoom(Math.min((width - padding * 2) / w, (height - padding * 2) / h, max));
  return {
    x: (width - w * z) / 2 - bounds.minX * z,
    y: (height - h * z) / 2 - bounds.minY * z,
    z,
  };
}

const validCamera = (value: unknown): Camera | undefined => {
  const c = value as Partial<Camera> | null;
  if (!c || !finite(c.x) || !finite(c.y) || !finite(c.z)) return undefined;
  if (!inRange(c.x) || !inRange(c.y) || c.z < ZOOM_MIN || c.z > ZOOM_MAX) return undefined;
  return { x: c.x, y: c.y, z: c.z };
};

const validPosition = (value: unknown): Position | undefined => {
  const p = value as Partial<Position> | null;
  if (!p || !finite(p.x) || !finite(p.y) || !inRange(p.x) || !inRange(p.y)) return undefined;
  return { x: p.x, y: p.y };
};

/** Reads the saved layout, keeping only valid values for current registry IDs. */
export function loadLayout(
  storageKey: string,
  ids: ReadonlySet<string>,
  themes: ReadonlySet<string> = new Set(),
): { camera?: Camera; positions: Record<string, Position>; theme?: string; trash: SavedTrash } {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw || raw.length > MAX_DOCUMENT) return { positions: {}, trash: NO_TRASH };
    const doc = JSON.parse(raw) as {
      version?: unknown;
      camera?: unknown;
      positions?: unknown;
      theme?: unknown;
      trash?: unknown;
      trashKept?: unknown;
      trashInRegistry?: unknown;
    };
    if (doc?.version !== VERSION) return { positions: {}, trash: NO_TRASH };
    const positions: Record<string, Position> = {};
    if (doc.positions && typeof doc.positions === "object") {
      const entries = Object.entries(doc.positions as Record<string, unknown>).slice(0, MAX_POSITIONS);
      for (const [id, value] of entries) {
        const position = ids.has(id) ? validPosition(value) : undefined;
        if (position) positions[id] = position;
      }
    }
    const theme = typeof doc.theme === "string" && themes.has(doc.theme) ? doc.theme : undefined;
    // Trashed item IDs. IDs no longer in the registry drop out.
    const idList = (value: unknown) =>
      Array.isArray(value)
        ? [...new Set(value.slice(0, MAX_POSITIONS).filter((id): id is string => typeof id === "string" && ids.has(id)))]
        : [];
    const trash = { ids: idList(doc.trash), kept: idList(doc.trashKept), inRegistry: doc.trashInRegistry === true };
    return { camera: validCamera(doc.camera), positions, theme, trash };
  } catch {
    return { positions: {}, trash: NO_TRASH };
  }
}

/** The saved theme alone, for frame pages that share the canvas storage. */
export function loadTheme(storageKey: string, themes: ReadonlySet<string>): string | undefined {
  return loadLayout(storageKey, new Set(), themes).theme;
}

export function saveLayout(
  storageKey: string,
  camera: Camera,
  positions: Record<string, Position>,
  theme?: string,
  trash: SavedTrash = NO_TRASH,
) {
  try {
    const doc = JSON.stringify({
      version: VERSION,
      camera,
      positions,
      theme,
      trash: trash.ids.length ? trash.ids : undefined,
      trashKept: trash.kept.length ? trash.kept : undefined,
      trashInRegistry: trash.inRegistry || undefined,
    });
    if (doc.length <= MAX_DOCUMENT) window.localStorage.setItem(storageKey, doc);
  } catch {
    // Storage may be unavailable or full; the canvas keeps working without it.
  }
}
