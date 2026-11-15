import { useContext } from "react";
import { BACK_EVENT, NAVIGATE_EVENT } from "../canvas/bridge";
import { RouteContext } from "../canvas/routes";

// next/navigation on the canvas: router calls stay on the canvas. A path that an item
// shows (its `path` or one of its `screens`, see canvas/routes.ts) goes to that screen;
// any other path shows a notice. The location is the path of the item around the component.
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
export const useSearchParams = () => new URLSearchParams();
export const useParams = () => ({});
export const useSelectedLayoutSegment = () => null;
export const useSelectedLayoutSegments = () => [];
export const redirect = navigate;
export const permanentRedirect = navigate;
export const notFound = () => {};
