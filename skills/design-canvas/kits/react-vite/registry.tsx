import type { CanvasItem } from "./canvas/types";
import { Example } from "./items/Example";

/** Add, rename, or remove canvas items here. The canvas reads nothing else. */
export const registry: CanvasItem[] = [
  {
    id: "example",
    name: "Example · replace me",
    note: "Delete this item once the first real one is in.",
    component: Example,
    x: 0,
    y: 0,
    width: 360,
    height: 180,
  },
];
