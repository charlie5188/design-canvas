import { useEffect, useRef, useState } from "react";
import { shared } from "./bridge";
import { Icon } from "./icons";
import { labels } from "./labels";
import { BACKGROUNDS, type Background } from "./Settings";

// A shared file has no annotations, so its help leaves out annotate mode.
// A shared file has no agent and saves nothing, so it leaves those controls out.
const HELP_GROUPS = labels.helpGroups
  .filter((group) => !shared || !group.local)
  .map((group) => ({ ...group, rows: group.rows.filter((row) => !shared || !row.local) }));

/**
 * Settings and controls, behind one gear at the top right: the board's background (how the
 * board looks to the person viewing it, seldom changed, and changing nothing in the work),
 * then what the mouse and the keys do, in groups, with the keys as key caps. Both were
 * buttons of their own (a gear and a question mark); each is opened seldom, so one button
 * keeps the bar short. It opens on a press and stays until Escape, a press outside it, or
 * the button again, so a person can keep it open and try a key. It is always in the page
 * (hidden while closed), because the canvas names it as its description for a screen reader.
 */
export function CanvasMenu({ background, onBackground }: { background: Background; onBackground: (value: Background) => void }) {
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
        aria-label={labels.canvasMenu}
        aria-expanded={open}
        aria-controls="canvas-help"
        aria-pressed={open}
        data-tip={open ? undefined : labels.canvasMenu}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name="settings" />
      </button>
      <div id="canvas-help" role="dialog" aria-label={labels.canvasMenu} className="canvas-help-popover" hidden={!open}>
        <div className="canvas-menu-background" role="group" aria-labelledby="canvas-settings-background">
          <span className="canvas-help-title" id="canvas-settings-background">
            {labels.background}
          </span>
          {BACKGROUNDS.map((id) => (
            <button
              key={id}
              type="button"
              className="canvas-background-option"
              aria-pressed={id === background}
              onClick={() => onBackground(id)}
            >
              <span className="canvas-swatch" data-background={id} aria-hidden="true" />
              {labels.backgrounds[id]}
            </button>
          ))}
        </div>
        <div className="canvas-help-title">{labels.help}</div>
        <div className="canvas-help-groups">
          {HELP_GROUPS.map((group) => (
            <section key={group.title} className="canvas-help-group">
              <h2>{group.title}</h2>
              <dl>
                {group.rows.map((row) => (
                  <div key={row.what} className="canvas-help-row">
                    <dt>{row.what}</dt>
                    {/* Words between backticks are keys. */}
                    <dd>{row.how.split("`").map((part, index) => (index % 2 ? <kbd key={index}>{part}</kbd> : part))}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </span>
  );
}
