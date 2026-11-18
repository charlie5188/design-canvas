import { type ComponentType, memo } from "react";

/** Previews never rerender because of the camera, a move, or a copy. */
export const Preview = memo(function Preview({ component: Component }: { component: ComponentType }) {
  return <Component />;
});
