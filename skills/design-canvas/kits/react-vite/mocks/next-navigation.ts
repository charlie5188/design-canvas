import { NAVIGATE_EVENT } from "../canvas/bridge";

// next/navigation on the canvas: a fixed location, and router calls that stay
// on the canvas with a notice instead of navigating.
const navigate = (href: unknown) => {
  window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: String(href) }));
};
const router = {
  push: navigate,
  replace: navigate,
  prefetch: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
};

export const useRouter = () => router;
export const usePathname = () => "/";
export const useSearchParams = () => new URLSearchParams();
export const useParams = () => ({});
export const useSelectedLayoutSegment = () => null;
export const useSelectedLayoutSegments = () => [];
export const redirect = navigate;
export const permanentRedirect = navigate;
export const notFound = () => {};
