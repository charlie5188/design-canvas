import { useContext } from "react";
import { BACK_EVENT, NAVIGATE_EVENT } from "../bridge";
import { LocationContext, RouteContext } from "../routes";

// next/navigation on the canvas: router calls stay on the canvas. A path that an item
// shows (its `path` or one of its `screens`, see canvas/routes.ts) goes to that screen;
// any other path shows a notice. The location is that of the item around the component:
// its path, its query (a filter kept in the URL works), and its screen's `[param]` values.
const navigate = (href: unknown) => {
  window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: String(href) }));
};
const router = {
  push: navigate,
  replace: navigate,
  prefetch: () => {},
  back: () => {
    window.dispatchEvent(new Event(BACK_EVENT));
  },
  forward: () => {},
  refresh: () => {},
};

export const useRouter = () => router;
export const usePathname = () => useContext(RouteContext) ?? "/";
export const useSearchParams = () => new URLSearchParams(useContext(LocationContext)?.search ?? "");
export const useParams = () => useContext(LocationContext)?.params ?? {};
export const useSelectedLayoutSegment = () => null;
export const useSelectedLayoutSegments = () => [];
export const redirect = navigate;
export const permanentRedirect = navigate;
export const notFound = () => {};
export const RedirectType = { push: "push", replace: "replace" } as const;
