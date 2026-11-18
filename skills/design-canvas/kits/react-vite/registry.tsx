import type { CanvasImage, CanvasItem, CanvasNote, CanvasSection } from "./canvas/types";
import { Example } from "./items/Example";

/**
 * Notes explain the canvas to whoever opens it or its shared file, for example
 * why a version was dropped. The agent writes one here when a decision is made
 * in the conversation, and when asked.
 * `{ id: "why-b", text: "B tested worse: too dense.", x: 0, y: 260 }`
 */
export const notes: CanvasNote[] = [];

/**
 * Sections are titled frames behind the items they group, for example the
 * versions set aside. Place the items inside the frame's bounds.
 * `{ id: "set-aside", title: "Set aside", x: 0, y: 300, width: 800, height: 400 }`
 */
export const sections: CanvasSection[] = [];

/**
 * Reference images the person pasted or dropped onto the canvas. The canvas writes these
 * and puts the files in images/; read a file when a note points at it.
 */
export const images: CanvasImage[] = [];

/**
 * Add, rename, or remove canvas items here. The canvas reads these, the notes, and the sections, and nothing else.
 * An item can name the `path` it shows and hold more `screens` by path, so the links in the real code work,
 * and hold its screens' other `states` (empty, an error) (canvas/types.ts).
 */
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
