import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { labels } from "./labels";

/**
 * The board's background: the gray behind the frames. A few presets rather than
 * any color, because the board's own words (names, captions, section tabs) and the
 * bars sit on it, and each preset comes with chrome colors that stay readable on
 * it (canvas.css). The frames' contents never change with it: previews keep the
 * project's own colors. It is a viewer's preference, kept in this browser per
 * canvas, like the camera; "default" follows the project's theme.
 */
const BACKGROUNDS = ["default", "white", "dark"] as const;
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

/** The background button: a swatch of the board's color, opening the presets under it. */
/**
 * The canvas's own settings, behind a gear at the top right: how the board looks to the
 * person viewing it, which is seldom changed and changes nothing in the work. For now, its
 * background. The product's light and dark theme stays outside, since reviewing it is the work.
 */
export function SettingsMenu({ value, onChange }: { value: Background; onChange: (value: Background) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrap.current?.contains(event.target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
  return (
    <span className="canvas-help" ref={wrap}>
      <button
        type="button"
        className="canvas-button canvas-icon-button"
        aria-label={labels.canvasSettings}
        aria-expanded={open}
        aria-controls="canvas-settings"
        aria-pressed={open}
        data-tip={open ? undefined : labels.canvasSettings}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name="settings" />
      </button>
      <div id="canvas-settings" role="dialog" aria-label={labels.canvasSettings} className="canvas-backgrounds" hidden={!open}>
        <span className="canvas-settings-heading" id="canvas-settings-background">
          {labels.background}
        </span>
        {BACKGROUNDS.map((id) => (
          <button
            key={id}
            type="button"
            className="canvas-background-option"
            aria-pressed={id === value}
            onClick={() => {
              onChange(id);
              setOpen(false);
            }}
          >
            <span className="canvas-swatch" data-background={id} aria-hidden="true" />
            {labels.backgrounds[id]}
          </button>
        ))}
      </div>
    </span>
  );
}
