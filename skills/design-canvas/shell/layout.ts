// Camera math and the saved layout. Only the camera and positions keyed by
// registry ID are stored; names, sizes, and membership always come from source.

export type Camera = { x: number; y: number; z: number };
export type Position = { x: number; y: number };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 3;
const COORD_LIMIT = 100_000;
const VERSION = 1;
const MAX_DOCUMENT = 20_000;
const MAX_POSITIONS = 200;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const inRange = (value: number) => Math.abs(value) <= COORD_LIMIT;

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

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

export function fitBounds(bounds: Bounds, width: number, height: number, padding = 48): Camera {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const z = clampZoom(Math.min((width - padding * 2) / w, (height - padding * 2) / h, 1));
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
): { camera?: Camera; positions: Record<string, Position>; theme?: string } {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw || raw.length > MAX_DOCUMENT) return { positions: {} };
    const doc = JSON.parse(raw) as { version?: unknown; camera?: unknown; positions?: unknown; theme?: unknown };
    if (doc?.version !== VERSION) return { positions: {} };
    const positions: Record<string, Position> = {};
    if (doc.positions && typeof doc.positions === "object") {
      const entries = Object.entries(doc.positions as Record<string, unknown>).slice(0, MAX_POSITIONS);
      for (const [id, value] of entries) {
        const position = ids.has(id) ? validPosition(value) : undefined;
        if (position) positions[id] = position;
      }
    }
    const theme = typeof doc.theme === "string" && themes.has(doc.theme) ? doc.theme : undefined;
    return { camera: validCamera(doc.camera), positions, theme };
  } catch {
    return { positions: {} };
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
) {
  try {
    const doc = JSON.stringify({ version: VERSION, camera, positions, theme });
    if (doc.length <= MAX_DOCUMENT) window.localStorage.setItem(storageKey, doc);
  } catch {
    // Storage may be unavailable or full; the canvas keeps working without it.
  }
}
