// The canvas's reference images (types.ts, CanvasImage): the entries in registry.tsx and
// the files in the canvas's images/ folder.
//
// The page does not import them. main.tsx belongs to each canvas and an update leaves it
// alone, so a canvas made before images existed would never pass them in, and its
// registry.tsx has no `images` until the first one is added. So the page asks the dev
// server, which reads the entries from the registry's text (registry-edit.ts, listImages)
// and serves the files from the canvas folder. A shared file has no server: its build
// writes the list into the page, each picture as a data URL (share.config.mts).
import { useSyncExternalStore } from "react";
import { shared } from "./bridge";
import { IMAGE_PATH } from "./channel.ts";
import type { CanvasImage } from "./types";

/** `images`: what the registry lists, in its order. `urls`: where the page loads each file from, by file name. */
export type CanvasImages = { images: CanvasImage[]; urls: Record<string, string> };
/** What a shared file's build leaves on the page. */
type Built = (CanvasImage & { url: string })[];

const built = (globalThis as typeof globalThis & { __designCanvasImages?: Built }).__designCanvasImages;
let now: CanvasImages =
  shared && Array.isArray(built)
    ? { images: built.map(({ url: _url, ...image }) => image), urls: Object.fromEntries(built.map((image) => [image.file, image.url])) }
    : { images: [], urls: {} };
let print = "";
const listeners = new Set<() => void>();

/**
 * Asks the dev server for the list again. The canvas calls it when it opens, whenever the
 * registry changes under it, and after it adds an image itself. Nothing changes, and
 * nothing draws again, when the list is the same.
 */
export async function refreshImages(): Promise<void> {
  if (shared) return;
  try {
    const response = await fetch(IMAGE_PATH, { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const { images } = (await response.json()) as { images?: CanvasImage[] };
    if (!Array.isArray(images)) return;
    const next = JSON.stringify(images);
    if (next === print) return;
    print = next;
    // Relative to the page, which the dev server serves from the canvas folder.
    now = { images, urls: Object.fromEntries(images.map((image) => [image.file, `images/${image.file}`])) };
    for (const listener of listeners) listener();
  } catch {
    // No dev server, or one started before the canvas had images: the canvas shows none.
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const read = () => now;

/** The images and their files as they are now; the canvas draws again when the list changes. */
export const useCanvasImages = (): CanvasImages => useSyncExternalStore(subscribe, read, read);
