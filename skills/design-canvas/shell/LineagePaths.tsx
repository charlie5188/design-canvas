// The path from the original to each picked version: one line for each round the
// exploration went through, from the version it built on to the next, and the
// person's reason for the step (`why`, written by the agent) on the line. Only the
// picked versions' paths are drawn, so the canvas says what won and how without
// a web of lines between every version. It shows in the shared file too.
//
// The lines follow their items live, also while one is dragged: a drag moves an
// item by writing its transform straight to the page, not through React, so each
// line is drawn from the items' own boxes after each render and whenever their
// style or size changes in between.
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import type { Step } from "./lineage";

const TRANSLATE = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/;

export function LineagePaths({ steps, world }: { steps: Step[]; world: RefObject<HTMLDivElement | null> }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wordsRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  // What the watch depends on, so it is set up again only when that changes.
  const key = steps.map((step) => `${step.from.id}>${step.to.id}:${step.to.why ?? ""}`).join("|");

  /** Draws every line and its words from the items' boxes as they are on the page now. */
  const draw = () => {
    const root = world.current;
    if (!root) return;
    const find = (id: string) => root.querySelector<HTMLElement>(`.canvas-item[data-canvas-item="${CSS.escape(id)}"]`);
    /** An item's box in canvas units: its centre line, its top above the caption, and the bottom of its preview. */
    const boxOf = (element: HTMLElement | null) => {
      const at = element?.style.transform.match(TRANSLATE);
      if (!element || !at) return null;
      const x = Number(at[1]);
      const y = Number(at[2]);
      const lift = Math.max(0, -(element.querySelector<HTMLElement>(".canvas-item-title")?.offsetTop ?? 0));
      return { mid: x + element.offsetWidth / 2, top: y - lift, bottom: y + element.offsetHeight };
    };
    stepsRef.current.forEach((step, i) => {
      const line = svgRef.current?.querySelector<SVGPathElement>(`[data-step="${i}"]`);
      const words = wordsRef.current?.querySelector<HTMLElement>(`[data-step="${i}"]`);
      const a = boxOf(find(step.from.id));
      const b = boxOf(find(step.to.id));
      if (!a || !b) {
        line?.setAttribute("d", "");
        if (words) words.hidden = true;
        return;
      }
      // Down out of the parent's preview, into the top of the child's box (above its name and caption).
      const bend = Math.max(32, Math.abs(b.top - a.bottom) / 2);
      line?.setAttribute("d", `M ${a.mid} ${a.bottom} C ${a.mid} ${a.bottom + bend}, ${b.mid} ${b.top - bend}, ${b.mid} ${b.top}`);
      if (words) {
        words.hidden = false;
        words.style.transform = `translate(${(a.mid + b.mid) / 2}px, ${(a.bottom + b.top) / 2}px)`;
      }
    });
  };
  const drawRef = useRef(draw);
  drawRef.current = draw;

  // After every render: the canvas renders again when items, positions, or sizes change through React.
  useLayoutEffect(() => drawRef.current());

  // Between renders: a drag writes an item's transform straight to the page, and an item's
  // size changes with its content. A passive effect, because on the first commit a layout
  // effect here runs before the world's ref is attached; the watch also starts again
  // whenever items come or go, so a new item on the path is followed too.
  useEffect(() => {
    const root = world.current;
    if (!root || !key) return;
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        drawRef.current();
      });
    };
    const sizes = new ResizeObserver(schedule);
    const moves = new MutationObserver((records) => {
      if (records.some((record) => record.type === "childList")) watch();
      schedule();
    });
    const watch = () => {
      moves.disconnect();
      sizes.disconnect();
      moves.observe(root, { childList: true });
      for (const id of new Set(stepsRef.current.flatMap((step) => [step.from.id, step.to.id]))) {
        const element = root.querySelector<HTMLElement>(`.canvas-item[data-canvas-item="${CSS.escape(id)}"]`);
        if (!element) continue;
        moves.observe(element, { attributes: true, attributeFilter: ["style"] });
        sizes.observe(element);
      }
    };
    watch();
    schedule();
    return () => {
      moves.disconnect();
      sizes.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [key, world]);

  if (!steps.length) return null;
  return (
    <>
      <svg ref={svgRef} className="canvas-lineage" aria-hidden="true">
        {steps.map((step, i) => (
          <path key={`${step.from.id}>${step.to.id}`} data-step={i} />
        ))}
      </svg>
      <div ref={wordsRef} className="canvas-lineage-words">
        {steps.map((step, i) =>
          step.to.why ? (
            <div key={`${step.from.id}>${step.to.id}`} data-step={i} className="canvas-lineage-why" hidden>
              <span>{step.to.why}</span>
            </div>
          ) : (
            <div key={`${step.from.id}>${step.to.id}`} data-step={i} hidden />
          ),
        )}
      </div>
    </>
  );
}
