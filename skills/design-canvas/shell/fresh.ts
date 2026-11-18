// Fresh tags: an item the agent added or changed that the person has not seen yet. New
// items no longer pull the view to them, so they say so where they are until they have
// been on screen, at a readable size, for a moment.
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { shared } from "./bridge";

export type Fresh = "new" | "updated";
const SEEN_MS = 2000;
/** On screen at least this wide, in px, to count as seen. */
const SEEN_WIDTH = 120;
const freshKey = (storageKey: string) => `${storageKey}:fresh`;
function loadFresh(storageKey: string, ids: ReadonlySet<string>): Record<string, Fresh> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(freshKey(storageKey)) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(raw).filter((entry): entry is [string, Fresh] => ids.has(entry[0]) && (entry[1] === "new" || entry[1] === "updated")),
    );
  } catch {
    return {};
  }
}
function saveFresh(storageKey: string, fresh: Record<string, Fresh>) {
  try {
    if (Object.keys(fresh).length) window.localStorage.setItem(freshKey(storageKey), JSON.stringify(fresh));
    else window.localStorage.removeItem(freshKey(storageKey));
  } catch {
    // Storage may be unavailable; the tags still work for this session.
  }
}

/** The tags, kept in this browser, and the check that takes one off once its item has been seen. */
export function useFresh(
  storageKey: string,
  ids: ReadonlySet<string>,
  viewportRef: { readonly current: HTMLElement | null },
  elements: { readonly current: Map<string, HTMLElement> },
): [Record<string, Fresh>, Dispatch<SetStateAction<Record<string, Fresh>>>] {
  const [fresh, setFresh] = useState<Record<string, Fresh>>(() => (shared ? {} : loadFresh(storageKey, ids)));
  useEffect(() => {
    if (!shared) saveFresh(storageKey, fresh);
  }, [fresh, storageKey]);
  // Seen: on screen, at a readable size, for SEEN_MS while the page is in front.
  // Checked once a second, which also follows pans and zooms without listening to them.
  useEffect(() => {
    if (!Object.keys(fresh).length) return;
    const since = new Map<string, number>();
    const check = () => {
      const view = viewportRef.current?.getBoundingClientRect();
      if (!view || document.visibilityState !== "visible") return since.clear();
      const now = performance.now();
      const seen: string[] = [];
      for (const id of Object.keys(fresh)) {
        const box = elements.current.get(id)?.getBoundingClientRect();
        const visibleW = box ? Math.min(box.right, view.right) - Math.max(box.left, view.left) : 0;
        const visibleH = box ? Math.min(box.bottom, view.bottom) - Math.max(box.top, view.top) : 0;
        const onScreen = !!box && box.width >= SEEN_WIDTH && visibleW >= box.width / 2 && visibleH >= box.height / 2;
        if (!onScreen) since.delete(id);
        else if (!since.has(id)) since.set(id, now);
        else if (now - since.get(id)! >= SEEN_MS) seen.push(id);
      }
      if (seen.length) setFresh((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !seen.includes(id))));
    };
    check();
    const timer = window.setInterval(check, 500);
    return () => window.clearInterval(timer);
  }, [fresh]);
  return [fresh, setFresh];
}
