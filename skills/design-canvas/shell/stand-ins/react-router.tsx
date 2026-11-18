import { type ReactNode, useContext, useMemo } from "react";
// @ts-ignore: in an app without React Router this file is never loaded, and the import has nothing to find.
import { createPath, type Navigator, Route, Router, Routes, type To } from "react-router";
import { BACK_EVENT, NAVIGATE_EVENT } from "../bridge";
import { LocationContext } from "../routes";

// React Router on the canvas. Its <Link> and hooks need a router around them, and an item
// stands for a browser tab, so each screen gets its own: React Router's plain <Router>, whose
// location is the item's (path, query, and the `[param]` values of its screen) and whose
// navigation goes to the canvas, as next/navigation's stand-in does. A link or navigate() to a
// path the item shows changes the screen in place; any other path shows a notice; navigate(-1)
// goes back. providers.tsx sets it through ScreenRouter (canvas/routes.ts); the installer does
// that when the app depends on React Router.
// Not here: a data router's loaders and actions (useLoaderData), which would reach the real
// backend. Pass that data to the screen as props instead.
const go = (to: To) => {
  window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: typeof to === "string" ? to : createPath(to) }));
};
const navigator: Navigator = {
  createHref: (to: To) => (typeof to === "string" ? to : createPath(to)),
  push: go,
  replace: go,
  go: (delta: number) => {
    if (delta < 0) window.dispatchEvent(new Event(BACK_EVENT));
  },
};

/** React Router's form of a canvas path pattern: `[id]` is `:id`, `[...rest]` is `*`. */
const routePattern = (pattern: string) => pattern.replace(/\[\.\.\.[^\]]+\]/g, "*").replace(/\[([^\]]+)\]/g, ":$1");

export function CanvasRouter({ children }: { children: ReactNode }) {
  const here = useContext(LocationContext);
  const location = useMemo(
    () => ({ pathname: here?.path || "/", search: here?.search ? `?${here.search}` : "", hash: "", state: null, key: "canvas" }),
    [here?.path, here?.search],
  );
  return (
    <Router location={location} navigator={navigator}>
      {/* A route for the screen's own pattern, so useParams() names its parts as the app's routes do. */}
      <Routes>
        <Route path={here?.pattern ? routePattern(here.pattern) : "*"} element={children} />
      </Routes>
    </Router>
  );
}
