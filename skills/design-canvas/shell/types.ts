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
   * The screen the item opens at, when the comparison is about a later step of its
   * flow: one of its `screens` paths, with a query if it needs one
   * ("/checkout?plan=pro"). The canvas, a reload, Restart, and the item's own page
   * all start there; the flow view still lays out every screen from the first.
   * Written by the agent for a "Start here" note (SKILL.md).
   */
  start?: string;
  /**
   * More states of a screen, by the screen's path and then by name: empty, an error, loading,
   * a long name. They are part of this item, not versions of it: the flow view shows them on
   * their screen, to switch between, and the canvas shows only the first state. The item's own
   * screen is listed by its `path`, or by "" when it names none: `{ "": { Empty: ListEmpty } }`.
   * `{ "/checkout": { Empty: CheckoutEmpty, "Card error": CheckoutError } }`
   */
  states?: Record<string, Record<string, ComponentType>>;
  /**
   * The steps between screens that code makes, not a link: a router call in a click or submit
   * handler. By the screen's path, then by the words on the control, to the path it leads to.
   * The flow view reads links from the screens by itself, but cannot see where a handler goes
   * until someone presses it; named here, its arrow is there from the start, and the layout does
   * not change after a first try. The item's own screen is listed by its `path`, or by "".
   * `{ "/checkout": { Pay: "/done" }, "/upload": { "Start review": "/contracts/1" } }`
   */
  steps?: Record<string, Record<string, string>>;
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

/**
 * A reference image on the canvas: a screenshot, a sketch, another product's screen.
 * The person pastes or drops it, and the canvas writes the file into the canvas's
 * `images/` folder and the entry into `registry.tsx`, moves and resizes included.
 * The agent can read the file like any other, and may add one the same way.
 */
export type CanvasImage = {
  id: string;
  /** The file's name in the canvas's `images/` folder, for example "checkout-reference.png". */
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

// The section a pick makes for the versions that were not picked. The agent's own
// set-aside sections, drawn around one dropped item where it stands, have ids that
// start with this one (SKILL.md, "Decision notes"); items in either kind are out of the running.
export const SET_ASIDE_ID = "set-aside";
export const isSetAside = (section: { id: string }) => section.id === SET_ASIDE_ID || section.id.startsWith(`${SET_ASIDE_ID}-`);
