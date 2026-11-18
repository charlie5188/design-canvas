import { type ComponentType, type CSSProperties, type ReactNode, createContext, useContext, useEffect, useRef, useState } from "react";
import { PLAN_EVENT, type PlanAction, shared } from "./bridge";

/**
 * A direction the agent plans to build and has not built yet (SKILL.md,
 * "Planned directions"). The agent adds one item for each direction with this
 * card as its component, so the person judges the plan where the result will
 * appear, not in a chat list that scrolls away.
 *
 * The card leads with a rough sketch of the screen, because a paragraph alone
 * tells a person little more than the chat would: the sketch is what lets them
 * see at a glance that two directions differ in structure. Beside it (below it
 * on a narrow card), the bet, what it gives up, and where the idea came from.
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
  /** A rough screen made of `Block`s. Shows the structure only: no real components, data, colors, or styling. */
  sketch?: ReactNode;
};

const text = "var(--canvas-text-color, #1f2328)";
const subtle = "var(--canvas-subtle-color, #5f6b76)";
const line = "var(--canvas-border-color, #d5d9de)";
const surface = "var(--canvas-surface-color, #ffffff)";
const accent = "var(--canvas-focus-color, #2f6fed)";
const radius = "var(--canvas-radius-size, 8px)";

/**
 * What a block draws. A sketch made only of labelled boxes was hard to read:
 * every part looked the same, so people had to read each label to find the
 * list or the button. These kinds are the few shapes people recognize at a
 * glance. They stay grey wireframes on purpose, so a sketch never passes for a
 * finished design.
 */
export type BlockKind = "box" | "heading" | "text" | "button" | "field" | "choice" | "toggle" | "list" | "table" | "media";

type BlockProps = {
  /** What to draw. A `box` (the default) is a region that holds other blocks. */
  kind?: BlockKind;
  /** The words: a box's name, a heading, a button's text, a field's placeholder, a choice, or a media caption. Put words here, not between the tags. */
  label?: string;
  /** Box: lay the blocks inside out in a row. They stack in a column otherwise. */
  row?: boolean;
  /** How much room this block takes in its parent: a CSS length or percentage ("38%", 48). It shares the rest equally otherwise. */
  size?: number | string;
  /** How many placeholder lines of text to draw (box, text). */
  lines?: number;
  /** The part that carries the bet: what differs from the product today. Drawn in the accent color, and a box gets a "Key change" tag. */
  emphasis?: boolean;
  /** Button: the main action, drawn filled. */
  primary?: boolean;
  /** Choice: the selected one. */
  checked?: boolean;
  /** Toggle: its segments. Table: its column names. List: the text of its rows. */
  options?: string[];
  /** Toggle: the index of the selected segment. */
  selected?: number;
  /** List and table: how many rows, when `options` does not give the list's rows. */
  rows?: number;
  children?: ReactNode;
};

/** Whether the parent box lays its blocks out in a row, so a field shares the width there and fills it in a column. */
const InRow = createContext(false);
/** Inside a box marked as the key change: a marked box within it adds no second tag. */
const InKeyChange = createContext(false);

const words: CSSProperties = { fontSize: 11, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const bar = (width: string): CSSProperties => ({ flex: "none", blockSize: 5, borderRadius: 2, background: line, inlineSize: width });
const placeholder = (count: number) =>
  Array.from({ length: count }, (_, index) => <div key={index} aria-hidden="true" style={bar(index % 3 === 2 ? "60%" : "100%")} />);

/**
 * One part of a sketch. Nest boxes to draw the layout, and put the shapes inside:
 * `<Block row><Block size="38%" kind="list" options={["Starter", "Team"]} /><Block emphasis><Block kind="field" label="Card number" /><Block kind="button" primary label="Pay $60" /></Block></Block>`.
 */
export function Block({ kind = "box", label, row, size, lines = 0, emphasis, primary, checked, options, selected, rows, children }: BlockProps) {
  const inRow = useContext(InRow);
  const inKeyChange = useContext(InKeyChange);
  if (kind === "box") {
    // A named or marked box is a region and draws its outline. An unnamed one
    // only arranges what is inside it; outlining it too made a sketch a nest of
    // frames that hid the shapes.
    const framed = !!label || !!emphasis;
    const tag = emphasis && !inKeyChange;
    return (
      <div
        style={{
          boxSizing: "border-box",
          position: "relative",
          display: "flex",
          flexDirection: row ? "row" : "column",
          gap: 6,
          minWidth: 0,
          // Never shorter than what it holds: the sketch is as tall as its content,
          // so a squeezed box would cut off its fields and rows.
          // (Stated, not left to the default: with overflow hidden a flex item's automatic minimum is zero.)
          minHeight: "min-content",
          // Room for the "Key change" tag when no label shares its line.
          padding: !framed ? 0 : tag && !label ? "24px 6px 6px" : 6,
          // In a row, boxes share the width equally; in a column, each takes its content's height and shares what is left.
          flex: size === undefined ? (inRow ? "1 1 0" : "1 1 auto") : `0 0 ${typeof size === "number" ? `${size}px` : size}`,
          border: emphasis ? `1.5px solid ${accent}` : framed ? `1px solid ${line}` : "none",
          borderRadius: 4,
          background: emphasis ? `color-mix(in srgb, ${accent} 7%, transparent)` : "transparent",
          overflow: "hidden",
        }}
      >
        {label ? <div style={{ ...words, flex: "none", fontWeight: emphasis ? 500 : 400, color: emphasis ? text : subtle, paddingInlineEnd: tag ? 76 : 0 }}>{label}</div> : null}
        {tag ? (
          <div style={{ ...words, position: "absolute", insetBlockStart: 4, insetInlineEnd: 4, padding: "0 6px", borderRadius: 4, background: accent, color: surface, fontWeight: 500 }}>
            Key change
          </div>
        ) : null}
        {placeholder(lines)}
        <InKeyChange.Provider value={inKeyChange || !!emphasis}>
          <InRow.Provider value={!!row}>{children}</InRow.Provider>
        </InKeyChange.Provider>
      </div>
    );
  }

  // Shapes: in a row they share the width (a button or a choice keeps its own),
  // in a column they take their own height (media fills what is left, like a box).
  const grows = kind === "media" || (inRow && kind !== "button" && kind !== "toggle");
  const flex = size !== undefined ? `0 0 ${typeof size === "number" ? `${size}px` : size}` : grows ? "1 1 0" : "0 0 auto";
  const mark: CSSProperties = emphasis ? { outline: `1.5px solid ${accent}`, outlineOffset: 2 } : {};
  // In a row, a control keeps its own height instead of stretching to the tallest neighbour.
  const fits = inRow && kind !== "list" && kind !== "table" && kind !== "media";
  const base: CSSProperties = { boxSizing: "border-box", minWidth: 0, flex, ...(fits ? { alignSelf: "center" } : {}), ...mark };

  if (kind === "heading") {
    return label ? (
      <div style={{ ...base, ...words, fontSize: 13, fontWeight: 600, color: text }}>{label}</div>
    ) : (
      <div aria-hidden="true" style={{ ...base, blockSize: 8, inlineSize: "45%", borderRadius: 2, background: subtle, opacity: 0.5 }} />
    );
  }
  if (kind === "text") {
    return (
      <div style={{ ...base, display: "flex", flexDirection: "column", gap: 4 }}>
        {label ? <div style={{ fontSize: 11, lineHeight: 1.35, color: subtle }}>{label}</div> : null}
        {placeholder(label ? lines : lines || 2)}
      </div>
    );
  }
  if (kind === "button") {
    return (
      <div
        style={{
          ...base,
          ...words,
          // A main action in a column is usually full width, as in a form; others keep their own width.
          alignSelf: inRow || primary ? undefined : "flex-start",
          padding: "4px 10px",
          borderRadius: 4,
          textAlign: "center",
          fontWeight: 500,
          border: `1px solid ${primary ? text : subtle}`,
          background: primary ? text : surface,
          color: primary ? surface : text,
        }}
      >
        {label ?? "Button"}
      </div>
    );
  }
  if (kind === "field") {
    return <div style={{ ...base, ...words, padding: "4px 6px", border: `1px solid ${subtle}`, borderRadius: 4, background: surface, color: subtle }}>{label ?? " "}</div>;
  }
  if (kind === "choice") {
    return (
      <div style={{ ...base, display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", border: `1px solid ${checked ? subtle : line}`, borderRadius: 4, background: surface }}>
        <span aria-hidden="true" style={{ flex: "none", inlineSize: 8, blockSize: 8, borderRadius: "50%", border: `1px solid ${subtle}`, background: checked ? subtle : "transparent" }} />
        <span style={{ ...words, color: text }}>{label}</span>
      </div>
    );
  }
  if (kind === "toggle") {
    const segments = options?.length ? options : ["", ""];
    return (
      // In a row it keeps its own height, centred, instead of stretching to a taller neighbour.
      <div style={{ ...base, alignSelf: inRow ? "center" : "flex-start", display: "inline-flex", gap: 2, padding: 2, borderRadius: 5, background: line }}>
        {segments.map((segment, index) => (
          // Never narrower than its word: a toggle's words are short, and a cut-off "Mont…" read as broken.
          <span key={index} style={{ ...words, flex: "1 0 auto", padding: "2px 8px", borderRadius: 4, textAlign: "center", background: index === (selected ?? 0) ? surface : "transparent", color: index === (selected ?? 0) ? text : subtle }}>
            {segment || " "}
          </span>
        ))}
      </div>
    );
  }
  if (kind === "list") {
    const items = options?.length ? options : Array.from({ length: rows ?? 3 }, () => "");
    return (
      <div style={{ ...base, display: "flex", flexDirection: "column" }}>
        {items.map((item, index) => (
          <div key={index} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 2px", borderBlockEnd: `1px solid ${line}` }}>
            <span aria-hidden="true" style={{ flex: "none", inlineSize: 6, blockSize: 6, borderRadius: 2, background: line }} />
            {item ? <span style={{ ...words, color: text }}>{item}</span> : <div aria-hidden="true" style={bar(index % 2 ? "55%" : "75%")} />}
          </div>
        ))}
      </div>
    );
  }
  if (kind === "table") {
    const columns = options?.length ? options : ["", "", ""];
    const grid: CSSProperties = { display: "grid", gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`, gap: 6, padding: "4px 2px" };
    return (
      <div style={{ ...base, display: "flex", flexDirection: "column", border: `1px solid ${line}`, borderRadius: 4 }}>
        <div style={{ ...grid, borderBlockEnd: `1px solid ${subtle}` }}>
          {columns.map((column, index) => (column ? <span key={index} style={{ ...words, fontWeight: 500, color: text }}>{column}</span> : <div key={index} aria-hidden="true" style={bar("70%")} />))}
        </div>
        {Array.from({ length: rows ?? 3 }, (_, rowIndex) => (
          <div key={rowIndex} style={{ ...grid, borderBlockEnd: `1px solid ${line}` }}>
            {columns.map((_, index) => <div key={index} aria-hidden="true" style={bar(index % 2 ? "50%" : "80%")} />)}
          </div>
        ))}
      </div>
    );
  }
  // media: a picture, chart, or map, drawn as a crossed box.
  return (
    <div style={{ ...base, position: "relative", minHeight: 40, border: `1px solid ${line}`, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <svg aria-hidden="true" width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100" style={{ position: "absolute", inset: 0 }}>
        <line x1="0" y1="0" x2="100" y2="100" stroke={line} vectorEffect="non-scaling-stroke" />
        <line x1="100" y1="0" x2="0" y2="100" stroke={line} vectorEffect="non-scaling-stroke" />
      </svg>
      {label ? <span style={{ ...words, position: "relative", padding: "0 4px", background: surface, color: subtle }}>{label}</span> : null}
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
        {/* The sketch keeps a small screen's width and the words sit beside it. A
            card is as large as its built version will be, and a sketch stretched
            to a desktop page's width read as empty boxes, not as a screen. On a
            narrow card the words wrap below the sketch. */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 20 }}>
          {plan.sketch ? (
            <div
              data-canvas-sketch=""
              style={{
                boxSizing: "border-box",
                flex: "1 1 300px",
                maxWidth: 460,
                minHeight: 180,
                display: "flex",
                flexDirection: "column",
                padding: 8,
                border: `1px solid ${line}`,
                borderRadius: 6,
                // A white page on the grey card, so the sketch reads as a screen.
                background: surface,
              }}
            >
              {plan.sketch}
            </div>
          ) : null}
          <div style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
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
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 2 }}>
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
        </div>
      </div>
    );
  }
  return Planned;
}
