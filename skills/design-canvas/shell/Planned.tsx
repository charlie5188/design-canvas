import { type ComponentType, type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { PLAN_EVENT, type PlanAction, shared } from "./bridge";

/**
 * A direction the agent plans to build and has not built yet (SKILL.md,
 * "Planned directions"). The agent adds one item for each direction with this
 * card as its component, so the person judges the plan where the result will
 * appear, not in a chat list that scrolls away.
 *
 * The card leads with a rough sketch of the layout, because a paragraph alone
 * tells a person little more than the chat would: the sketch is what lets them
 * see at a glance that two directions differ in structure. Below it, the bet,
 * what it gives up, and where the idea came from.
 *
 * The person moves forward from the card itself: Build asks the agent to build
 * this one in place, Drop moves it to the trash. Both go through the canvas
 * (PLAN_EVENT), which already knows how to send a request and how to trash an
 * item, so the card keeps no state of its own that the canvas would have to trust.
 *
 * It is an ordinary item on purpose. Moving, resizing, the trash, annotations,
 * text rewrites, and the shared file all work with no special case in the canvas.
 */
export type Plan = {
  /** What this direction bets on, in one sentence. */
  bet: string;
  /** What it gives up, or how it could fail. */
  givesUp?: string;
  /** The product or pattern it borrows from, or differs from on purpose. A name, not a link: links in previews do not open. */
  reference?: string;
  /** A rough layout made of `Block`s. Shows the structure only: no real components, data, or styling. */
  sketch?: ReactNode;
};

const text = "var(--canvas-text-color, #1f2328)";
const subtle = "var(--canvas-subtle-color, #5f6b76)";
const line = "var(--canvas-border-color, #d5d9de)";
const surface = "var(--canvas-surface-color, #ffffff)";
const radius = "var(--canvas-radius-size, 8px)";

type BlockProps = {
  /** A short name for this part, such as "Request list". Put words here, not between the tags. */
  label?: string;
  /** Lay the blocks inside out in a row. They stack in a column otherwise. */
  row?: boolean;
  /** How much room this block takes in its parent: a CSS length or percentage ("38%", 48). It shares the rest equally otherwise. */
  size?: number | string;
  /** How many placeholder lines of text to draw. */
  lines?: number;
  /** The part that carries the bet. Drawn stronger, so the eye goes to what is different. */
  emphasis?: boolean;
  children?: ReactNode;
};

/**
 * One box of a sketch. Nest them to draw a layout:
 * `<Block row><Block size="38%" label="List" lines={5} /><Block label="Detail" emphasis lines={3} /></Block>`.
 * One primitive keeps every sketch in the same rough style, so a sketch never passes for a finished design.
 */
export function Block({ label, row, size, lines = 0, emphasis, children }: BlockProps) {
  return (
    <div
      style={{
        boxSizing: "border-box",
        display: "flex",
        flexDirection: row ? "row" : "column",
        gap: 6,
        minWidth: 0,
        // A sized block is at least its size and grows to show its label; only a
        // block that shares leftover room may shrink below its content.
        // (Stated, not left to the default: with overflow hidden a flex item's automatic minimum is zero.)
        minHeight: size === undefined ? 0 : "min-content",
        padding: 6,
        flex: size === undefined ? "1 1 0" : `0 0 ${typeof size === "number" ? `${size}px` : size}`,
        border: `1px solid ${emphasis ? subtle : line}`,
        borderRadius: 4,
        background: emphasis ? surface : "transparent",
        overflow: "hidden",
      }}
    >
      {label ? (
        <div
          style={{
            flex: "none",
            fontSize: 11,
            lineHeight: 1.3,
            fontWeight: emphasis ? 500 : 400,
            color: emphasis ? text : subtle,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </div>
      ) : null}
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          style={{ flex: "none", blockSize: 5, borderRadius: 2, background: line, inlineSize: index % 3 === 2 ? "60%" : "100%" }}
        />
      ))}
      {children}
    </div>
  );
}

// Inline styles with the canvas tokens: the card must look the same in every
// app, so it takes nothing from the app's stylesheet and resets what a global
// stylesheet could change.
const card: CSSProperties = {
  boxSizing: "border-box",
  minHeight: "100%",
  padding: 20,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  // The canvas background, not a surface: the card reads as an empty place, not as a design.
  background: "var(--canvas-bg-color, #eef0f2)",
  color: text,
  fontFamily: 'var(--canvas-font, system-ui, -apple-system, "Segoe UI", sans-serif)',
  textAlign: "start",
};
const label: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.4, fontWeight: 400, color: subtle };
const bet: CSSProperties = { margin: 0, maxWidth: "44ch", fontSize: 16, lineHeight: 1.45, fontWeight: 500 };
const detail: CSSProperties = { margin: "2px 0 0", maxWidth: "52ch", fontSize: 14, lineHeight: 1.5, fontWeight: 400 };
const button: CSSProperties = {
  appearance: "none",
  margin: 0,
  padding: "6px 12px",
  font: "inherit",
  fontSize: 13,
  lineHeight: 1.4,
  borderRadius: radius,
  cursor: "pointer",
};

/** The component for a planned direction: `component: planned({ bet: "…", givesUp: "…", reference: "…", sketch: <Block … /> })`. */
export function planned(plan: Plan): ComponentType {
  function Planned() {
    const root = useRef<HTMLDivElement>(null);
    // The buttons need the canvas to act on them, so they show only in an item
    // on the canvas page: not in the shared file (no agent), a frame, a page of
    // its own, or the trash's small previews.
    const [onCanvas, setOnCanvas] = useState(false);
    const [asked, setAsked] = useState(false);
    useEffect(() => {
      setOnCanvas(!shared && !!root.current?.closest("[data-canvas-preview]")?.closest("[data-canvas-item]"));
    }, []);
    const act = (action: PlanAction) => {
      root.current?.dispatchEvent(new CustomEvent(PLAN_EVENT, { bubbles: true, detail: { action } }));
      if (action === "build") setAsked(true);
    };
    return (
      <div ref={root} data-canvas-planned="" style={card}>
        <div style={label}>Planned, not built yet</div>
        {plan.sketch ? (
          <div data-canvas-sketch="" style={{ flex: "1 1 0", minHeight: 120, display: "flex", flexDirection: "column" }}>
            {plan.sketch}
          </div>
        ) : null}
        <div style={bet}>{plan.bet}</div>
        {plan.givesUp ? (
          <div>
            <div style={label}>Gives up</div>
            <div style={detail}>{plan.givesUp}</div>
          </div>
        ) : null}
        {plan.reference ? (
          <div>
            <div style={label}>Reference</div>
            <div style={detail}>{plan.reference}</div>
          </div>
        ) : null}
        {onCanvas ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto", paddingTop: 2 }}>
            {asked ? (
              <div style={label}>Asked the agent to build this</div>
            ) : (
              <>
                <button type="button" style={{ ...button, border: `1px solid ${text}`, background: text, color: surface }} onClick={() => act("build")}>
                  Build this
                </button>
                <button type="button" style={{ ...button, border: `1px solid ${line}`, background: "transparent", color: text }} onClick={() => act("drop")}>
                  Drop
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    );
  }
  return Planned;
}
