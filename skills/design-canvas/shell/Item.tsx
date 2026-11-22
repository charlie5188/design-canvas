// One item on the canvas: its title row and controls, caption, preview, resize handles, and pins.
import { type PointerEvent as ReactPointerEvent, useCallback, useContext, useEffect, useRef, useState } from "react";
import { type AnnotationHandlers, AnnotationLink, AnnotationPin } from "./AnnotationView";
import { type Annotation, fingerprintItem } from "./annotations";
import { type BoardEdge, DiscardButton, SAVE_OVERDUE_MS, useOverdue, WorkingBeam, WorkingTag } from "./Board";
import { frameUrl, hasAddress } from "./bridge";
import type { Fresh } from "./fresh";
import { AnnotateIcon, CopyIcon, GripIcon, Icon, MoreIcon, OpenIcon, PickIcon, RestartIcon, RouteIcon, StartHereIcon, StatesIcon, TrashIcon } from "./icons";
import { labels } from "./labels";
import type { Position } from "./layout";
import type { MoveSent } from "./marks";
import { ItemFrame, Preview } from "./Preview";
import { LocationContext, locationIn, pathPart, RouteContext, ScreenRouter, screenAt, screensOf, stateCount } from "./routes";
import { Trail } from "./start";
import type { CanvasItem } from "./types";

const MOVE_STEP = 8;

/**
 * The actions an item needs seldom: open it alone, and move it to the trash. They sit behind
 * one "More" button, so the row has at most three fixed controls, and the trash is not one
 * press away, beside the controls used all the time. Opened by a press; Escape, a press
 * outside it, or a choice closes it.
 */
function ItemMore({
  item,
  onTrash,
  onCopyName,
  onStartHere,
}: {
  item: CanvasItem;
  onTrash?: (item: CanvasItem) => void;
  onCopyName?: (name: string) => void;
  /** Present once the item has left its start (start.ts). */
  onStartHere?: () => void;
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
  // A shared file is read-only: nothing to trash, so with no address to open either, there is no menu.
  if (!onTrash && !hasAddress && !onCopyName) return null;
  return (
    <span className="canvas-item-more" ref={wrap}>
      <button
        type="button"
        className="canvas-item-action"
        aria-label={labels.more(item.name)}
        aria-expanded={open}
        data-tip={open ? undefined : labels.moreHint}
        onClick={() => setOpen((was) => !was)}
      >
        <MoreIcon />
      </button>
      {open && (
        <span className="canvas-item-menu" role="group" aria-label={labels.more(item.name)}>
          {/* First: when it shows, the person has just brought the item somewhere, and this is
              the one entry about where it is now. Seldom used, so in the menu, not beside Restart. */}
          {onStartHere && (
            <button
              type="button"
              className="canvas-item-menu-entry"
              aria-label={labels.startHere(item.name)}
              onClick={() => {
                setOpen(false);
                onStartHere();
              }}
            >
              <StartHereIcon />
              {labels.startHereHint}
            </button>
          )}
          {/* A new tab keeps the canvas, its camera, and preview state intact.
              A shared file shown inside another page has no address to open. */}
          {hasAddress && (
            <a
              className="canvas-item-menu-entry canvas-open"
              href={frameUrl(item.id)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={labels.openAlone(item.name)}
              onClick={() => setOpen(false)}
            >
              <OpenIcon />
              {labels.openAloneHint}
            </a>
          )}
          {/* The name is unique on the canvas, so pasting two or three names into the chat
              ("merge the header of A with the list of B") is enough for the agent to find them. */}
          {onCopyName && (
            <button
              type="button"
              className="canvas-item-menu-entry"
              aria-label={labels.copyName(item.name)}
              onClick={() => {
                setOpen(false);
                onCopyName(item.name);
              }}
            >
              <CopyIcon />
              {labels.copyNameHint}
            </button>
          )}
          {onTrash && (
            <button
              type="button"
              className="canvas-item-menu-entry"
              aria-label={labels.moveToTrash(item.name)}
              onClick={() => {
                setOpen(false);
                onTrash(item);
              }}
            >
              <TrashIcon />
              {labels.moveToTrashHint}
            </button>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * The caption under an item's name. Double-click edits it; Enter or leaving the
 * field saves, Escape cancels. Saving is the page's job (saveCaption), not the agent's.
 */
function ItemCaption({ text, editable, onSave }: { text: string; editable: boolean; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // Leaving the field after Enter or Escape must not save a second time.
  const finished = useRef(false);
  const editing = draft !== null;
  useEffect(() => {
    if (!editing) return;
    fieldRef.current?.focus({ preventScroll: true });
    fieldRef.current?.select();
  }, [editing]);
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const next = draft?.trim();
    setDraft(null);
    if (save && next && next !== text) onSave(next);
  };
  if (editing) {
    return (
      <textarea
        ref={fieldRef}
        className="canvas-caption-field"
        rows={1}
        value={draft}
        aria-label={labels.captionLabel}
        // A caption is one line.
        onChange={(event) => setDraft(event.currentTarget.value.replace(/\r?\n/g, " "))}
        onKeyDown={(event) => {
          // The canvas's own keys (A, N, S, Delete) stay out of a field.
          event.stopPropagation();
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
      />
    );
  }
  return (
    <p
      className="canvas-note canvas-subtle"
      data-editable={editable || undefined}
      data-tip={editable ? labels.captionHint : undefined}
      onDoubleClick={
        editable
          ? () => {
              finished.current = false;
              setDraft(text);
            }
          : undefined
      }
    >
      {text}
    </p>
  );
}

/** The eight places an item can be grabbed to resize it, like the border of an OS window. */
export type ResizeEdge = BoardEdge;
const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];

export function CanvasItemView({
  item,
  position,
  front,
  register,
  onFront,
  onTitlePointerDown,
  onHandleKey,
  onResize,
  pins,
  links = [],
  asking,
  openAnnotation,
  annotationHandlers,
  onTrash,
  onCopyName,
  onAsk,
  onStartHere,
  route,
  onRestart,
  onFlow,
  onPickVersion,
  onUnpick,
  picked,
  move,
  onUndoMove,
  caption,
  editable,
  onCaption,
  working,
  agentWorking,
  fresh,
  selected,
}: {
  item: CanvasItem;
  position: Position;
  /** The item last touched or focused sits above overlapping items. */
  front: boolean;
  register: (id: string, element: HTMLDivElement | null) => void;
  onFront: (id: string) => void;
  onTitlePointerDown: (event: ReactPointerEvent<HTMLElement>, item: CanvasItem) => void;
  onHandleKey: (item: CanvasItem, dx: number, dy: number) => void;
  /** Absent where nothing can be saved or while annotating. */
  onResize?: (event: ReactPointerEvent<HTMLElement>, item: CanvasItem, edge: ResizeEdge) => void;
  /** This item's annotations with their list numbers. */
  pins: { annotation: Annotation; number?: number }[];
  /** Notes on several items whose pin is on another of them: each draws its outline here. */
  links?: Annotation[];
  /**
   * Touched by a box drawn with Ask agent: while it is drawn, the item shows the outline the
   * note it opens will have; just after, that note's outline shows at once, with no fade.
   */
  asking?: "drawing" | "landed";
  openAnnotation: string | null;
  annotationHandlers: AnnotationHandlers;
  onTrash?: (item: CanvasItem) => void;
  onCopyName?: (name: string) => void;
  /** Opens a note about the whole item. Absent in a shared file, which has no agent. */
  onAsk?: (item: CanvasItem) => void;
  /** Opens a "Start here" note on the item with these words (start.ts). Absent in a shared file. */
  onStartHere?: (item: CanvasItem, text: string) => void;
  /** The path of the screen a plain item shows now, when a link took it past its first one (routes.ts). */
  route?: string;
  /** Restart: the item goes back to its first screen. */
  onRestart: (id: string) => void;
  /** Opens the flow view of an item with more than one screen (FlowView.tsx). */
  onFlow: (item: CanvasItem) => void;
  /** Absent where a pick cannot be saved or would mean nothing: a shared file, while annotating, an item already set aside. */
  onPickVersion?: (item: CanvasItem) => void;
  /** Takes the pick back. Absent where nothing can be saved: a shared file, while annotating. */
  onUnpick?: (item: CanvasItem) => void;
  /** This is the version the person chose. */
  picked: boolean;
  /** Set while the item sits somewhere the registry does not have it. */
  move?: MoveSent["state"] | "new";
  onUndoMove: (item: CanvasItem) => void;
  /** The caption as shown: the person's edit until the registry has it. */
  caption: string | undefined;
  /** False in a shared file, where nothing can be saved. */
  editable: boolean;
  onCaption: (item: CanvasItem, text: string) => void;
  /** The agent is working on notes sent about this item: a tag and a light around it. */
  working: boolean;
  /** The agent is handling a message: a sent move is part of it. */
  agentWorking: boolean;
  /** Added or changed by the agent, and not seen yet. */
  fresh?: Fresh;
  /** Selected on the canvas (a click on its name, Shift + click, or a box drawn over it): it moves and goes to the trash with the rest of the selection. */
  selected?: boolean;
}) {
  // An item has one place for its state, under the bottom-right corner of its
  // card (canvas.css says why there), and one state shows there at a time. In order: what the agent is doing; a change that
  // waits for the agent or could not be saved; what is new and not seen yet; a
  // save that is overdue (the usual save says nothing, see useOverdue); and, when
  // nothing is going on, the lasting fact that this version was picked.
  const savingLate = useOverdue(move === "saving", SAVE_OVERDUE_MS);
  const waiting = move === "sent" || move === "queued" || move === "failed" ? move : undefined;
  const tag = working || (agentWorking && move === "sent") ? "working" : (waiting ?? fresh ?? (savingLate ? "saving" : picked ? "picked" : undefined));
  const ref = useCallback((element: HTMLDivElement | null) => register(item.id, element), [item.id, register]);

  // Restart. An item can hold a whole flow, and the person steps through it. To see it
  // from the start again, the only way was to reload the page, which restarts every item.
  // So an item the person has used gets a Restart action beside its name. It shows only
  // once the item's content differs from what it was before the person first touched it:
  // an item nobody used, or one that only shows a design, never has it.
  //   - `run` is the key of the item's content. A new key mounts it again: a plain item's
  //     component starts over, and a viewport item's frame loads again.
  //   - `before` is the content as it was at the first press or key since it was mounted
  //     (taken in the capture phase, so before the item's own handlers change anything).
  //     After each press, key, or input the content is read again, a moment later and once
  //     more for a change that takes a little time, and compared with it.
  //   - A frame's events do not reach this document, so they are heard in the frame's own.
  //   - A click in Ask agent mode changes nothing in the item, so it shows nothing.
  const [run, setRun] = useState(0);
  const [used, setUsed] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const before = useRef<string | undefined>(undefined);
  // What the person did since the item's start, for Start here (start.ts).
  const trail = useRef(new Trail());
  const stateOf = useCallback(() => {
    const preview = previewRef.current;
    const print = fingerprintItem(preview);
    if (!preview || print === undefined) return undefined;
    // What a field holds is not in the markup, so it is read too.
    let root: ParentNode = preview;
    try {
      root = preview.querySelector<HTMLIFrameElement>("iframe[data-canvas-frame]")?.contentDocument ?? preview;
    } catch {
      // A frame that cannot be read: its markup alone decides.
    }
    const fields = [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")]
      .map((field) => ("checked" in field && (field.type === "checkbox" || field.type === "radio") ? String(field.checked) : field.value))
      .join("\u0001");
    return `${print}\u0000${fields}`;
  }, []);
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    const timers = new Set<number>();
    const touch = () => {
      if (before.current === undefined) before.current = stateOf();
    };
    const look = () => {
      for (const wait of [60, 500]) {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          const now = stateOf();
          if (before.current !== undefined && now !== undefined) setUsed(now !== before.current);
        }, wait);
        timers.add(timer);
      }
    };
    const heard: [EventTarget, string, () => void][] = [];
    // Each run starts at the item's start, so it starts with no steps.
    trail.current.reset();
    const unhear: (() => void)[] = [];
    // A frame's item is its whole body: a press in a dialog the item portaled there is a step too (dom.ts frameLayers).
    const frameRoot = () => {
      try {
        const doc = preview.querySelector<HTMLIFrameElement>("iframe[data-canvas-frame]")?.contentDocument;
        return doc?.querySelector(".canvas-frame-root") ? doc.body : null;
      } catch {
        return null;
      }
    };
    const hear = (target: EventTarget, root: () => Element | null | undefined = () => preview) => {
      unhear.push(trail.current.listen(target, root, stateOf));
      for (const [type, handler] of [
        ["pointerdown", touch],
        ["keydown", touch],
        ["pointerup", look],
        ["keyup", look],
        ["input", look],
        ["change", look],
      ] as const) {
        target.addEventListener(type, handler, true);
        heard.push([target, type, handler]);
      }
    };
    hear(preview);
    // A frame gets a new document each time it loads.
    const frame = preview.querySelector<HTMLIFrameElement>("iframe[data-canvas-frame]");
    let heardDoc: Document | null = null;
    const hearFrame = () => {
      try {
        const doc = frame?.contentDocument;
        // Once per document. On a slow machine the frame's own document is already there when
        // this runs, and its load event still comes after: heard twice, every press in it was a
        // step twice in Start here (GitHub's runner; locally with the CPU slowed down 8 times).
        if (doc && doc !== heardDoc) {
          heardDoc = doc;
          hear(doc, frameRoot);
        }
      } catch {
        // Not readable: this item gets no Restart.
      }
    };
    hearFrame();
    // A frame that loads again is at its start again (a hot update can reload it).
    const frameLoaded = () => {
      trail.current.reset();
      hearFrame();
    };
    frame?.addEventListener("load", frameLoaded);
    return () => {
      frame?.removeEventListener("load", frameLoaded);
      for (const stop of unhear) stop();
      for (const [target, type, handler] of heard) target.removeEventListener(type, handler, true);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [run, stateOf]);
  const restart = () => {
    before.current = undefined;
    setUsed(false);
    setRun((n) => n + 1);
    onRestart(item.id);
  };
  // Start here: the note names the screen shown and what led to it. A frame keeps its own
  // screen and says which on its document (FrameHost.tsx); a plain item's is `route`.
  const startHere = () => {
    let screen = route ?? item.start ?? item.path;
    if (item.viewport) {
      try {
        screen = previewRef.current?.querySelector<HTMLIFrameElement>("iframe[data-canvas-frame]")?.contentDocument?.documentElement.dataset.canvasScreen || screen;
      } catch {
        // Not readable: the item's own path stands for it.
      }
    }
    const { steps, earlier } = trail.current.lines();
    onStartHere?.(item, labels.startHereNote(screen, steps, earlier));
  };
  // The screen shown: the item's own component, or the one a link inside it led to.
  // With no route yet, the item is at its start: `start` when the agent set one (types.ts).
  const at = route ?? item.start;
  const Shown = (at && screenAt(item, at)) || item.component;
  // The app's router around it, when its components need one (routes.ts ScreenRouter).
  const Router = useContext(ScreenRouter);
  const screenCount = screensOf(item).length;
  const states = stateCount(item);

  return (
    <div
      ref={ref}
      className="canvas-item"
      data-canvas-item={item.id}
      data-front={front || undefined}
      data-working={working || undefined}
      data-picked={picked || undefined}
      data-selected={selected || undefined}
      style={{ transform: `translate(${position.x}px, ${position.y}px)`, inlineSize: item.width }}
      onPointerDownCapture={() => onFront(item.id)}
      onFocus={() => onFront(item.id)}
    >
      {tag === "working" ? (
        <WorkingTag />
      ) : tag === "new" ? (
        <span className="canvas-ghost-tag canvas-item-tag" data-state="fresh">
          {labels.freshNew}
        </span>
      ) : tag === "updated" ? (
        <span className="canvas-ghost-tag canvas-item-tag" data-state="fresh">
          {labels.freshUpdated}
        </span>
      ) : tag === "picked" ? (
        <span className="canvas-ghost-tag canvas-item-tag" data-state="picked">
          <PickIcon />
          {labels.picked}
          {/* The way back from a pick. On the tag, where the pick is shown, and only
              while the item is hovered, so the lasting tag stays quiet. */}
          {onUnpick && (
            <button
              type="button"
              className="canvas-ghost-delete canvas-unpick"
              aria-label={labels.unpick(item.name)}
              data-tip={labels.unpickHint}
              onClick={() => onUnpick(item)}
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </span>
      ) : tag ? (
        <span className="canvas-ghost-tag canvas-item-tag" data-state={tag}>
          {tag === "sent" ? labels.boardSent : tag === "queued" ? labels.boardQueued : tag === "failed" ? labels.boardNotApplied : labels.boardSaving}
          {tag !== "saving" && <DiscardButton onClick={() => onUndoMove(item)} />}
        </span>
      ) : null}
      <div className="canvas-item-head">
        <span className="canvas-item-title" onPointerDown={(event) => onTitlePointerDown(event, item)}>
          <button
            type="button"
            className="canvas-handle"
            aria-label={labels.move(item.name)}
            aria-describedby="canvas-move-help"
            onKeyDown={(event) => {
              const step = event.shiftKey ? MOVE_STEP * 8 : MOVE_STEP;
              const delta = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              }[event.key];
              if (!delta) return;
              event.preventDefault();
              event.stopPropagation();
              onHandleKey(item, delta[0]!, delta[1]!);
            }}
          >
            <GripIcon />
          </button>
          {/* The name shows what the item is and moves it when dragged. It no longer copies
              on a click: Ask agent carries an item's name to the agent by itself. */}
          <span className="canvas-name" title={item.name}>
            {item.name}
          </span>
          {/* Says the item holds a flow, and opens it up. Beside the name, not with the actions
              that show on hover: it tells what the item is, so it is always there. */}
          {(screenCount > 1 || states > 0) && (
            <button
              type="button"
              className="canvas-item-screens"
              aria-label={labels.showFlow(item.name, screenCount, states)}
              data-tip={labels.flowHint(screenCount, states)}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onFlow(item)}
            >
              {screenCount > 1 && (
                <>
                  <RouteIcon />
                  {screenCount}
                </>
              )}
              {states > 0 && (
                <>
                  <StatesIcon />
                  {states}
                </>
              )}
            </button>
          )}
          {/* The item's actions, at the frame's top right, where they do not move with the
              length of the name. At most three are fixed: Ask agent about the whole item, Pick
              (with its word: it is the decision the canvas is for), and More. Restart comes
              first, so nothing moves when it appears. They show while the item is hovered. */}
          <span className="canvas-item-actions">
            {/* Also when a link in another item brought this one to a later screen: the person did not touch it, and it is not at its start. */}
            {(used || !!route) && (
              <button type="button" className="canvas-item-action" aria-label={labels.restart(item.name)} data-tip={labels.restartHint} onClick={restart}>
                <RestartIcon />
              </button>
            )}
            {onAsk && (
              <button type="button" className="canvas-item-action" aria-label={labels.askItem(item.name)} data-tip={labels.askItemHint} onClick={() => onAsk(item)}>
                <AnnotateIcon />
              </button>
            )}
            {onPickVersion && !picked && (
              <button type="button" className="canvas-item-action" aria-label={labels.pick(item.name)} data-tip={labels.pickShort} onClick={() => onPickVersion(item)}>
                <PickIcon />
              </button>
            )}
            <ItemMore item={item} onTrash={onTrash} onCopyName={onCopyName} onStartHere={(used || !!route) && onStartHere ? startHere : undefined} />
          </span>
        </span>
        {caption && <ItemCaption text={caption} editable={editable} onSave={(text) => onCaption(item, text)} />}
      </div>
      <div className="canvas-preview-wrap">
        <div
          ref={previewRef}
          className="canvas-preview"
          data-canvas-preview={item.id}
          style={{ inlineSize: item.width, blockSize: item.height }}
        >
          {item.viewport ? (
            <ItemFrame key={run} item={item} />
          ) : (
            // The path, query, and params are there for a router stand-in's `usePathname`,
            // `useSearchParams`, and `useParams`. A frame provides its own.
            <RouteContext.Provider value={at ? pathPart(at) : (item.path ?? null)}>
              <LocationContext.Provider value={at || item.path ? locationIn(item, at ?? item.path ?? "") : null}>
                {Router ? (
                  <Router>
                    <Preview key={run} component={Shown} />
                  </Router>
                ) : (
                  <Preview key={run} component={Shown} />
                )}
              </LocationContext.Provider>
            </RouteContext.Provider>
          )}
        </div>
        <WorkingBeam on={working} />
        {onResize &&
          RESIZE_EDGES.map((edge) => (
            // Invisible: only the cursor changes over them, like an OS window's border.
            <span key={edge} className="canvas-item-edge" data-edge={edge} aria-hidden="true" onPointerDown={(event) => onResize(event, item, edge)} />
          ))}
        {(pins.length + links.length > 0 || asking === "drawing") && (
          <div className="canvas-pins">
            {asking === "drawing" && <AnnotationLink open sent={false} still />}
            {links.map((annotation) => (
              <AnnotationLink key={annotation.id} open={openAnnotation === annotation.id} sent={!!(annotation.sent || annotation.queued)} still={!!asking} />
            ))}
            {pins.map(({ annotation, number }) => (
              <AnnotationPin
                key={annotation.id}
                annotation={annotation}
                number={number}
                open={openAnnotation === annotation.id}
                handlers={annotationHandlers}
                still={!!asking}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
