// Paths: how a link or a router call in an item's real code finds where it goes on the canvas.
//
// A product's screens point at each other by path: `<a href="/checkout">`, `router.push("/done")`.
// On the canvas nothing may navigate the page away, so until now every such link stopped with a
// notice, and a flow worked only when the agent rewrote its links by hand. That made every
// version less like the product, and cost work on each one.
//
// Now an item says which path it shows (`path`), and may hold more screens by path (`screens`).
// The rule follows the product: there, a click stays in the same browser tab unless the
// link opens a new one. An item's frame stands for a tab. So:
//   - A link or a router call stays in the item it is in. A path that is one of the item's
//     screens shows in place. A path the item does not have shows a notice, and nothing moves.
//   - Only a link that opens a new tab in the product (`target="_blank"`) leaves the item. The
//     view jumps to the nearest other item that shows that path and puts it in the middle, as
//     a new tab takes the person's attention, and the item the link was in stays as it is.
//     With no such item, a notice.
// An earlier version sent every unknown path to any other item that showed it. A click then
// sometimes changed the frame and sometimes moved the view, for no reason the person could
// see, and with several versions on the canvas it could land in another version's item.
//
// Who does what: Canvas.tsx resolves links for plain items and between items (`followLink`);
// FrameHost.tsx resolves a `viewport` item's own screens inside its frame, and hands the rest
// to the canvas. Both keep a short history per item, for a router's `back()`. Restart returns
// an item to its first screen. Nothing here is saved: a reload starts every item at its start.
import { type ComponentType, createContext } from "react";
import type { CanvasItem } from "./types";

/**
 * The path that the item around a component shows now, for a router stand-in's
 * `usePathname` (kits/react-vite/mocks/next-navigation.ts). Null where the item names no path.
 */
export const RouteContext = createContext<string | null>(null);

const tidy = (path: string) => path.replace(/\/+$/, "") || "/";

/** Whether the product would open this link in a new browser tab. */
export const opensNewTab = (anchor: Element) => {
  const target = anchor.getAttribute("target");
  return !!target && target !== "_self";
};
const ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The path a link names on this site, without its query and hash. Null for another site,
 * and for a link that only names a place in the page (`#…`).
 * It does not lean on the page's own address: a shared file is opened from disk, and its
 * frames have no address at all.
 */
export function pathOf(href: string): string | null {
  if (!href || href.startsWith("#") || href.startsWith("//")) return null;
  try {
    if (ABSOLUTE.test(href)) {
      const url = new URL(href);
      return url.origin !== "null" && url.origin === window.location.origin ? tidy(decodeURIComponent(url.pathname)) : null;
    }
    return tidy(decodeURIComponent(new URL(href, "http://canvas.invalid/").pathname));
  } catch {
    return null;
  }
}

/** Whether `pattern` (an item's `path`, or a key of its `screens`) names `path`. `[id]` and `:id` stand for any one segment. */
function names(pattern: string, path: string, exact: boolean): boolean {
  const want = tidy(pattern).split("/");
  const have = tidy(path).split("/");
  return want.length === have.length && want.every((part, index) => part === have[index] || (!exact && (/^\[[^\]]+\]$/.test(part) || part.startsWith(":"))));
}

/**
 * The component `item` shows at `path`: its own for its `path`, or one of its `screens`.
 * Undefined when the item does not show that path. A path written out wins over one with a
 * `[param]` in it.
 */
export function screenAt(item: CanvasItem, path: string): ComponentType | undefined {
  const all: [string, ComponentType][] = [...(item.path ? ([[item.path, item.component]] as [string, ComponentType][]) : []), ...Object.entries(item.screens ?? {})];
  return (all.find(([pattern]) => names(pattern, path, true)) ?? all.find(([pattern]) => names(pattern, path, false)))?.[1];
}
