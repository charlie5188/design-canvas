import { useEffect, useRef, useState } from "react";
import { shared } from "./bridge";
import { HelpIcon } from "./icons";
import { labels } from "./labels";

// A shared file has no annotations, so its help leaves out annotate mode.
// A shared file has no agent and saves nothing, so it leaves those controls out.
const HELP_GROUPS = labels.helpGroups
  .filter((group) => !shared || !group.local)
  .map((group) => ({ ...group, rows: group.rows.filter((row) => !shared || !row.local) }));

/**
 * Canvas controls: what the mouse and the keys do, in groups, with the keys as key caps.
 * It opens on a press of the help button and stays until Escape, a press outside it, or
 * the button again, so a person can keep it open and try a key. Before, it was a list of
 * long sentences that showed while the button was hovered, and went when the pointer left.
 * It is always in the page (hidden while closed), because the canvas names it as its
 * description for a screen reader.
 */
export function Help() {
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
        aria-label={labels.help}
        aria-expanded={open}
        aria-controls="canvas-help"
        aria-pressed={open}
        data-tip={open ? undefined : labels.help}
        onClick={() => setOpen((was) => !was)}
      >
        <HelpIcon />
      </button>
      <div id="canvas-help" role="dialog" aria-label={labels.help} className="canvas-help-popover" hidden={!open}>
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
