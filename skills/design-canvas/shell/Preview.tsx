import { type ComponentType, memo } from "react";
import { frameSource } from "./bridge";
import type { CanvasItem } from "./types";

/** Previews never rerender because of the camera, a move, or a copy. */
export const Preview = memo(function Preview({ component: Component }: { component: ComponentType }) {
  return <Component />;
});

/** Viewport items live in their own document, so breakpoints see the item size. */
export const ItemFrame = memo(function ItemFrame({ item }: { item: CanvasItem }) {
  return (
    <iframe
      className="canvas-frame"
      data-canvas-frame={item.id}
      {...frameSource(item.id, "canvas")}
      title={item.name}
      width={item.width}
      height={item.height}
    />
  );
});
