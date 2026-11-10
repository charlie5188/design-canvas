import type { CanvasItem, CanvasNote, CanvasSection } from "./canvas/types";
import { Example } from "./items/Example";

/**
 * Notes explain the canvas to whoever opens it or its shared file, for example
 * why a version was dropped. The agent writes them here when asked.
 * `{ id: "why-b", text: "B tested worse: too dense.", x: 0, y: 260 }`
 */
export const notes: CanvasNote[] = [];

/**
 * Sections are titled frames behind the items they group, for example the
 * versions set aside. Place the items inside the frame's bounds.
 * `{ id: "set-aside", title: "Set aside", x: 0, y: 300, width: 800, height: 400 }`
 */
export const sections: CanvasSection[] = [];

/** Add, rename, or remove canvas items here. The canvas reads these, the notes, and the sections, and nothing else. */
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
