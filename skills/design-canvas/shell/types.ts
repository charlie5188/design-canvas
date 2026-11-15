import type { ComponentType } from "react";

export type CanvasItem = {
  /** Stable key for saved positions and frame URLs. Never shown. */
  id: string;
  /** Readable, unique name shown above the preview and copied on click. */
  name: string;
  /** Optional one line on what this version decides. */
  note?: string;
  component: ComponentType;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Render in its own frame so media queries, `window` size, and breakpoints
   * see `width` × `height` instead of the whole browser window. Use for
   * mobile or desktop previews and anything responsive.
   */
  viewport?: boolean;
  /**
   * The path this item shows, as the app's own links name it, for example
   * "/checkout". It is the path of `component`, for a router stand-in's
   * `usePathname`, and where a link that opens a new tab in the product
   * (`target="_blank"`) to this path brings the view. `[id]` or `:id` stands for
   * any one segment: "/orders/[id]".
   */
  path?: string;
  /**
   * More screens in this item, by path: a whole flow in one frame. `component`
   * is the first one (at `path`); a link or a router call inside the item to one
   * of these paths shows that screen in place, as a click in the product stays
   * in its tab, and Restart returns to the first. A path the item does not have
   * shows a notice: a click never moves the view to another item.
   * `{ "/checkout": Checkout, "/done": Done }`
   */
  screens?: Record<string, ComponentType>;
  /**
   * The id of the item this one is a new version of. The canvas places it
   * beside that item, and its arrival clears that item's sent "new version"
   * annotations.
   */
  from?: string;
  /**
   * In the canvas trash: hidden on the canvas, its code kept. The canvas writes
   * it when the person moves the item to the trash and removes it when they put
   * the item back, so the shared file and the next session start with the same trash.
   */
  trashed?: boolean;
  /**
   * The version the person chose. The canvas writes it when they pick an item
   * (and moves the versions it was compared with into the `set-aside` section),
   * and removes it on Undo or when they pick another one. It shows as a mark on
   * the item, in the shared file too, so a reader sees which version won.
   */
  picked?: boolean;
};

/**
 * A sticky note that explains something to whoever opens the canvas or its
 * shared file, for example why a version was dropped. Fixed on the canvas:
 * the agent places and edits it in source.
 */
export type CanvasNote = {
  id: string;
  text: string;
  x: number;
  y: number;
  /** Defaults to 220. */
  width?: number;
  /** A minimum: the note grows when its text needs more room. */
  height?: number;
};

/**
 * A titled frame behind the items it surrounds, for grouping, for example the
 * versions that were set aside. Items keep their own positions: a section only
 * draws the frame, so the agent places items inside its bounds.
 */
export type CanvasSection = {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
