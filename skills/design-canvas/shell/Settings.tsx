/**
 * The board's background: the gray behind the frames. A few presets rather than
 * any color, because the board's own words (names, captions, section tabs) and the
 * bars sit on it, and each preset comes with chrome colors that stay readable on
 * it (canvas.css). The frames' contents never change with it: previews keep the
 * project's own colors. It is a viewer's preference, kept in this browser per
 * canvas, like the camera; "default" follows the project's theme. It is chosen at the
 * top of the settings and controls panel (Help.tsx).
 */
export const BACKGROUNDS = ["default", "white", "dark"] as const;
export type Background = (typeof BACKGROUNDS)[number];
const backgroundKey = (storageKey: string) => `${storageKey}:background`;
export function loadBackground(storageKey: string): Background {
  try {
    const value = window.localStorage.getItem(backgroundKey(storageKey));
    return BACKGROUNDS.find((id) => id === value) ?? "default";
  } catch {
    return "default";
  }
}
export function saveBackground(storageKey: string, value: Background) {
  try {
    if (value === "default") window.localStorage.removeItem(backgroundKey(storageKey));
    else window.localStorage.setItem(backgroundKey(storageKey), value);
  } catch {
    // Storage may be unavailable; the choice lasts until the page closes.
  }
}
