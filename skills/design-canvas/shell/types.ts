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
};
