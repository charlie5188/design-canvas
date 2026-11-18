// Links and router calls inside items: which screen each item shows, and where a link takes the view.
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { postToFrame } from "./bridge";
import { controlWords, type FlowStep } from "./FlowView";
import { labels } from "./labels";
import type { Position } from "./layout";
import { linkName, locationOf, pathPart, screenAt, screenIndex, searchPart } from "./routes";
import type { CanvasItem } from "./types";

/** What following a link uses of the board. */
type LinksBoard = {
  /** The items on the canvas, the trash left out. */
  shown: CanvasItem[];
  setFrontId: Dispatch<SetStateAction<string | null>>;
  /** The item last touched: where a router call came from, since the call itself does not say. */
  frontIdRef: { readonly current: string | null };
  positionsRef: { readonly current: Record<string, Position> };
  worldRef: { readonly current: HTMLElement | null };
  reveal: (targets: CanvasItem[], centre?: boolean) => void;
  notify: (text: string) => void;
};

export function useLinks({ shown, setFrontId, frontIdRef, positionsRef, worldRef, reveal, notify }: LinksBoard) {
  // The paths each plain item went through, newest last (routes.ts). An item with no entry,
  // or an empty one, shows its first screen. A `viewport` item keeps its own, in its frame.
  const [routes, setRoutes] = useState<Record<string, string[]>>({});
  const restartRoute = useCallback((id: string) => setRoutes((was) => (was[id]?.length ? { ...was, [id]: [] } : was)), []);
  const routesRef = useRef(routes);
  routesRef.current = routes;
  // The steps the person made in each item, which give the flow view (FlowView.tsx) arrows
  // that a screen's links cannot (a router call in a click handler).
  const [steps, setSteps] = useState<Record<string, FlowStep[]>>({});
  // The control last pressed in an item, so a step it makes can be named on its arrow: click "Pay".
  // A router call does not say what started it; a press just before it did.
  const lastPress = useRef<{ id: string; words?: string; at: number } | null>(null);
  // The item a link led to shows a ring for a moment. When that item is already in view the
  // camera does not move, and without this nothing on the canvas would say where the link went.
  // Set on the element itself: it is over in a second, and no state needs to follow it.
  const arrive = useCallback((id: string) => {
    const element = worldRef.current?.querySelector<HTMLElement>(`[data-canvas-item="${CSS.escape(id)}"]`);
    if (!element) return;
    element.removeAttribute("data-arrived");
    // Read once, so a second arrival starts the ring again.
    void element.offsetWidth;
    element.setAttribute("data-arrived", "");
    window.setTimeout(() => element.removeAttribute("data-arrived"), 1000);
  }, []);

  /**
   * Where a link or a router call goes (routes.ts). `#<id>` reveals that item. A path stays
   * in the item it came from: one of that item's screens shows in place, and any other path
   * shows a notice. Only a link that opens a new tab in the product (`blank`) leaves the
   * item: the view goes to the nearest other item that shows the path.
   * `fromId` is the item the link was in; a router call does not say, so the item last
   * touched stands for it.
   */
  const followLink = useCallback(
    (href: string, fromId?: string, blank = false) => {
      if (href.startsWith("#")) {
        const target = shown.find((item) => item.id === decodeURIComponent(href.slice(1)));
        if (target) {
          setFrontId(target.id);
          reveal([target]);
        }
        return;
      }
      const named = linkName(href);
      if (named === null) return;
      const from = shown.find((item) => item.id === (fromId ?? frontIdRef.current));
      // Where the link goes, with its query (`?status=signed`), as the item will remember it.
      // A query alone (`router.push("?status=signed")`) stays on the screen the item shows.
      const here = from ? (routesRef.current[from.id]?.[routesRef.current[from.id]!.length - 1] ?? from.start ?? from.path ?? "/") : "/";
      const location = locationOf(href, here);
      const path = location && pathPart(location);
      if (!location || !path) return notify(blank ? labels.newTabBlocked(named) : labels.linkBlocked(named));
      // An item at its start that is sent to its start, with no other query, has gone
      // nowhere: nothing is noted, so it does not offer Restart for it. The start is its
      // first screen, or `start` when the agent set one (types.ts).
      const push = (item: CanvasItem) =>
        setRoutes((was) => {
          const stack = was[item.id] ?? [];
          const first = !stack.length && (item.start ? location === item.start : screenAt(item, path) === item.component && !searchPart(location));
          if (stack[stack.length - 1] === location || first) return was;
          return { ...was, [item.id]: [...stack, location] };
        });
      if (!blank) {
        // The same tab: a screen of this item, in place. A frame shows its own screens itself,
        // so a path that reaches here from one is not its own.
        if (from && !from.viewport && screenAt(from, path)) {
          const stack = routesRef.current[from.id] ?? [];
          const was = Math.max(0, screenIndex(from, stack[stack.length - 1] ?? from.start ?? from.path ?? ""));
          const to = screenIndex(from, path);
          const press = lastPress.current;
          const label = press && press.id === from.id && performance.now() - press.at < 1500 ? press.words : undefined;
          if (to !== was)
            setSteps((all) => {
              const list = all[from.id] ?? [];
              const known = list.find((s) => s.from === was && s.to === to);
              if (known && (known.label || !label)) return all;
              return { ...all, [from.id]: [...list.filter((s) => s !== known), { from: was, to, label }] };
            });
          return push(from);
        }
        return notify(from && (from.path || from.screens) ? labels.screenMissing(named) : labels.linkBlocked(named));
      }
      // A new tab: another item that shows the path, the nearest one, since several versions
      // of a flow can each show the same path, and the one meant is the one beside the link.
      const centre = (item: CanvasItem) => {
        const at = positionsRef.current[item.id] ?? item;
        return { x: at.x + item.width / 2, y: at.y + item.height / 2 };
      };
      const origin = from && centre(from);
      const away = (item: CanvasItem) => (origin ? Math.hypot(centre(item).x - origin.x, centre(item).y - origin.y) : 0);
      const target = shown.filter((item) => item.id !== from?.id && screenAt(item, path)).sort((a, b) => away(a) - away(b))[0];
      if (!target) return notify(labels.newTabBlocked(named));
      setFrontId(target.id);
      reveal([target], true);
      arrive(target.id);
      // Noted for a frame too, though the frame shows its screens itself: it is how the item knows to offer Restart.
      push(target);
      if (!target.viewport) return;
      const frame = worldRef.current?.querySelector<HTMLIFrameElement>(`iframe[data-canvas-frame="${CSS.escape(target.id)}"]`);
      if (frame?.contentWindow) postToFrame(frame.contentWindow, { type: "screen", path: location });
    },
    [arrive, notify, reveal, shown],
  );

  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    const onPress = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !world.contains(target)) return;
      const id = target.closest<HTMLElement>("[data-canvas-item]")?.dataset.canvasItem;
      if (id) lastPress.current = { id, words: controlWords(target), at: performance.now() };
    };
    // Capture on window, registered before the link handler below (also window capture):
    // a link's step is made in that handler, so the press must be noted first. On the
    // world it ran after it, and a link step took the words of the press before it.
    window.addEventListener("click", onPress, true);
    return () => window.removeEventListener("click", onPress, true);
  }, []);
  return { routes, setRoutes, restartRoute, steps, followLink };
}
