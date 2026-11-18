// A pin is placed at a point in its item, but it is about an element. When the
// item is resized the layout moves, and the element with it, while the point
// stays: the pin ends up on something else. So each pin is kept on its element,
// at the same place within it. The element is found from the pin's reference
// (dom.ts findDescribed), once, while the layout still matches the point, and
// followed from then on. A whole-item note keeps covering the whole item. A
// drawn area, and a pin whose element can no longer be found (its words
// changed), stay where they are, as before.
import { type Dispatch, type SetStateAction, useLayoutEffect, useRef, useState } from "react";
import { type Annotation, sectionOf } from "./annotations";
import { shared } from "./bridge";
import { findDescribed } from "./dom";
import type { CanvasItem } from "./types";

// How long until a pin's element is looked for again, and how many times in a row.
const ANCHOR_RETRY_MS = 400;
const ANCHOR_RETRIES = 6;

export function usePinAnchors({
  annotations,
  annotationsRef,
  setAnnotations,
  items,
  worldRef,
}: {
  annotations: Annotation[];
  annotationsRef: { current: Annotation[] };
  setAnnotations: Dispatch<SetStateAction<Annotation[]>>;
  items: CanvasItem[];
  worldRef: { readonly current: HTMLElement | null };
}) {
  const anchors = useRef(new Map<string, { element: Element; fx: number; fy: number }>());
  // A pin whose element is not there yet (its frame is still loading) or is gone. Each look
  // reads the whole item, so it is tried again a few times, and after that only now and then.
  const misses = useRef(new Map<string, { at: number; count: number }>());
  const anchoredItems = useRef<CanvasItem[] | null>(null);
  const [settle, setSettle] = useState(0);
  useLayoutEffect(() => {
    const world = worldRef.current;
    if (!world || shared) return;
    const live = new Set(annotations.map((a) => a.id));
    for (const id of anchors.current.keys()) if (!live.has(id)) anchors.current.delete(id);
    for (const id of misses.current.keys()) if (!live.has(id)) misses.current.delete(id);
    const now = performance.now();
    // A framed item lays out again a moment after its new size is saved, in its own
    // document, and nothing here hears of it: so every change of the items is followed by one more look.
    let again = anchoredItems.current !== items;
    anchoredItems.current = items;
    let moved = false;
    const next = annotations.map((a) => {
      if (sectionOf(a) !== null) return a;
      const item = items.find((entry) => entry.id === a.itemId);
      const preview = world.querySelector<HTMLElement>(`[data-canvas-preview="${CSS.escape(a.itemId)}"]`);
      if (!item || !preview) return a;
      if (a.w && a.h) {
        if (a.ref !== item.name) return a;
        const [w, h] = [preview.offsetWidth, preview.offsetHeight];
        if (Math.abs(a.w - w) < 1 && Math.abs(a.h - h) < 1) return a;
        moved = true;
        return { ...a, w, h };
      }
      const prefix = `${item.name} › `;
      if (!a.ref.startsWith(prefix)) return a;
      // Where the item's content is, and how client pixels turn into the item's own units.
      // A frame's own pixels already are those units (see the "annotate" message).
      const frame = preview.querySelector<HTMLIFrameElement>("iframe[data-canvas-frame]");
      let root: Element | null = preview;
      let origin = { x: 0, y: 0 };
      let scale = 1;
      if (frame) {
        try {
          // The whole body, as the frame named the element (FrameHost.tsx): a dialog the item
          // portaled there holds elements of the item too, and look-alikes are numbered across both.
          root = frame.contentDocument?.querySelector(".canvas-frame-root") ? frame.contentDocument.body : null;
        } catch {
          root = null;
        }
      } else {
        const box = preview.getBoundingClientRect();
        origin = { x: box.left, y: box.top };
        scale = box.width / Math.max(1, preview.offsetWidth);
      }
      const boxOf = (element: Element) => {
        const r = element.getBoundingClientRect();
        return { x: (r.left - origin.x) / scale, y: (r.top - origin.y) / scale, w: r.width / scale, h: r.height / scale };
      };
      let anchor = anchors.current.get(a.id);
      if (anchor && !root?.contains(anchor.element)) anchor = undefined;
      if (!anchor) {
        const miss = misses.current.get(a.id);
        const fresh = !!miss && now - miss.at < ANCHOR_RETRY_MS - 50;
        const element = root && !fresh ? findDescribed(root, a.ref.slice(prefix.length)) : null;
        if (!element) {
          const count = fresh ? miss.count : (miss?.count ?? 0) + 1;
          if (!fresh) misses.current.set(a.id, { at: now, count });
          if (count < ANCHOR_RETRIES) again = true;
          return a;
        }
        misses.current.delete(a.id);
        const box = boxOf(element);
        // Where in its element the pin sits. One found outside it (the layout moved before anyone looked) goes to its middle.
        const inside = a.x >= box.x - 2 && a.x <= box.x + box.w + 2 && a.y >= box.y - 2 && a.y <= box.y + box.h + 2;
        anchor = { element, fx: inside && box.w ? (a.x - box.x) / box.w : 0.5, fy: inside && box.h ? (a.y - box.y) / box.h : 0.5 };
        anchors.current.set(a.id, anchor);
      }
      const box = boxOf(anchor.element);
      const x = Math.round(box.x + anchor.fx * box.w);
      const y = Math.round(box.y + anchor.fy * box.h);
      if (Math.abs(x - a.x) <= 1 && Math.abs(y - a.y) <= 1) return a;
      moved = true;
      return { ...a, x, y };
    });
    const timer = again ? window.setTimeout(() => setSettle((n) => n + 1), ANCHOR_RETRY_MS) : 0;
    if (moved) {
      annotationsRef.current = next;
      setAnnotations(next);
    }
    return () => window.clearTimeout(timer);
  }, [annotations, items, settle]);
}
