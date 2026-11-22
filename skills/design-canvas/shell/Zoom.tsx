import { type Ref, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { labels } from "./labels";

/**
 * The view's zoom, in the top-right bar with the file's other controls: the level, which
 * opens the ways to change it, each with its keys. Before, it was a bar of its own at the
 * bottom right with five buttons, the controls then sat in three places, and zoom in and
 * out repeated what the trackpad and the keys do. Zoom in and out leave the menu open, so
 * a few presses step through levels; Fit all and Reset view close it.
 *
 * The level shows in `levelRef` when given (the canvas writes it on every camera frame,
 * without a render), else as `level`.
 */
export function ZoomMenu({
  level,
  levelRef,
  levelClass,
  onZoomIn,
  onZoomOut,
  onFit,
  onActual,
}: {
  level: string;
  levelRef?: Ref<HTMLSpanElement>;
  levelClass?: string;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onActual: () => void;
}) {
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
  const options: { label: string; keys: string[]; run: () => void; stay?: boolean }[] = [
    { label: labels.zoomIn, keys: ["+"], run: onZoomIn, stay: true },
    { label: labels.zoomOut, keys: ["−"], run: onZoomOut, stay: true },
    // The same keys the controls panel lists (labels.helpGroups).
    { label: labels.fitAll, keys: ["1"], run: onFit },
    { label: labels.resetCamera, keys: ["0"], run: onActual },
  ];
  return (
    <span className="canvas-help" ref={wrap}>
      <button
        type="button"
        className="canvas-button canvas-zoom-button"
        aria-label={labels.zoomGroup}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-pressed={open}
        data-tip={open ? undefined : labels.zoomGroup}
        onClick={() => setOpen((was) => !was)}
      >
        <span ref={levelRef} className={`canvas-zoom${levelClass ? ` ${levelClass}` : ""}`} aria-live="off">
          {level}
        </span>
        <Icon name="chevron-down" size={14} />
      </button>
      <div role="dialog" aria-label={labels.zoomGroup} className="canvas-backgrounds canvas-zoom-menu" hidden={!open}>
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            className="canvas-background-option canvas-zoom-option"
            onClick={() => {
              option.run();
              if (!option.stay) setOpen(false);
            }}
          >
            {option.label}
            <span className="canvas-zoom-keys" aria-hidden="true">
              {option.keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </span>
          </button>
        ))}
      </div>
    </span>
  );
}
