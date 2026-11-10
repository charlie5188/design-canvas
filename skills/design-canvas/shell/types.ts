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
   * The id of the item this one is a new version of. The canvas places it
   * beside that item, and its arrival clears that item's sent "new version"
   * annotations.
   */
  from?: string;
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
