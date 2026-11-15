import { type CSSProperties, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { frameSource } from "./bridge";
import { describeElement, pickElement } from "./dom";
import { Icon } from "./icons";
import { labels } from "./labels";
import { opensNewTab, pathOf, RouteContext, type Screen, screenIndex, screensOf, stateCount } from "./routes";
import type { CanvasItem } from "./types";

// The flow view: every screen of one item, side by side, with arrows for where each one leads.
//
// Why: one item holds one solution's whole flow (routes.ts), so the canvas stays one frame per
// solution. That keeps the canvas easy to read, but hides the steps inside the frame. This view
// opens the frame up on demand, like looking inside it, and closes back to the canvas.
//
// - Each screen is the item's real component, rendered live at the item's size. The view opens
//   with the whole flow in the window, to see its shape; then it pans and zooms as the canvas
//   does, to read a screen. The words on arrows, the screen names, the pins, and the buttons
//   keep one size on screen at any zoom. The screens are for looking: they take no clicks. A
//   click on one opens the item at that screen, back on the canvas.
// - Each arrow says what makes the step, in the words on the control: click "Pay". The words
//   scale with the view, as the screens' names do; they read at 12px when the view opens.
// - Arrows come from two places. A link in a screen is read from the screen itself. A step that
//   code makes (a router call in a click handler) cannot be read without running it, so it gets
//   an arrow once the person has made that step in the item (`learned`), and not before.
// - The main path runs left to right in the order the registry lists the screens, which is
//   the order a person goes through them. A screen that its previous one does not lead to,
//   but an earlier one does, is a branch (checkout fails, a form has an error): it sits in a
//   row below the screen it branches from, and the screens after it on that branch go on to
//   its right. The layout is made when the view opens and holds still while it is open, though
//   a step the person makes later adds an arrow.
// - Every screen starts as it first renders: what the person typed on one step is not carried to
//   the next. Enough to see the flow and its layout; not a record of one run through it.
// - The person asks the agent here as on the canvas, with the same Ask agent tool (or A): a
//   click on an element in a screen asks about that element on that screen, a click on a
//   screen's frame about the screen, and the bar's button about the whole flow. The note opens
//   where it was asked and the view stays: moving to the item to write it felt like a jump.
//   In a `viewport` item's screens, which are frames of their own, only the whole screen.
// - Nothing here is saved, and nothing on the canvas moves.

/** The largest a screen is drawn, so that several fit side by side. */
const MAX_WIDTH = 520;
/** Room above and below the screens: the bar, the screen names, and the lane for arrows that loop back. */
const CHROME = 230;
/** Room beside the screens (the row's padding), and between two of them (an arrow). */
const SIDES = 96;
const GAP = 120;
/** Between two rows: room for an arrow down and its words. */
const ROW_GAP = 96;
/** A screen's name row and the space under it. */
const HEAD = 32;
/** Around the layout. */
const PAD_X = 48;
const PAD_Y = 32;
/** Between the lanes that steps back or past a screen loop along, under the layout. */
const LANE = 18;
/** How many characters fit on one line of an arrow between two screens; such a label has two lines at most. */
const SHORT_LINE = 17;
/** The smallest screens are laid out at; past that the view opens zoomed out further. */
const MIN_SCALE = 0.3;
/** How far the person can zoom, as the size of a screen on screen against its real size. */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;
/** One press of a zoom button or key. */
const ZOOM_STEP = 1.25;

type Place = { row: number; col: number };
type Box = { x: number; y: number; w: number; h: number; row: number; col: number };

/**
 * Where each screen sits: a row (0 is the main path) and a column. See the comment at the top.
 * A screen nothing leads to yet stays on the main path, so a step not known yet (a router call
 * nobody has made) does not move a screen into a branch.
 */
export function placeScreens(count: number, steps: readonly { from: number; to: number }[]): Place[] {
  const leads = (from: number, to: number) => steps.some((s) => s.from === from && s.to === to);
  const taken = new Set<string>();
  const take = (row: number, col: number): Place => {
    while (taken.has(`${row}:${col}`)) col += 1;
    taken.add(`${row}:${col}`);
    return { row, col };
  };
  const places: Place[] = [];
  let next = 0;
  for (let i = 0; i < count; i += 1) {
    const before = places[i - 1];
    const from = steps.filter((s) => s.to === i && s.from < i).map((s) => s.from);
    let place: Place;
    if (!before || (!leads(i - 1, i) && !from.length)) place = take(0, next);
    else if (leads(i - 1, i)) place = before.row === 0 ? take(0, next) : take(before.row, before.col + 1);
    else {
      const parent = places[Math.min(...from)]!;
      place = take(parent.row + 1, parent.col);
    }
    if (place.row === 0) next = place.col + 1;
    places.push(place);
  }
  return places;
}

/** A screen in the state chosen for it; a frame item's screens choose theirs in their frame. */
function Shown({ screen, state }: { screen: Screen; state?: string }) {
  const Component = (state && screen.states.find(([name]) => name === state)?.[1]) || screen.component;
  return <Component />;
}

/** A step from one screen to another, and the words on the control that makes it. */
export type FlowStep = { from: number; to: number; label?: string };
type Edge = FlowStep;

/**
 * The words a person would name a control by: its accessible name, or its text. Undefined for
 * a control with neither, such as an icon alone; its arrow then has no words.
 */
export function controlWords(element: Element | null): string | undefined {
  const control = element?.closest("a[href], button, [role='button'], [role='link'], input[type='submit'], input[type='button']");
  if (!control) return undefined;
  const words = (control.getAttribute("aria-label") ?? (control instanceof HTMLInputElement ? control.value : control.textContent) ?? "").replace(/\s+/g, " ").trim();
  return words || undefined;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Breaks a label into lines of `width` characters at spaces, at most `count` lines, the last one cut. */
function lines(text: string, width: number, count: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && (line + " " + word).length > width) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  out.push(line);
  return out.length > count ? [...out.slice(0, count - 1), clip(out.slice(count - 1).join(" "), width)] : out.map((l) => clip(l, width));
}


export function FlowView({
  item,
  current,
  learned,
  onOpen,
  onAsk,
  onAskElement,
  pinsFor,
  noteOpen,
  onCloseNote,
  onClose,
}: {
  item: CanvasItem;
  /** The screen the item shows now. */
  current: number;
  /** Steps the person made in the item, as screen indexes. */
  learned: readonly Edge[];
  onOpen: (index: number) => void;
  /**
   * Ask agent about one screen (its index), or about the whole flow (null). The note opens on
   * the item, back on the canvas, as Ask agent on an item does. Absent in a shared file.
   */
  onAsk?: (index: number | null, state?: string) => void;
  /** Ask agent about an element of one screen: its description, and the point asked at, in the item's own pixels. */
  onAskElement?: (index: number, described: string, x: number, y: number, state?: string) => void;
  /**
   * The pins of the notes about one screen, or the whole flow (null); `scale` is the screens'
   * size here. A screen shown in another state has its own notes.
   */
  pinsFor: (index: number | null, scale: number, state?: string) => ReactNode;
  /** A note about this item is open: Escape and a press on empty space close it, not the view. */
  noteOpen: boolean;
  onCloseNote: () => void;
  onClose: () => void;
}) {
  const screens = screensOf(item);
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  // The whole flow fits the window when it can, so it reads at a glance; past MIN_SCALE it scrolls.
  const fitWidth = (size.w - SIDES - GAP * (screens.length - 1)) / (screens.length * item.width);
  const scale = Math.max(MIN_SCALE, Math.min(1, MAX_WIDTH / item.width, fitWidth, Math.max(160, size.h - CHROME) / item.height));
  const rowRef = useRef<HTMLDivElement>(null);
  const boxes = useRef<(HTMLElement | null)[]>([]);
  const [linked, setLinked] = useState<Edge[]>([]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // The Ask agent tool, as on the canvas. Off, the screens are pictures (inert); on, a click
  // asks, and the screens still do nothing of their own.
  const [asking, setAsking] = useState(false);
  const askingRef = useRef(asking);
  askingRef.current = asking;
  const lives = useRef<(HTMLElement | null)[]>([]);
  // The state each screen shows, by name; none is its first state. Switched in place, as a
  // variant is in a design tool. Nothing is saved: the view opens on the first states.
  const [shown, setShown] = useState<Record<number, string>>({});
  const pickRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Set as a property: React 18 does not know the `inert` attribute, and React 19 reads `inert=""` as off.
    for (const live of lives.current) if (live) live.inert = !asking;
    if (!asking && pickRef.current) pickRef.current.hidden = true;
  });
  // The camera over the row: `z` multiplies the layout's own scale, so 1 is the size the row
  // is laid out at, and 1 / scale is the screens' real size.
  const [cam, setCam] = useState({ x: 0, y: 0, z: 1 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const fitted = useRef(false);
  // The words on arrows belong to the flow, like the screens' names, so they scale with the
  // view. They read at 12px at the zoom the view opens at, which shows the whole flow.
  const [labelZoom, setLabelZoom] = useState(1);
  // The layout is made from the steps known as the view opens, while the screens render and
  // their links are read, and then holds still: a screen never moves under the person.
  const settled = useRef(false);
  const touched = useRef(false);
  const [places, setPlaces] = useState<Place[]>(() => screens.map((_, col) => ({ row: 0, col })));
  useEffect(() => {
    const timer = window.setTimeout(() => (settled.current = true), 1600);
    return () => window.clearTimeout(timer);
  }, []);
  /** The camera that shows the whole row, in the middle of the stage. */
  const fitCam = useCallback(() => {
    const stage = stageRef.current;
    const row = rowRef.current;
    if (!stage || !row) return { x: 0, y: 0, z: 1 };
    const z = Math.min(1, stage.clientWidth / row.offsetWidth, stage.clientHeight / row.offsetHeight);
    return { x: (stage.clientWidth - row.offsetWidth * z) / 2, y: Math.max(0, (stage.clientHeight - row.offsetHeight * z) / 2), z };
  }, []);
  /** Zooms by `factor` about a point on the stage, which stays where it is. */
  const zoomAt = useCallback(
    (factor: number, px?: number, py?: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      touched.current = true;
      const { x, y, z } = camRef.current;
      const next = Math.min(MAX_ZOOM / scale, Math.max(MIN_ZOOM / scale, z * factor));
      const cx = px ?? stage.clientWidth / 2;
      const cy = py ?? stage.clientHeight / 2;
      setCam({ x: cx - ((cx - x) * next) / z, y: cy - ((cy - y) * next) / z, z: next });
    },
    [scale],
  );

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Escape closes. The view takes keys first, so Escape does not also clear a selection behind it.
  // The canvas's zoom keys work here too: + and −, 1 to see all, 0 for real size.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (noteOpen) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        // As on the canvas, Escape first puts the Ask agent tool down.
        if (askingRef.current) setAsking(false);
        else onClose();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tool = onAsk && !event.repeat ? { a: true, v: false }[event.key.toLowerCase()] : undefined;
      if (tool !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        setAsking(event.key.toLowerCase() === "a" ? (was) => !was : false);
        return;
      }
      const zoom = event.key === "+" || event.key === "=" ? ZOOM_STEP : event.key === "-" || event.key === "−" ? 1 / ZOOM_STEP : event.key === "0" ? 1 / scale / camRef.current.z : 0;
      if (zoom) zoomAt(zoom);
      else if (event.key === "1") setCam(fitCam());
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [fitCam, noteOpen, onAsk, onClose, scale, zoomAt]);
  useEffect(() => closeRef.current?.focus(), []);

  // A wheel pans, and with Ctrl or ⌘ (a pinch on a trackpad) zooms at the pointer, as on the canvas.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as Element).closest?.(".canvas-annotation-card")) return;
      event.preventDefault();
      const box = stage.getBoundingClientRect();
      touched.current = true;
      if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX - box.left, event.clientY - box.top);
      else setCam((c) => ({ ...c, x: c.x - event.deltaX, y: c.y - event.deltaY }));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // A drag pans, on a screen too: zoomed in, the screens fill the view and leave no empty space
  // to hold. A press that does not move does what it would: on a screen it opens that screen,
  // and on empty space it closes the open note, or the view. Not on a pin, a note, or a button.
  const drag = useRef<{ x: number; y: number; moved: boolean; empty: boolean } | null>(null);
  const dragged = useRef(false);

  /** Where each screen's links lead, read from the screens as they render. A frame's are read once it loads. */
  // Read from each screen's first state only: the flow's steps are those of its screens as they
  // first render, and switching a screen to another state (an error that has no link on) must
  // not move a screen or take an arrow away. A screen shown in another state keeps the steps
  // read from its first.
  const stepsOf = useRef<Record<number, Edge[]>>({});
  const shownRef = useRef<Record<number, string>>({});
  const readLinks = useCallback(() => {
    boxes.current.forEach((box, from) => {
      if (shownRef.current[from]) return;
      const found: Edge[] = [];
      const frame = box?.querySelector("iframe");
      let root: ParentNode | null | undefined = box;
      if (frame) {
        try {
          root = frame.contentDocument;
        } catch {
          root = null;
        }
      }
      for (const anchor of root?.querySelectorAll("a[href]") ?? []) {
        if (opensNewTab(anchor)) continue;
        const path = pathOf(anchor.getAttribute("href") ?? "");
        const to = path ? screenIndex(item, path) : -1;
        if (to >= 0 && to !== from && !found.some((e) => e.from === from && e.to === to)) found.push({ from, to, label: controlWords(anchor) });
      }
      stepsOf.current[from] = found;
    });
    const all = Object.values(stepsOf.current).flat();
    setLinked((was) => (JSON.stringify(was) === JSON.stringify(all) ? was : all));
  }, [item]);

  shownRef.current = shown;
  const measure = readLinks;

  useLayoutEffect(() => {
    measure();
    // A screen may render its links late, after data or a frame loads.
    const timers = [100, 600, 1500].map((ms) => window.setTimeout(measure, ms));
    return () => timers.forEach(window.clearTimeout);
  }, [measure]);

  /**
   * What a click with the Ask agent tool asks about: an element of a plain item's screen, or a
   * screen as a whole (its frame, its empty part, or a frame item's screen). Null off the screens.
   */
  const askTarget = (target: Element): { index: number; element: Element | null; box: Element } | null => {
    const frame = target.closest<HTMLElement>(".canvas-flow-frame");
    if (!frame || target.closest(".canvas-pin, .canvas-annotation-card")) return null;
    const index = Number(frame.dataset.index);
    const live = lives.current[index];
    const element = live && !item.viewport && target !== live ? pickElement(target, live.firstElementChild ?? live) : null;
    return { index, element, box: element ?? frame };
  };

  const edges = [
    ...linked.map((l) => (l.label ? l : { ...l, label: learned.find((e) => e.from === l.from && e.to === l.to)?.label })),
    ...learned.filter((e) => !linked.some((l) => l.from === e.from && l.to === e.to)),
  ].filter(
    (e) => e.from < screens.length && e.to < screens.length,
  );
  const w = item.width * scale;
  const h = item.height * scale;
  // While the view settles, the layout follows the steps found; then it holds.
  const stepsKey = JSON.stringify(edges.map((e) => [e.from, e.to]));
  useEffect(() => {
    if (settled.current) return;
    const next = placeScreens(screens.length, edges);
    setPlaces((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepsKey, screens.length]);
  const rows = Math.max(...places.map((p) => p.row)) + 1;
  const cols = Math.max(...places.map((p) => p.col)) + 1;
  const lanes = edges.filter((e) => route(places, e) === "loop").length;
  const overLanes = edges.filter((e) => route(places, e) === "over").length;
  const top = PAD_Y + (overLanes ? 16 + overLanes * LANE : 0);
  const boxesAt: Box[] = places.map((p) => ({
    x: PAD_X + p.col * (w + GAP),
    y: top + p.row * (HEAD + h + ROW_GAP) + HEAD,
    w,
    h,
    row: p.row,
    col: p.col,
  }));
  const width = PAD_X * 2 + cols * w + (cols - 1) * GAP;
  const height = top + PAD_Y + rows * (HEAD + h) + (rows - 1) * ROW_GAP + (lanes ? 16 + lanes * LANE : 0);
  // The view opens on the whole flow, and fits it again when the layout changes as it settles,
  // until the person moves the view.
  useLayoutEffect(() => {
    if (touched.current && fitted.current) return;
    fitted.current = true;
    const fit = fitCam();
    setCam(fit);
    setLabelZoom(fit.z);
  }, [fitCam, width, height]);

  return (
    <div className="canvas-flow" role="dialog" aria-modal="true" aria-label={labels.flowOf(item.name)}>
      {/* The same controls as the canvas, in the same places: where this is at the top left,
          the view at the bottom right. Only what is new here is new. */}
      <div className="canvas-toolbar" data-place="crumb" role="toolbar" aria-label={labels.flowOf(item.name)}>
        <button ref={closeRef} type="button" className="canvas-button canvas-icon-button" aria-label={labels.backToCanvas} data-tip={labels.backToCanvas} onClick={onClose}>
          <Icon name="arrow-left" />
        </button>
        <span className="canvas-separator" aria-hidden="true" />
        <span className="canvas-flow-title">{item.name}</span>
        <span className="canvas-flow-count">
          {[labels.screens(screens.length), stateCount(item) ? labels.states(stateCount(item)) : ""].filter(Boolean).join(" · ")}
        </span>
        {/* A flow brings up remarks about the steps themselves (drop one, change the order), not
            about one element: so the view asks about a screen, or the whole flow, and no more.
            Notes about the whole flow hang under the button that makes them. */}
        {onAsk && (
          <span className="canvas-flow-ask-flow">
            <button type="button" className="canvas-item-action" aria-label={labels.askFlow(item.name)} data-tip={labels.askFlowHint} onClick={() => onAsk(null)}>
              <Icon name="message-circle" />
            </button>
            {pinsFor(null, scale)}
          </span>
        )}
      </div>
      {onAsk && (
        <div className="canvas-toolbar" data-place="tools" role="toolbar" aria-label={labels.toolsBar}>
          <button
            type="button"
            className="canvas-button canvas-icon-button"
            aria-pressed={!asking}
            aria-label={labels.selectTool}
            data-tip={labels.selectToolHint}
            onClick={() => setAsking(false)}
          >
            <Icon name="pointer" />
          </button>
          <button
            type="button"
            className="canvas-button canvas-icon-button"
            aria-pressed={asking}
            aria-label={labels.annotate}
            data-tip={labels.annotateHint}
            onClick={() => setAsking((was) => !was)}
          >
            <Icon name="message-circle" />
          </button>
        </div>
      )}
      <div ref={pickRef} className="canvas-pick" hidden aria-hidden="true" />
      <div className="canvas-toolbar" data-place="view" role="toolbar" aria-label={labels.viewBar}>
        <button type="button" className="canvas-button canvas-icon-button" aria-label={labels.zoomOut} data-tip={labels.zoomOut} onClick={() => zoomAt(1 / ZOOM_STEP)}>
          <Icon name="minus" />
        </button>
        <span className="canvas-zoom canvas-flow-zoom-level" aria-live="polite">
          {Math.round(scale * cam.z * 100)}%
        </span>
        <button type="button" className="canvas-button canvas-icon-button" aria-label={labels.zoomIn} data-tip={labels.zoomIn} onClick={() => zoomAt(ZOOM_STEP)}>
          <Icon name="plus" />
        </button>
        <span className="canvas-separator" aria-hidden="true" />
        <button type="button" className="canvas-button canvas-icon-button" aria-label={labels.fitAll} data-tip={labels.fitAll} onClick={() => setCam(fitCam())}>
          <Icon name="maximize" />
        </button>
        <button type="button" className="canvas-button canvas-icon-button" aria-label={labels.resetCamera} data-tip={labels.resetCamera} onClick={() => zoomAt(1 / scale / camRef.current.z)}>
          <Icon name="zoom-reset" />
        </button>
      </div>
      <div
        ref={stageRef}
        className="canvas-flow-stage"
        data-asking={asking || undefined}
        // With the Ask agent tool, the element or screen under the pointer is outlined, as on the canvas.
        onPointerMoveCapture={(event) => {
          const pick = pickRef.current;
          if (!pick) return;
          const hit = asking && !drag.current?.moved ? askTarget(event.target as Element) : null;
          pick.hidden = !hit;
          if (!hit) return;
          const box = hit.box.getBoundingClientRect();
          Object.assign(pick.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
        }}
        onPointerLeave={() => {
          if (pickRef.current) pickRef.current.hidden = true;
        }}
        // A press in a screen asks; the screen's own controls never take it, nor the focus.
        onPointerDownCapture={(event) => {
          if (asking && (event.target as Element).closest(".canvas-flow-live")) event.preventDefault();
        }}
        onPointerDown={(event) => {
          const target = event.target as Element;
          if (event.button !== 0 || target.closest(".canvas-pin, .canvas-annotation-card, select, button:not(.canvas-flow-open)")) return;
          const empty = target === event.currentTarget || target === rowRef.current || !!target.closest(".canvas-flow-arrows");
          drag.current = { x: event.clientX, y: event.clientY, moved: false, empty };
          dragged.current = false;
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          if (!d) return;
          const dx = event.clientX - d.x;
          const dy = event.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 4) return;
          if (!d.moved) event.currentTarget.setPointerCapture(event.pointerId);
          d.moved = true;
          dragged.current = true;
          touched.current = true;
          d.x = event.clientX;
          d.y = event.clientY;
          setCam((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.moved || !d.empty) return;
          if (noteOpen) onCloseNote();
          else onClose();
        }}
        // The click that ends a drag opens nothing. With the Ask agent tool, a click on a screen asks.
        onClickCapture={(event) => {
          if (dragged.current) {
            dragged.current = false;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (!asking) return;
          const hit = askTarget(event.target as Element);
          if (!hit) return;
          event.preventDefault();
          event.stopPropagation();
          if (pickRef.current) pickRef.current.hidden = true;
          const state = shown[hit.index];
          if (!hit.element || !onAskElement) return onAsk?.(hit.index, state);
          const live = lives.current[hit.index]!.getBoundingClientRect();
          // The point in the item's own pixels: the screen is drawn at `scale`, through the camera.
          const unit = scale * camRef.current.z;
          onAskElement(hit.index, describeElement(hit.element, lives.current[hit.index]!), (event.clientX - live.left) / unit, (event.clientY - live.top) / unit, state);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          ref={rowRef}
          className="canvas-flow-row"
          style={
            {
              inlineSize: width,
              blockSize: height,
              transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`,
              // Pins, lines, and borders keep one size on screen at any zoom, as pins do on the canvas.
              "--canvas-unzoom": 1 / cam.z,
              "--flow-label": 1 / labelZoom,
            } as CSSProperties
          }
        >
          {screens.map((screen, index) => (
            <div
              key={screen.path || "start"}
              className="canvas-flow-screen"
              data-current={index === current || undefined}
              data-row={places[index]?.row}
              style={{ left: boxesAt[index]?.x, top: (boxesAt[index]?.y ?? 0) - HEAD, inlineSize: w }}
            >
              {/* Named and asked about as an item is: its name, and its actions at the right while hovered. */}
              <div className="canvas-flow-head">
                <span className="canvas-flow-path">{screen.path || labels.firstScreen}</span>
                {/* The screen's states, as a variant is chosen in a design tool. A menu, not a row of
                    buttons: it fits beside the name however many states there are. */}
                {screen.states.length > 0 && (
                  <span className="canvas-flow-states">
                    <select
                      aria-label={labels.statesOf(screen.path || labels.firstScreen)}
                      value={shown[index] ?? ""}
                      onChange={(event) =>
                        setShown((was) => {
                          const next = { ...was };
                          if (event.target.value) next[index] = event.target.value;
                          else delete next[index];
                          return next;
                        })
                      }
                    >
                      <option value="">{labels.stateDefault}</option>
                      {screen.states.map(([name]) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <Icon name="stack-2" size={14} />
                  </span>
                )}
                {onAsk && (
                  <span className="canvas-item-actions">
                    <button
                      type="button"
                      className="canvas-item-action"
                      aria-label={labels.askScreen(screen.path || labels.firstScreen)}
                      data-tip={labels.askScreenHint}
                      onClick={() => onAsk(index, shown[index])}
                    >
                      <Icon name="message-circle" />
                    </button>
                  </span>
                )}
              </div>
              {/* The frame holds the screen, and beside it what must not be cut at its edge: the pins
                  and their notes, and the Ask button. The box inside it clips the screen. */}
              <span
                ref={(element) => {
                  boxes.current[index] = element;
                }}
                className="canvas-flow-frame"
                data-index={index}
                style={{ inlineSize: w, blockSize: h }}
              >
                <span className="canvas-flow-box">
                {/* Inert: a screen here is a picture of the step, and a press on it opens the item there. */}
                <span
                  ref={(element) => {
                    lives.current[index] = element;
                    if (element) element.inert = !askingRef.current;
                  }}
                  className="canvas-flow-live" style={{ inlineSize: item.width, blockSize: item.height, transform: `scale(${scale})` }}>
                  {item.viewport ? (
                    <iframe className="canvas-frame" {...frameSource(item.id, "flow", screen.path || undefined, shown[index])} title={screen.path || labels.firstScreen} width={item.width} height={item.height} onLoad={measure} />
                  ) : (
                    <RouteContext.Provider value={screen.path || null}>
                      <Shown screen={screen} state={shown[index]} />
                    </RouteContext.Provider>
                  )}
                </span>
                {/* Over the screen, not around it: a screen has buttons of its own, and a button may not hold one.
                    Not while asking: then a click on the screen asks. */}
                {!asking && (
                  <button
                    type="button"
                    className="canvas-flow-open"
                    aria-label={labels.openScreen(screen.path || labels.firstScreen)}
                    onClick={() => onOpen(index)}
                  />
                )}
                </span>
                {pinsFor(index, scale, shown[index])}
              </span>
            </div>
          ))}
          <Arrows edges={edges} layout={boxesAt} places={places} unzoom={1 / cam.z} label={1 / labelZoom} />
        </div>
      </div>
    </div>
  );
}

/** How a step is drawn: on to the next screen in its row, down into a branch, back up out of one, or a loop. */
function route(places: readonly Place[], step: { from: number; to: number }): "next" | "down" | "up" | "over" | "loop" {
  const a = places[step.from];
  const b = places[step.to];
  if (!a || !b) return "loop";
  if (a.row === b.row && b.col === a.col + 1) return "next";
  if (b.row > a.row) return "down";
  if (b.row < a.row) return "up";
  // With branches below, a step back along the main path goes over it, and leaves the space
  // between the rows to the branches.
  if (a.row === 0 && places.some((p) => p.row > 0)) return "over";
  return "loop";
}

/**
 * A step to the next screen in a row is a short arrow between the two. A step into a branch
 * goes down from the screen it leaves, and one out of a branch goes back up. Any other step
 * (back, or past a screen) loops under the layout, each in a lane of its own so the loops do
 * not cross; with more than one row, its lines run in the gaps between screens.
 */
function Arrows({
  edges,
  layout,
  places,
  unzoom,
  label: unit,
}: {
  edges: Edge[];
  layout: Box[];
  places: readonly Place[];
  /** Keeps a line and its head one size on screen. */
  unzoom: number;
  /** The size of a pixel of the words, which scale with the view. */
  label: number;
}) {
  if (layout.length < 2) return null;
  const bottom = Math.max(...layout.map((b) => b.y + b.h));
  const oneRow = layout.every((b) => b.row === 0);
  // Lanes go to the shorter loops first, so a loop sits inside the longer ones and none cross.
  const laneOf = new Map<Edge, number>();
  for (const kind of ["loop", "over"] as const) {
    edges
      .filter((e) => route(places, e) === kind)
      .sort((x, y) => Math.abs(layout[x.to]!.x - layout[x.from]!.x) - Math.abs(layout[y.to]!.x - layout[y.from]!.x))
      .forEach((e, n) => laneOf.set(e, n + 1));
  }
  const words = (text: string, x: number, y: number, anchor: "middle" | "start" | "end" = "middle", onLine = false) => (
    <text x={x} y={y} style={{ textAnchor: anchor }} className={onLine ? "canvas-flow-on-line" : undefined}>
      {text}
    </text>
  );
  return (
    <svg className="canvas-flow-arrows" aria-hidden="true">
      <defs>
        <marker id="canvas-flow-head" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth={7 * unzoom} markerHeight={7 * unzoom} orient="auto-start-reverse">
          <path d="M1 1l8 4l-8 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>
      {edges.map((edge) => {
        const { from, to, label } = edge;
        const a = layout[from];
        const b = layout[to];
        if (!a || !b) return null;
        const key = `${from}-${to}`;
        const kind = route(places, edge);
        const text = label && labels.flowStep(label);
        if (kind === "next") {
          const y = a.y + a.h / 2;
          return (
            <g key={key}>
              <path d={`M${a.x + a.w + 6} ${y}H${b.x - 6}`} markerEnd="url(#canvas-flow-head)" />
              {/* Between two screens there is little room: a long label takes two lines, above the arrow. */}
              {text &&
                lines(text, SHORT_LINE, 2)
                  .reverse()
                  .map((line, n) => <g key={n}>{words(line, (a.x + a.w + b.x) / 2, y - (8 + n * 14) * unit)}</g>)}
            </g>
          );
        }
        if (kind === "down" || kind === "up") {
          // Down from the bottom of one screen to the top of the next one's name; up the other way.
          // Side by side when both go between the same two columns, so they do not lie on each other.
          const down = kind === "down";
          const shift = a.col === b.col ? (down ? -10 : 10) : 0;
          const x1 = a.x + a.w / 2 + shift;
          const x2 = b.x + b.w / 2 + shift;
          const y1 = down ? a.y + a.h + 4 : a.y - HEAD - 4;
          const y2 = down ? b.y - HEAD - 6 : b.y + b.h + 6;
          const mid = (y1 + y2) / 2;
          const d = x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}V${mid}H${x2}V${y2}`;
          return (
            <g key={key}>
              <path d={d} markerEnd="url(#canvas-flow-head)" />
              {text &&
                (x1 === x2
                  ? words(clip(text, 40), x1 + (down ? -8 : 8) * unit, mid + 4 * unit, down ? "end" : "start")
                  : words(clip(text, 40), (x1 + x2) / 2, mid - 6 * unit))}
            </g>
          );
        }
        if (kind === "over") {
          // Up from the top of the screen's name, along a lane over the row, and down onto the other.
          const rise = a.y - HEAD - 10 - (laneOf.get(edge) ?? 1) * LANE;
          const right = b.x > a.x;
          const x1 = a.x + a.w / 2 + (right ? 12 : -12);
          const x2 = b.x + b.w / 2 + (right ? -12 : 12);
          const t = Math.sign(x2 - x1) * 8;
          return (
            <g key={key}>
              <path
                d={`M${x1} ${a.y - HEAD - 4}V${rise + 8}Q${x1} ${rise} ${x1 + t} ${rise}H${x2 - t}Q${x2} ${rise} ${x2} ${rise + 8}V${b.y - HEAD - 6}`}
                markerEnd="url(#canvas-flow-head)"
              />
              {text && words(clip(text, 40), (x1 + x2) / 2, rise + 4 * unit, "middle", true)}
            </g>
          );
        }
        const dip = bottom + 10 + (laneOf.get(edge) ?? 1) * LANE;
        const right = b.x > a.x;
        const x1 = a.x + a.w / 2 + (right ? 12 : -12);
        const x2 = b.x + b.w / 2 + (right ? -12 : 12);
        const turn = (from: number, to: number) => Math.sign(to - from) * 8;
        let d: string;
        if (oneRow) {
          d = `M${x1} ${a.y + a.h + 4}V${dip - 8}Q${x1} ${dip} ${x1 + turn(x1, x2)} ${dip}H${x2 - turn(x1, x2)}Q${x2} ${dip} ${x2} ${dip - 8}V${b.y + b.h + 6}`;
        } else {
          // Out from under the screen, along the gap beside it, so the line passes no screen below.
          const g1 = right ? a.x + a.w + GAP / 2 : a.x - GAP / 2;
          const g2 = right ? b.x - GAP / 2 : b.x + b.w + GAP / 2;
          const yA = a.y + a.h + 16;
          const yB = b.y + b.h + 16;
          d = `M${x1} ${a.y + a.h + 4}V${yA}H${g1}V${dip}H${g2}V${yB}H${x2}V${b.y + b.h + 6}`;
        }
        return (
          <g key={key}>
            <path d={d} markerEnd="url(#canvas-flow-head)" />
            {/* On the line, with the canvas color behind the words, so the line does not cross them. */}
            {text && words(clip(text, 40), (x1 + x2) / 2, dip + 4 * unit, "middle", true)}
          </g>
        );
      })}
    </svg>
  );
}
