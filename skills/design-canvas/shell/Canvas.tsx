import {
  type ComponentType,
  type CSSProperties,
  memo,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { downloadSharedFile, sendToAgent, useAgentStatus } from "./agent";
import { type BoardEdge, type BoardHandlers, type BoardRef, DiscardButton, MarkView, NoteView, SectionView } from "./Board";
import {
  type BoardContext,
  type BoardKind,
  type BoardMark,
  formatBoard,
  formatMoves,
  isApplied,
  isUnchanged,
  limitMarkText,
  loadMarks,
  loadMoves,
  type MovedItem,
  type MoveStates,
  NOTE_WIDTH,
  newMarkId,
  saveMarks,
  saveMoves,
  sentTargets,
  foldedNotes,
  type MoveSent,
} from "./marks";
import {
  frameParams,
  frameSource,
  frameUrl,
  fromThisCanvas,
  hasAddress,
  NAVIGATE_EVENT,
  postToFrame,
  readFrameMessage,
  shared,
  sharedStorageKey,
} from "./bridge";
import { FrameHost } from "./FrameHost";
import {
  type Annotation,
  fingerprintItem,
  formatAnnotations,
  limitText,
  loadAnnotations,
  newAnnotationId,
  placeOf,
  saveAnnotations,
} from "./annotations";
import {
  CHROME,
  describeArea,
  describeElement,
  isEditable,
  nestedCanScroll,
  pickElement,
  previewLink,
  wheelPixels,
} from "./dom";
import { labels } from "./labels";
import {
  type Bounds,
  type Camera,
  clampZoom,
  fitBounds,
  loadLayout,
  nextZoomStop,
  ZOOM_MAX,
  type Position,
  sanitizeCamera,
  sanitizePosition,
  saveLayout,
  zoomAt,
} from "./layout";
import { type ThemeStore, useThemeId } from "./theme";
import type { CanvasItem, CanvasNote, CanvasSection } from "./types";
import { EDIT_PATH, VERSION_PATH } from "./channel.ts";
import type { DirectAdd, DirectEdit, DirectRemove } from "./registry-edit.ts";
import "./canvas.css";

const DEFAULT_CAMERA: Camera = { x: 48, y: 120, z: 1 };
const WHEEL_ZOOM = 0.0025;
const KEY_PAN = 48;
const MOVE_STEP = 8;
const DRAG_THRESHOLD = 3;
const SAVE_DELAY = 400;
const SAVE_MAX_WAIT = 2000;
/**
 * How long a trash write the registry took may still hide what the registry says.
 * Its own update arrives well within it; after it, a change made in source right
 * after the write (by the agent or another tab) shows instead of staying hidden.
 */
const TRASH_WRITE_GRACE = 3000;
const TOAST_MS = 2500;
const TOAST_ACTION_MS = 8000;
/** Space a note keeps from the viewport edge before it opens on the other side. */
const FLIP_MARGIN = 16;
const ADD_GAP = 96;
const REVEAL_MARGIN = 48;
/** The notice row that opens just above the toolbar. */
const TOAST_ROW = 64;
const MIN_FIT_SIZE = 100;
/** Room the top bars take, so a revealed or fitted item never sits under them. */
const CHROME_TOP = 72;
const FIT_PADDING = 72;
/** Two presses this close, without moving, are a double-click. */
const DOUBLE_TAP_MS = 400;
/** About the height of an item's title above its preview, for telling which items a section holds. */
const ITEM_HEAD = 48;
/** Room a section's title takes above its frame, in canvas units. */
const SECTION_TITLE_ROOM = 32;
/** The smallest section a drag makes; anything smaller reads as a stray click. */
const SECTION_MIN_W = 80;
const SECTION_MIN_H = 60;
/**
 * A note inside a section that is being moved. `ghost` says `id` is a mark (a
 * new note, or a change already made to a registry note); otherwise `id` is the
 * registry note, which gets a mark once it actually moves.
 */
type CarriedNote = { id: string; ghost: boolean; x: number; y: number };
/** One saved change and what undoes it. `positions` are items' places in the browser, which go back with their registry values. */
type SavedChange = { edits: DirectEdit[]; removes: DirectRemove[]; adds: DirectAdd[]; positions: Record<string, { x: number; y: number }> };
const HISTORY_LIMIT = 30;
/** A text field, where Delete, Backspace, and ⌘/Ctrl + Z belong to the text. Buttons and the canvas itself are not. */
const typingIn = (element: Element) => element.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']") !== null;
/** The marks that are a change of their own: a note folded into its section's change is counted with that section. */
const standalone = (list: BoardMark[], all: BoardMark[]) => {
  const folded = foldedNotes(all);
  return list.filter((m) => !folded.has(m.id));
};

/** Previews never rerender because of the camera, a move, or a copy. */
const Preview = memo(function Preview({ component: Component }: { component: ComponentType }) {
  return <Component />;
});

/** Viewport items live in their own document, so breakpoints see the item size. */
const ItemFrame = memo(function ItemFrame({ item }: { item: CanvasItem }) {
  return (
    <iframe
      className="canvas-frame"
      data-canvas-frame={item.id}
      {...frameSource(item.id, "canvas")}
      title={item.name}
      width={item.width}
      height={item.height}
    />
  );
});

const GripIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <circle cx="6" cy="4" r="1.2" />
    <circle cx="10" cy="4" r="1.2" />
    <circle cx="6" cy="8" r="1.2" />
    <circle cx="10" cy="8" r="1.2" />
    <circle cx="6" cy="12" r="1.2" />
    <circle cx="10" cy="12" r="1.2" />
  </svg>
);

const OpenIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 3h4v4" />
    <path d="M13 3 7.5 8.5" />
    <path d="M11 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5" />
  </svg>
);

/** Toolbar icons: 16px outline, drawn in the text color. */
const ToolIcon = ({ children }: { children: ReactNode }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);
const MinusIcon = () => (
  <ToolIcon>
    <path d="M3.5 8h9" />
  </ToolIcon>
);
const PlusIcon = () => (
  <ToolIcon>
    <path d="M3.5 8h9M8 3.5v9" />
  </ToolIcon>
);
const FitIcon = () => (
  <ToolIcon>
    <path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" />
  </ToolIcon>
);
const ResetIcon = () => (
  <ToolIcon>
    <path d="M3 8a5 5 0 1 0 1.5-3.6" />
    <path d="M3 2.5v2.5h2.5" />
  </ToolIcon>
);
const SunIcon = () => (
  <ToolIcon>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05" />
  </ToolIcon>
);
const MoonIcon = () => (
  <ToolIcon>
    <path d="M13 9.6A5.5 5.5 0 1 1 6.4 3a4.4 4.4 0 0 0 6.6 6.6Z" />
  </ToolIcon>
);
/** Light and dark get icons; other themes show their label. */
const THEME_ICONS: Partial<Record<string, () => ReactNode>> = { light: SunIcon, dark: MoonIcon };

const AnnotateIcon = () => (
  <ToolIcon>
    <path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" />
  </ToolIcon>
);
const SelectIcon = () => (
  <ToolIcon>
    <path d="M3.5 2.5 12.5 7l-4 1.2L7 12.5Z" />
  </ToolIcon>
);
const NoteIcon = () => (
  <ToolIcon>
    <path d="M3 2.5h10v7.5l-3.5 3.5H3Z" />
    <path d="M13 10H9.5v3.5" />
  </ToolIcon>
);
const SectionIcon = () => (
  <ToolIcon>
    <rect x="2" y="3.5" width="12" height="9.5" rx="1.5" strokeDasharray="2.5 2" />
    <path d="M2 1.75h4" />
  </ToolIcon>
);
const CopyIcon = () => (
  <ToolIcon>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </ToolIcon>
);
const SendIcon = () => (
  <ToolIcon>
    <path d="M8 13V3.5M4 7.5l4-4 4 4" />
  </ToolIcon>
);
const TrashIcon = () => (
  <ToolIcon>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1" />
  </ToolIcon>
);

const EraserIcon = () => (
  <ToolIcon>
    <path d="M9.5 2.5 13.5 6.5 7 13 3 9Z" />
    <path d="M5.9 6.1 9.9 10.1" />
    <path d="M7.5 13.5h6" />
  </ToolIcon>
);

const SentIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
  </svg>
);
const QueuedIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3l2 1.5" />
  </svg>
);

const ShareIcon = () => (
  <ToolIcon>
    <path d="M8 10V2.5M5 5.5l3-3 3 3" />
    <path d="M4.5 7.5h-1v6h9v-6h-1" />
  </ToolIcon>
);
const CloseIcon = () => (
  <ToolIcon>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </ToolIcon>
);
const HelpIcon = () => (
  <ToolIcon>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M6.4 6.4a1.7 1.7 0 0 1 3.3.5c0 1.1-1.7 1.4-1.7 2.4" />
    <path d="M8 11.2h.01" />
  </ToolIcon>
);

async function writeClipboard(text: string) {
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
  await navigator.clipboard.writeText(text);
}

function NameButton({
  name,
  announce,
  children,
}: {
  name: string;
  announce: (text: string) => void;
  /** Controls that sit right after the name, before any copy feedback. */
  children?: ReactNode;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await writeClipboard(name);
      setState("copied");
      announce(labels.copiedText(name));
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("failed");
    }
  };
  return (
    <span className="canvas-name-row">
      <button type="button" className="canvas-name" data-tip={labels.copyNameHint} onClick={() => void copy()}>
        {name}
      </button>
      {children}
      {state === "copied" && (
        <span className="canvas-subtle" aria-hidden="true">
          {labels.copied}
        </span>
      )}
      {state === "failed" && (
        <span className="canvas-copy-fallback">
          <input
            readOnly
            value={name}
            aria-label={labels.copyFailed}
            onFocus={(event) => event.currentTarget.select()}
            // biome-ignore lint/a11y/noAutofocus: the fallback appears only after a copy attempt.
            autoFocus
          />
          <span className="canvas-subtle">{labels.copyFailed}</span>
        </span>
      )}
    </span>
  );
}

type AnnotationHandlers = {
  onOpen: (id: string) => void;
  onText: (id: string, text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  onVersion: (id: string, version: boolean) => void;
};

/** The open annotation: the reference it points at, the note, delete and save. */
function AnnotationCard({ annotation, handlers, done }: { annotation: Annotation; handlers: AnnotationHandlers; done: () => void }) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // The note opens on the side of the pin that has room, like a menu, so focusing
  // it never pans the canvas under the person. Then the caret goes to the end.
  useLayoutEffect(() => {
    const card = cardRef.current;
    const field = fieldRef.current;
    if (!card || !field) return;
    const view = card.closest(".canvas-viewport")?.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    if (view) {
      card.toggleAttribute("data-flip-x", box.right > view.right - FLIP_MARGIN);
      card.toggleAttribute("data-flip-y", box.top < view.top + FLIP_MARGIN);
    }
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);
  const save = () => {
    handlers.onSave();
    done();
  };
  return (
    <div
      ref={cardRef}
      className="canvas-annotation-card"
      role="dialog"
      aria-label={labels.annotationField(annotation.ref)}
      onKeyDown={(event) => {
        // Escape from the note or the checkbox undoes this card's changes.
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        handlers.onCancel();
        done();
      }}
    >
      <span className="canvas-annotation-ref">{annotation.ref}</span>
      {annotation.sent && (
        <span className="canvas-annotation-sent">{annotation.version ? labels.sentNoteVersion : labels.sentNote}</span>
      )}
      {annotation.queued && <span className="canvas-annotation-sent">{labels.queuedNote}</span>}
      <textarea
        ref={fieldRef}
        rows={3}
        value={annotation.text}
        placeholder={labels.annotationPlaceholder}
        aria-label={labels.annotationField(annotation.ref)}
        onChange={(event) => handlers.onText(annotation.id, event.currentTarget.value)}
        onKeyDown={(event) => {
          // Enter saves, Shift+Enter breaks the line; Enter that confirms an IME composition does neither.
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            save();
          }
        }}
      />
      {/* Checked: the agent keeps this item and adds a new version beside it. */}
      <label className="canvas-annotation-version">
        <input
          type="checkbox"
          checked={!!annotation.version}
          onChange={(event) => handlers.onVersion(annotation.id, event.currentTarget.checked)}
        />
        {labels.newVersion}
      </label>
      <span className="canvas-annotation-actions">
        <button
          type="button"
          className="canvas-button canvas-icon-button"
          aria-label={labels.deleteAnnotation}
          data-tip={labels.deleteAnnotation}
          onClick={() => {
            handlers.onDelete(annotation.id);
            done();
          }}
        >
          <TrashIcon />
        </button>
        <button type="button" className="canvas-button canvas-button-primary" disabled={!annotation.text.trim()} onClick={save}>
          {labels.saveAnnotation}
        </button>
      </span>
    </div>
  );
}

/**
 * A numbered pin at the point the annotation was placed. It lives in the item, so
 * it moves with it, and counter-scales so it stays the same size at any zoom.
 */
function AnnotationPin({
  annotation,
  number,
  open,
  handlers,
}: {
  annotation: Annotation;
  /** Its place in the next message; absent once sent or queued. */
  number?: number;
  open: boolean;
  handlers: AnnotationHandlers;
}) {
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const text = annotation.text || labels.annotationPlaceholder;
  return (
    <>
      {/* An area or a whole item keeps its outline, so the note shows what it covers. */}
      {annotation.w && annotation.h ? (
        <div
          className="canvas-area"
          style={{ left: annotation.x, top: annotation.y, width: annotation.w, height: annotation.h }}
          data-sent={number === undefined || undefined}
          data-open={open || undefined}
          aria-hidden="true"
        />
      ) : null}
    <div
      className="canvas-pin"
      style={{ left: annotation.x, top: annotation.y }}
      data-open={open || undefined}
      data-area={annotation.w && annotation.h ? true : undefined}
    >
      <button
        ref={bubbleRef}
        type="button"
        className="canvas-pin-bubble"
        data-sent={number === undefined || undefined}
        aria-label={
          number !== undefined
            ? labels.annotationPin(number, text)
            : annotation.queued
              ? labels.queuedPin(text)
              : labels.sentPin(text)
        }
        aria-expanded={open}
        onClick={() => (open ? handlers.onSave() : handlers.onOpen(annotation.id))}
      >
        {number ?? (annotation.queued ? <QueuedIcon /> : <SentIcon />)}
      </button>
      {open && <AnnotationCard annotation={annotation} handlers={handlers} done={() => bubbleRef.current?.focus({ preventScroll: true })} />}
    </div>
    </>
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
type ResizeEdge = BoardEdge;
const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];

function CanvasItemView({
  item,
  position,
  front,
  register,
  onFront,
  onTitlePointerDown,
  onHandleKey,
  onResize,
  announce,
  pins,
  openAnnotation,
  annotationHandlers,
  onTrash,
  move,
  onUndoMove,
  caption,
  editable,
  onCaption,
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
  announce: (text: string) => void;
  /** This item's annotations with their list numbers. */
  pins: { annotation: Annotation; number?: number }[];
  openAnnotation: string | null;
  annotationHandlers: AnnotationHandlers;
  onTrash: (item: CanvasItem) => void;
  /** Set while the item sits somewhere the registry does not have it. */
  move?: MoveSent["state"] | "new";
  onUndoMove: (item: CanvasItem) => void;
  /** The caption as shown: the person's edit until the registry has it. */
  caption: string | undefined;
  /** False in a shared file, where nothing can be saved. */
  editable: boolean;
  onCaption: (item: CanvasItem, text: string) => void;
}) {
  const ref = useCallback((element: HTMLDivElement | null) => register(item.id, element), [item.id, register]);
  return (
    <div
      ref={ref}
      className="canvas-item"
      data-canvas-item={item.id}
      data-front={front || undefined}
      style={{ transform: `translate(${position.x}px, ${position.y}px)`, inlineSize: item.width }}
      onPointerDownCapture={() => onFront(item.id)}
      onFocus={() => onFront(item.id)}
    >
      {move && (
        <span className="canvas-ghost-tag canvas-item-tag" data-state={move}>
          {move === "sent" ? labels.boardSent : move === "queued" ? labels.boardQueued : move === "failed" ? labels.boardNotApplied : labels.boardSaving}
          {move !== "new" && move !== "saving" && <DiscardButton onClick={() => onUndoMove(item)} />}
        </span>
      )}
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
          <NameButton name={item.name} announce={announce}>
            {/* A new tab keeps the canvas, its camera, and preview state intact.
                A shared file shown inside another page has no address to open. */}
            {hasAddress && (
              <a
                className="canvas-item-action canvas-open"
                href={frameUrl(item.id)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={labels.openAlone(item.name)}
                data-tip={labels.openAloneHint}
              >
                <OpenIcon />
              </a>
            )}
            <button
              type="button"
              className="canvas-item-action"
              aria-label={labels.moveToTrash(item.name)}
              data-tip={labels.moveToTrashHint}
              onClick={() => onTrash(item)}
            >
              <TrashIcon />
            </button>
          </NameButton>
        </span>
        {caption && <ItemCaption text={caption} editable={editable} onSave={(text) => onCaption(item, text)} />}
      </div>
      <div className="canvas-preview-wrap">
        <div
          className="canvas-preview"
          data-canvas-preview={item.id}
          style={{ inlineSize: item.width, blockSize: item.height }}
        >
          {item.viewport ? <ItemFrame item={item} /> : <Preview component={item.component} />}
        </div>
        {onResize &&
          RESIZE_EDGES.map((edge) => (
            // Invisible: only the cursor changes over them, like an OS window's border.
            <span key={edge} className="canvas-item-edge" data-edge={edge} aria-hidden="true" onPointerDown={(event) => onResize(event, item, edge)} />
          ))}
        {pins.length > 0 && (
          <div className="canvas-pins">
            {pins.map(({ annotation, number }) => (
              <AnnotationPin
                key={annotation.id}
                annotation={annotation}
                number={number}
                open={openAnnotation === annotation.id}
                handlers={annotationHandlers}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Room for a thumbnail inside its border. */
const THUMB_WIDTH = 154;
const THUMB_HEIGHT = 98;

/**
 * A trashed item drawn small but live: its component (or its frame page, for
 * `viewport` items) at real size, scaled down, so versions that share a name
 * pattern stay easy to tell apart. Inert, so it never takes focus or clicks;
 * it exists only while the trash is open.
 */
function TrashThumb({ item }: { item: CanvasItem }) {
  const scale = Math.min(THUMB_WIDTH / item.width, THUMB_HEIGHT / item.height, 1);
  // An attribute, not a prop: React 18 and 19 write the `inert` prop differently.
  const inert = useCallback((element: HTMLElement | null) => element?.setAttribute("inert", ""), []);
  return (
    <div className="canvas-trash-thumb" aria-hidden="true">
      <div className="canvas-trash-scaled" style={{ inlineSize: item.width * scale, blockSize: item.height * scale }}>
        <div
          ref={inert}
          className="canvas-trash-real"
          style={{ inlineSize: item.width, blockSize: item.height, transform: `scale(${scale})` }}
        >
          {item.viewport ? (
            <iframe
              className="canvas-frame"
              {...frameSource(item.id, "page")}
              title={item.name}
              width={item.width}
              height={item.height}
              tabIndex={-1}
            />
          ) : (
            <Preview component={item.component} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Opens above the toolbar, like a Dock stack: the most recently trashed item
 * first. Picking one puts it back where it was.
 */
function TrashPopover({
  items,
  onPutBack,
  onClose,
}: {
  items: CanvasItem[];
  onPutBack: (item: CanvasItem) => void;
  onClose: () => void;
}) {
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => firstRef.current?.focus({ preventScroll: true }), []);
  return (
    <div
      id="canvas-trash"
      className="canvas-trash-popover"
      role="dialog"
      aria-label={labels.trashHeading}
      style={{ "--canvas-trash-columns": Math.min(items.length, 3) } as CSSProperties}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="canvas-trash-head">
        <span className="canvas-trash-title">{labels.trashHeading}</span>
        <span className="canvas-subtle">{labels.trashHint}</span>
      </div>
      <ul className="canvas-trash-list">
        {items.map((item, index) => (
          <li key={item.id} className="canvas-trash-entry">
            <TrashThumb item={item} />
            {/* The name is the button; its hit area covers the whole entry. */}
            <button
              ref={index === 0 ? firstRef : undefined}
              type="button"
              className="canvas-trash-name"
              aria-label={labels.putBack(item.name)}
              onClick={() => onPutBack(item)}
            >
              <span>{item.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * After Share downloads the file: its name, any file it could not hold, and the
 * ways to pass it on. It confirms the download too, so no notice shows.
 */
function SharePanel({ file, missing, onClose }: { file: string; missing: string[]; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus({ preventScroll: true }), []);
  return (
    <div
      className="canvas-share-popover"
      role="dialog"
      aria-label={labels.shared(file)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="canvas-share-head">
        <span className="canvas-share-title">{labels.shared(file)}</span>
        <button
          ref={closeRef}
          type="button"
          className="canvas-button canvas-icon-button"
          aria-label={labels.dismiss}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      {missing.length > 0 && <p className="canvas-share-missing">{labels.sharedMissing(missing)}</p>}
      <ul className="canvas-share-ways">
        {labels.shareWays.map(([way, how]) => (
          <li key={way}>
            <span className="canvas-share-way">{way}</span>
            <span>{how}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Toast = { kind: "copied" | "failed" | "notice"; text: string; action?: { label: string; run: () => void } };
/**
 * The open annotation, and how it and its item's other annotations were before
 * opening, for Escape: the "new version" choice is shared across the item.
 */
type OpenAnnotation = { id: string; original: Annotation; versions: Map<string, boolean | undefined> };
/** The part of Vite's `import.meta.hot` the canvas uses; absent outside the dev server. */
type HotUpdates = { on(event: string, listener: () => void): void; off?(event: string, listener: () => void): void };

// A shared file has no annotations, so its help leaves out annotate mode.
const HELP_LINES = shared ? labels.helpLines.filter((line) => line !== labels.annotateHelp && line !== labels.saveHelp && line !== labels.editHelp) : labels.helpLines;

const NO_NOTES: CanvasNote[] = [];
const NO_SECTIONS: CanvasSection[] = [];

const sameEntry = (a: object, b: object) => {
  const [x, y] = [Object.entries(a), Object.entries(b)];
  return x.length === y.length && x.every(([key, value]) => Object.is(value, (b as Record<string, unknown>)[key]));
};

/**
 * The same array while its entries are equal. A save into registry.tsx brings new
 * `items`, `notes`, and `sections` arrays with the same content, and a new array
 * rebuilds the callbacks the pointer effect depends on, which restarts it and drops
 * a drag in progress. Entries are compared field by field (`component` by identity).
 */
function useStableList<T extends object>(list: T[]): T[] {
  const kept = useRef(list);
  if (kept.current !== list && !(kept.current.length === list.length && list.every((entry, i) => sameEntry(entry, kept.current[i]!)))) {
    kept.current = list;
  }
  return kept.current;
}

type CanvasProps = {
  items: CanvasItem[];
  /** Notes that explain the canvas to whoever opens it; see CanvasNote. */
  notes?: CanvasNote[];
  /** Titled frames that group items; see CanvasSection. */
  sections?: CanvasSection[];
  storageKey: string;
  /** The project's themes. Leave out when the project has a single theme. */
  theme?: ThemeStore;
};

/**
 * The canvas page. A shared file (scripts/share.sh) is one page for everything,
 * so there it also shows single items and item frames (see frameParams).
 */
export function Canvas(props: CanvasProps) {
  const storageKey = sharedStorageKey(props.storageKey);
  if (shared && frameParams().has("item")) return <FrameHost {...props} storageKey={storageKey} />;
  return <CanvasBoard {...props} storageKey={storageKey} />;
}

function CanvasBoard({ items: itemsProp, notes: notesProp = NO_NOTES, sections: sectionsProp = NO_SECTIONS, storageKey, theme }: CanvasProps) {
  const itemsRaw = useStableList(itemsProp);
  // A resize shows at once and is written to registry.tsx once the person pauses.
  // `bw`/`bh` are the registry's size when the override began: when the registry
  // changes (the save landed, an undo, an edit by the agent) the override is stale and dropped.
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number; bw: number; bh: number }>>({});
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;
  const itemsRawRef = useRef(itemsRaw);
  itemsRawRef.current = itemsRaw;
  const items = useMemo(
    () => (shared ? itemsRaw : itemsRaw.map((item) => (sizes[item.id] ? { ...item, width: sizes[item.id]!.w, height: sizes[item.id]!.h } : item))),
    [itemsRaw, sizes],
  );
  useEffect(() => {
    setSizes((prev) => {
      const keep = Object.entries(prev).filter(([id, s]) => {
        const raw = itemsRaw.find((item) => item.id === id);
        return raw && raw.width === s.bw && raw.height === s.bh;
      });
      return keep.length === Object.keys(prev).length ? prev : Object.fromEntries(keep);
    });
  }, [itemsRaw]);
  const notes = useStableList(notesProp);
  const sections = useStableList(sectionsProp);
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef<HTMLDivElement>(null);
  /** The rectangle being drawn in annotate mode, in screen coordinates. */
  const drawRef = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLDivElement>());
  const ids = useMemo(() => new Set(items.map((item) => item.id)), [items]);
  const themeIds = useMemo(() => new Set(theme?.options.map((option) => option.id)), [theme]);
  const saved = useMemo(() => loadLayout(storageKey, ids, themeIds), [storageKey, ids, themeIds]);
  // Restore the saved theme before the first paint.
  const restoredTheme = useRef(false);
  if (!restoredTheme.current) {
    restoredTheme.current = true;
    if (theme && saved.theme) theme.set(saved.theme);
  }
  const themeId = useThemeId(theme);
  const camera = useRef<Camera>(saved.camera ?? DEFAULT_CAMERA);
  const [positions, setPositions] = useState<Record<string, Position>>(() =>
    Object.fromEntries(items.map((item) => [item.id, saved.positions[item.id] ?? { x: item.x, y: item.y }])),
  );
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  // New registry entries appear at their source position until placed.
  const resolved = (item: CanvasItem) => positions[item.id] ?? { x: item.x, y: item.y };
  // The trash hides items on the canvas only; their code stays in the registry,
  // so any of them can be put back. Most recently trashed first. On the dev server
  // the registry holds it (`trashed`), written only when the person moves an item in
  // or out, so a shared file, the next session, and every open tab show the same
  // trash, and no tab overwrites another. The browser keeps the order, the items the
  // registry could not take, and, from an older shell, a trash it had only here,
  // written into the registry once (see SavedTrash). A shared file cannot write, so
  // it starts from the registry and keeps what a viewer changes in the browser.
  const [trash, setTrashState] = useState<string[]>(() => {
    const inRegistry = items.filter((item) => item.trashed).map((item) => item.id);
    if (shared) return saved.camera ? saved.trash.ids : inRegistry;
    const member = new Set([...inRegistry, ...saved.trash.kept, ...(saved.trash.inRegistry ? [] : saved.trash.ids)]);
    return [...new Set([...saved.trash.ids.filter((id) => member.has(id)), ...member])];
  });
  const trashRef = useRef(trash);
  /** Items whose `trashed` the registry could not take, so their place in the trash is kept in this browser. */
  const trashKept = useRef(new Set(saved.trash.kept));
  const shown = useMemo(() => items.filter((item) => !trash.includes(item.id)), [items, trash]);
  const shownIds = useMemo(() => new Set(shown.map((item) => item.id)), [shown]);
  const trashedItems = useMemo(
    () => trash.flatMap((id) => items.find((item) => item.id === id) ?? []),
    [items, trash],
  );
  const [trashOpen, setTrashOpen] = useState(false);
  const trashButtonRef = useRef<HTMLButtonElement>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef(0);
  const [frontId, setFrontId] = useState<string | null>(null);
  // Items the saved layout already knows. Anything else is new and gets
  // placed in free space and revealed once it has a measured size.
  const known = useRef<Set<string> | null>(null);
  if (!known.current) {
    known.current = new Set(saved.camera ? Object.keys(saved.positions) : items.map((item) => item.id));
  }
  // Set for one tick after a pan or move, so the click it ends on stays silent.
  const clickSuppressed = useRef(false);

  const frame = useRef(0);
  const render = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const { x, y, z } = camera.current;
      // Each frame of a pan or zoom touches the page as little as it can. Adding or
      // removing any node (setting textContent does both) makes the browser re-check
      // `:has()` rules up the whole tree, and an item's or the app's CSS often has some:
      // on a canvas of plain items that meant restyling every element on every frame
      // (~35 ms). So nothing is written that did not change, and the zoom label edits
      // its text node in place instead of replacing it.
      if (worldRef.current) {
        worldRef.current.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
        // Annotation pins counter-scale with this, so they keep one size on screen.
        const unzoom = String(1 / z);
        if (worldRef.current.style.getPropertyValue("--canvas-unzoom") !== unzoom) worldRef.current.style.setProperty("--canvas-unzoom", unzoom);
      }
      // The outline is drawn in screen space; after the camera moves it would
      // point at the wrong place, so it waits for the next pointer move.
      if (pickRef.current && !pickRef.current.hidden) pickRef.current.hidden = true;
      const label = zoomLabelRef.current?.firstChild;
      const zoomText = `${Math.round(z * 100)}%`;
      if (label instanceof Text) {
        if (label.data !== zoomText) label.data = zoomText;
      } else if (zoomLabelRef.current) zoomLabelRef.current.textContent = zoomText;
    });
  }, []);

  const saveTimer = useRef(0);
  const firstQueued = useRef(0);
  const flushSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = 0;
    firstQueued.current = 0;
    saveLayout(storageKey, camera.current, positionsRef.current, theme?.get(), {
      ids: trashRef.current,
      kept: [...trashKept.current],
      inRegistry: !shared,
    });
  }, [storageKey, theme]);
  const queueSave = useCallback(() => {
    const now = performance.now();
    if (!firstQueued.current) firstQueued.current = now;
    window.clearTimeout(saveTimer.current);
    const wait = Math.max(0, Math.min(SAVE_DELAY, SAVE_MAX_WAIT - (now - firstQueued.current)));
    saveTimer.current = window.setTimeout(flushSave, wait);
  }, [flushSave]);

  const setCamera = useCallback(
    (next: Camera) => {
      camera.current = sanitizeCamera(next);
      render();
      queueSave();
    },
    [render, queueSave],
  );

  const setTrash = useCallback(
    (next: string[]) => {
      trashRef.current = next;
      setTrashState(next);
      queueSave();
    },
    [queueSave],
  );

  const announce = useCallback((text: string) => {
    if (!liveRef.current) return;
    liveRef.current.textContent = "";
    requestAnimationFrame(() => {
      if (liveRef.current) liveRef.current.textContent = text;
    });
  }, []);

  const copyReference = useCallback(
    async (text: string) => {
      window.clearTimeout(toastTimer.current);
      try {
        await writeClipboard(text);
        setToast({ kind: "copied", text });
        announce(labels.copiedText(text));
        toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
      } catch {
        setToast({ kind: "failed", text });
      }
    },
    [announce],
  );
  const notify = useCallback(
    (text: string, action?: Toast["action"], long = false) => {
      window.clearTimeout(toastTimer.current);
      setToast({ kind: "notice", text, action });
      announce(text);
      // A notice with an action, or a long one, stays long enough to read and reach.
      toastTimer.current = window.setTimeout(() => setToast(null), action || long ? TOAST_ACTION_MS : TOAST_MS);
    },
    [announce],
  );
  // Warns once, when the canvas opens, about items a move or resize could not be saved for,
  // instead of letting the first drag fail. Silent when the server is missing or too old to answer.
  const warnedGenerated = useRef(false);
  useEffect(() => {
    if (shared || warnedGenerated.current || !items.length) return;
    warnedGenerated.current = true;
    fetch(`${EDIT_PATH}/check`)
      .then((response) => (response.ok ? (response.json() as Promise<{ placeable?: unknown }>) : undefined))
      .then((result) => {
        if (!result || !Array.isArray(result.placeable)) return;
        const ok = new Set(result.placeable);
        const bad = items.filter((item) => !ok.has(item.id)).map((item) => item.id);
        if (bad.length) notify(labels.registryGenerated(bad.slice(0, 3).join(", ") + (bad.length > 3 ? ` and ${bad.length - 3} more` : "")), undefined, true);
      })
      .catch(() => {});
  }, [shared, items, notify]);
  // A newer version of the skill than this canvas has: one notice per version, with a button that asks the agent
  // to update (the agent knows whether the skill is a git checkout or an npx copy). With no agent listening,
  // the same request is copied instead. Silent when the server cannot tell, so an old server shows nothing.
  const askedUpdate = useRef(false);
  useEffect(() => {
    if (shared || askedUpdate.current || !items.length) return;
    askedUpdate.current = true;
    fetch(VERSION_PATH)
      .then((response) => (response.ok ? (response.json() as Promise<{ current?: unknown; latest?: unknown; folder?: unknown }>) : undefined))
      .then((v) => {
        if (!v || typeof v.current !== "number" || typeof v.latest !== "number" || typeof v.folder !== "string" || v.latest <= v.current) return;
        const key = `design-canvas:update-notice:${v.latest}`;
        try {
          if (localStorage.getItem(key)) return;
          localStorage.setItem(key, "1");
        } catch {
          // Without storage the notice shows each time the canvas opens.
        }
        const request = labels.updateRequest(v.folder, v.current, v.latest);
        notify(
          labels.updateAvailable(v.latest),
          {
            label: labels.updateAsk,
            run: () => {
              void sendToAgent(request).then(async (result) => {
                if (result.delivered) return notify(labels.updateSent);
                try {
                  await writeClipboard(request);
                  notify(labels.updateCopied);
                } catch {
                  notify(labels.updateCopied, undefined, true);
                }
              });
            },
          },
          true,
        );
      })
      .catch(() => {});
  }, [shared, items, notify]);
  // Share: the dev server builds the canvas into one HTML file and the browser downloads it.
  const [sharing, setSharing] = useState(false);
  const [sharedFile, setSharedFile] = useState<{ name: string; missing: string[] } | null>(null);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const share = useCallback(async () => {
    setSharing(true);
    try {
      const file = await downloadSharedFile();
      // The panel opens where notices and the trash show.
      window.clearTimeout(toastTimer.current);
      setToast(null);
      setTrashOpen(false);
      setSharedFile(file);
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 160);
      notify(labels.shareFailed(reason), undefined, true);
    } finally {
      setSharing(false);
    }
  }, [notify]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // Annotations. Annotate mode turns clicks in previews into numbered pins. The
  // toolbar sends the unsent ones to a listening agent, or copies them, as one
  // message and marks them sent; a sent one leaves once its item renders
  // differently after a code update. The open annotation's text is live state,
  // so switching elements never loses typing.
  // A shared file has no annotation tools, so it neither shows nor stores any.
  const [annotations, setAnnotations] = useState<Annotation[]>(() => (shared ? [] : loadAnnotations(storageKey, ids)));
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const [openAnnotation, setOpenAnnotation] = useState<OpenAnnotation | null>(null);
  const openRef = useRef(openAnnotation);
  const [annotating, setAnnotating] = useState(false);
  const annotatingRef = useRef(false);
  useEffect(() => {
    if (!shared) saveAnnotations(storageKey, annotations);
  }, [annotations, storageKey]);
  // Annotations on trashed items wait, unseen and unsent, until it is put back.
  const visibleAnnotations = useMemo(() => annotations.filter((a) => shownIds.has(a.itemId)), [annotations, shownIds]);
  // Pins number the next message: unsent annotations in order. Sent ones show a
  // check, queued ones a clock.
  const pending = visibleAnnotations.filter((a) => !a.sent && !a.queued);
  const unsentAnnotations = pending.filter((a) => a.text.trim()).length;
  // Listening, or busy with the last message and expected back: either way the
  // toolbar sends instead of copying. While the agent handles sent notes the
  // toolbar says so, and a notice says when it finished, so nobody has to watch
  // the chat to know their notes arrived and were handled.
  const { state: agent, handling: agentHandling } = useAgentStatus(() => notify(labels.agentFinished));
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const agentOn = agent === "listening" || agent === "working";

  /** What an item renders now, tagged with the theme so a theme switch never reads as an update. */
  const printOf = useCallback(
    (itemId: string) => {
      const preview = worldRef.current?.querySelector(`[data-canvas-preview="${CSS.escape(itemId)}"]`) ?? null;
      const print = fingerprintItem(preview);
      return print && `${theme?.get() ?? ""}|${print}`;
    },
    [theme],
  );
  /** How many items name this one as `from`; a new version of it raises the count. */
  const versionsOf = useCallback(
    (itemId: string) => `v|${items.filter((item) => item.from === itemId).length}`,
    [items],
  );
  /** What a sent annotation waits on: its item's content, or its item's count of versions. */
  const sentPrint = useCallback(
    (a: Annotation) => (a.version ? versionsOf(a.itemId) : printOf(a.itemId)),
    [printOf, versionsOf],
  );
  /** Each annotation on the item and its "new version" choice, for Escape. */
  const versionsBefore = useCallback(
    (itemId: string) =>
      new Map(annotationsRef.current.filter((a) => a.itemId === itemId).map((a) => [a.id, a.version] as const)),
    [],
  );

  const setOpen = useCallback((next: OpenAnnotation | null) => {
    openRef.current = next;
    setOpenAnnotation(next);
  }, []);
  /** Closes the open annotation, keeping its text; an empty one is removed. */
  const closeAnnotation = useCallback(() => {
    const open = openRef.current;
    if (!open) return;
    setOpen(null);
    setAnnotations((prev) => prev.filter((a) => a.id !== open.id || a.text.trim()));
  }, [setOpen]);
  /** Escape: a new annotation goes away, an edited one comes back as it was. */
  const cancelAnnotation = useCallback(() => {
    const open = openRef.current;
    if (!open) return;
    setOpen(null);
    setAnnotations((prev) =>
      (open.original.text
        ? prev.map((a) => (a.id === open.id ? open.original : a))
        : prev.filter((a) => a.id !== open.id)
      ).map((a) =>
        // The checkbox may also have changed the item's other annotations.
        a.id !== open.id && open.versions.has(a.id) && a.version !== open.versions.get(a.id)
          ? { ...a, version: open.versions.get(a.id) }
          : a,
      ),
    );
  }, [setOpen]);
  const openExisting = useCallback(
    (id: string) => {
      closeAnnotation();
      const annotation = annotationsRef.current.find((a) => a.id === id);
      if (!annotation) return;
      setOpen({ id, original: annotation, versions: versionsBefore(annotation.itemId) });
      setFrontId(annotation.itemId);
    },
    [closeAnnotation, setOpen, versionsBefore],
  );
  const startAnnotation = useCallback(
    (itemId: string, x: number, y: number, ref: string, area?: { w: number; h: number }) => {
      closeAnnotation();
      // The item's choice so far, or a new version by default: exploring keeps what was there.
      const unsent = annotationsRef.current.filter((a) => a.itemId === itemId && !a.sent && !a.queued && a.text.trim());
      const version = unsent.length ? !!unsent[unsent.length - 1]!.version : true;
      const annotation: Annotation = {
        id: newAnnotationId(),
        itemId,
        x: Math.round(x),
        y: Math.round(y),
        ...(area ? { w: Math.round(area.w), h: Math.round(area.h) } : {}),
        ref,
        text: "",
        version,
      };
      const versions = versionsBefore(itemId);
      setAnnotations((prev) => [...prev, annotation]);
      setOpen({ id: annotation.id, original: annotation, versions });
      setFrontId(itemId);
    },
    [closeAnnotation, setOpen, versionsBefore],
  );
  const annotationHandlers = useMemo<AnnotationHandlers>(
    () => ({
      onOpen: openExisting,
      // Editing a sent or queued annotation makes it a new request, so it goes out again.
      onText: (id, text) =>
        setAnnotations((prev) =>
          prev.map((a) =>
            a.id === id
              ? { ...placeOf(a), text: limitText(text), version: a.version }
              : a,
          ),
        ),
      // One choice per item: its other unsent annotations follow. Changing a
      // sent one makes it a new request, like editing its text.
      onVersion: (id, version) =>
        setAnnotations((prev) => {
          const itemId = prev.find((a) => a.id === id)?.itemId;
          return prev.map((a) =>
            a.id === id || (a.itemId === itemId && !a.sent && !a.queued)
              ? { ...placeOf(a), text: a.text, version }
              : a,
          );
        }),
      onSave: closeAnnotation,
      onCancel: cancelAnnotation,
      onDelete: (id) => {
        if (openRef.current?.id === id) setOpen(null);
        setAnnotations((prev) => prev.filter((a) => a.id !== id));
      },
    }),
    [cancelAnnotation, closeAnnotation, openExisting, setOpen],
  );
  // Notes and sections. A mark the person adds is a request to the agent, like
  // an annotation: it shows as a dashed ghost, goes out in the same message, and
  // leaves once the registry shows the real thing. The canvas is source files,
  // so nothing can show up before the agent applies it.
  const [marks, setMarks] = useState<BoardMark[]>(() => (shared ? [] : loadMarks(storageKey)));
  const marksRef = useRef(marks);
  marksRef.current = marks;
  useEffect(() => {
    if (!shared) saveMarks(storageKey, marks);
  }, [marks, storageKey]);
  const [openMark, setOpenMark] = useState<string | null>(null);
  const openMarkRef = useRef(openMark);
  const [boardTool, setBoardToolState] = useState<BoardKind | null>(null);
  const boardToolRef = useRef<BoardKind | null>(null);
  const setBoardTool = useCallback((tool: BoardKind | null) => {
    boardToolRef.current = tool;
    setBoardToolState(tool);
  }, []);
  const counts = useMemo(() => ({ note: notes.length, section: sections.length }), [notes, sections]);
  // Which items sit inside a new section is read from the layout when sending,
  // so the function is filled in once item boxes are measurable.
  const insideRef = useRef<BoardContext["inside"]>(() => []);
  const boardContext = useMemo<BoardContext>(
    () => ({
      entryOf: (kind, id) => {
        if (kind === "note") {
          const n = notes.find((entry) => entry.id === id);
          return n && { x: n.x, y: n.y, w: n.width ?? NOTE_WIDTH, ...(n.height ? { h: n.height } : {}), text: n.text };
        }
        const section = sections.find((entry) => entry.id === id);
        return section && { x: section.x, y: section.y, w: section.width, h: section.height, text: section.title };
      },
      inside: (bounds) => insideRef.current(bounds),
    }),
    [notes, sections],
  );
  // The selected note or section, by "g:" (a ghost) or "e:" (an entry) and its kind and id.
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef(selected);
  // A direct change is saved to the registry, so it is never a change for the agent.
  const isUnsent = (m: BoardMark) => m.sent === undefined && !m.queued && !!m.text.trim() && !m.direct;
  const unsentMarks = marks.filter(isUnsent);
  const foldedMarks = useMemo(() => foldedNotes(marks), [marks]);
  // Items moved on the canvas. Their positions live in the browser, but the
  // shared file uses the registry's, so a moved item is a change to apply too.
  const [moveStates, setMoveStates] = useState<MoveStates>(() => (shared ? {} : loadMoves(storageKey)));
  const moveStatesRef = useRef(moveStates);
  moveStatesRef.current = moveStates;
  useEffect(() => {
    if (!shared) saveMoves(storageKey, moveStates);
  }, [moveStates, storageKey]);
  const movedItems = useMemo(() => {
    if (shared) return [];
    const nearby = (a: number, b: number) => Math.abs(a - b) <= 1;
    // A section that is itself waiting for the agent already lists the items inside it, so they are one change.
    const frames = marks.filter((m) => m.kind === "section" && m.w && m.h && m.text.trim());
    return shown.flatMap<MovedItem>((item) => {
      const p = positions[item.id];
      if (!p || (nearby(p.x, item.x) && nearby(p.y, item.y))) return [];
      const cx = p.x + item.width / 2;
      const cy = p.y + (ITEM_HEAD + item.height) / 2;
      const covered = frames.some((f) => cx >= f.x && cx <= f.x + (f.w ?? 0) && cy >= f.y && cy <= f.y + (f.h ?? 0));
      return covered ? [] : [{ id: item.id, name: item.name, x: p.x, y: p.y }];
    });
  }, [marks, positions, shown]);
  /** "new" until sent at this position; moving it again makes it new again. */
  const moveStateOf = (m: MovedItem) => {
    const sent = moveStates[m.id];
    return sent && sent.x === m.x && sent.y === m.y ? sent.state : "new";
  };
  // Items that are moved are saved to the registry; only a refused write goes to the agent.
  const unsentMoves = movedItems.filter((m) => moveStateOf(m) === "failed");
  const unsentMovesRef = useRef(unsentMoves);
  unsentMovesRef.current = unsentMoves;
  const movedItemsRef = useRef(movedItems);
  movedItemsRef.current = movedItems;
  // The size last sent for each resized item, so one resize is one write.
  const sentSizes = useRef<Record<string, string>>({});

  // Moves, resizes, and text changes of existing notes, sections, and items, and
  // new notes and sections once they have text, are written into registry.tsx
  // once the person pauses (see registry-edit.ts), so none of it needs a message.
  // A write the registry refuses falls back to the agent as before.
  const countsRef = useRef(counts);
  countsRef.current = counts;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // What each saved change would need to be undone, newest last (⌘/Ctrl + Z).
  const savedHistory = useRef<SavedChange[]>([]);
  // An undo saves its own changes back; they are not new history.
  const quietUntil = useRef(0);
  const remember = useCallback((change: SavedChange) => {
    if (Date.now() < quietUntil.current) return;
    savedHistory.current = [...savedHistory.current, change].slice(-HISTORY_LIMIT);
  }, []);
  // A drag in progress is never saved: a pause mid-drag would write a halfway
  // position, and the registry update would end the drag of a note or section.
  // The drag's end triggers the save (dragEnds).
  const dragging = useRef(false);
  const [dragEnds, setDragEnds] = useState(0);
  const flushDirect = useCallback(async () => {
    if (shared || dragging.current) return;
    const open = openMarkRef.current;
    const pending = marksRef.current.filter((m) => m.direct && m.sent === undefined && m.id !== open);
    const pendingMarks = pending.filter((m) => m.target);
    // An empty new note or section is a draft: it is never saved.
    const pendingNew = pending.filter((m) => !m.target && m.text.trim());
    // A moved item is pending until its state says it went out at this position.
    const pendingMoves = movedItemsRef.current.filter((m) => {
      const s = moveStatesRef.current[m.id];
      return !(s && s.x === m.x && s.y === m.y);
    });
    // Items a moving section carries are saved with it, in the same write, so one
    // undo puts the frame and its contents back together. They are not moves of
    // their own (movedItems leaves out items inside a pending section), so without
    // this they would be saved later, as a second change and a second undo.
    const pendingFrames = pendingMarks.filter((m) => m.kind === "section" && m.w && m.h);
    for (const item of pendingFrames.length ? itemsRef.current : []) {
      if (pendingMoves.some((m) => m.id === item.id) || !elements.current.has(item.id)) continue;
      const p = positionsRef.current[item.id];
      if (!p || (Math.abs(p.x - item.x) <= 1 && Math.abs(p.y - item.y) <= 1)) continue;
      const cx = p.x + item.width / 2;
      const cy = p.y + (ITEM_HEAD + item.height) / 2;
      if (pendingFrames.some((f) => cx >= f.x && cx <= f.x + (f.w ?? 0) && cy >= f.y && cy <= f.y + (f.h ?? 0))) {
        pendingMoves.push({ id: item.id, name: item.name, x: p.x, y: p.y });
      }
    }
    // A resized item is pending until its size has been sent once.
    const pendingSizes = Object.entries(sizesRef.current).filter(([id, s]) => sentSizes.current[id] !== `${s.w}x${s.h}`);
    const edits: DirectEdit[] = [];
    const markIds = new Set<string>();
    // The edit that puts each entry back as it was, and where items go back to in the browser.
    const inverse = new Map<string, DirectEdit>();
    const backPositions: Record<string, { x: number; y: number }> = {};
    for (const m of pendingMarks) {
      const from = m.from!;
      const set: Record<string, number | string> = {};
      if (m.x !== from.x) set.x = m.x;
      if (m.y !== from.y) set.y = m.y;
      if (m.w !== undefined && m.w !== from.w) set.width = m.w;
      if (m.h !== undefined && m.h !== from.h) set.height = m.h;
      if (m.text.trim() !== from.text.trim()) set[m.kind === "note" ? "text" : "title"] = m.text;
      markIds.add(m.id);
      if (Object.keys(set).length) {
        edits.push({ kind: m.kind, id: m.target!, set });
        const back: Record<string, number | string> = {};
        if ("x" in set) back.x = from.x;
        if ("y" in set) back.y = from.y;
        if ("width" in set && from.w !== undefined) back.width = from.w;
        if ("height" in set && from.h !== undefined) back.height = from.h;
        const textKey = m.kind === "note" ? "text" : "title";
        if (textKey in set) back[textKey] = from.text;
        inverse.set(m.target!, { kind: m.kind, id: m.target!, set: back });
      }
    }
    for (const m of pendingMoves) {
      edits.push({ kind: "item", id: m.id, set: { x: Math.round(m.x), y: Math.round(m.y) } });
      const registered = itemsRef.current.find((item) => item.id === m.id);
      if (registered) {
        inverse.set(m.id, { kind: "item", id: m.id, set: { x: registered.x, y: registered.y } });
        backPositions[m.id] = { x: registered.x, y: registered.y };
      }
    }
    for (const [id, s] of pendingSizes) {
      sentSizes.current[id] = `${s.w}x${s.h}`;
      const same = edits.find((e) => e.kind === "item" && e.id === id);
      if (same) same.set = { ...same.set, width: s.w, height: s.h };
      else edits.push({ kind: "item", id, set: { width: s.w, height: s.h } });
      const back = inverse.get(id);
      if (back) back.set = { ...back.set, width: s.bw, height: s.bh };
      else inverse.set(id, { kind: "item", id, set: { width: s.bw, height: s.bh } });
    }
    const adds: DirectAdd[] = pendingNew.map((m) => ({
      kind: m.kind,
      text: m.text,
      x: m.x,
      y: m.y,
      ...(m.w ? { width: m.w } : {}),
      ...(m.h ? { height: m.h } : {}),
    }));
    if (!markIds.size && !pendingNew.length && !pendingMoves.length && !pendingSizes.length) return;
    // A new mark is applied once the registry holds one more entry of its kind, in request order.
    const targets = sentTargets(pendingNew, countsRef.current);
    // Marked in flight first, so a second save does not start for the same change.
    // The refs too: an undo can start a save before the next render (see undoSaved).
    const inFlight = (m: BoardMark) => (markIds.has(m.id) ? { ...m, sent: 0 } : targets.has(m.id) ? { ...m, sent: targets.get(m.id) } : m);
    marksRef.current = marksRef.current.map(inFlight);
    setMarks((prev) => prev.map(inFlight));
    const saving = Object.fromEntries(pendingMoves.map((m) => [m.id, { x: m.x, y: m.y, state: "saving" as const }]));
    moveStatesRef.current = { ...moveStatesRef.current, ...saving };
    setMoveStates((prev) => ({ ...prev, ...saving }));
    let failed = new Set<string>();
    let rejected = new Set<number>();
    let ids: (string | null)[] = [];
    // Why a save fell back to the agent, so it is never silent.
    let unreachable = false;
    if (edits.length || adds.length) {
      try {
        const response = await fetch(EDIT_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ edits, adds }),
        });
        if (!response.ok) throw new Error(`edit ${response.status}`);
        const result = (await response.json()) as { missing?: unknown; rejected?: unknown; ids?: unknown };
        failed = new Set(Array.isArray(result.missing) ? result.missing.filter((id): id is string => typeof id === "string") : []);
        rejected = new Set(Array.isArray(result.rejected) ? result.rejected.filter((i): i is number => typeof i === "number") : []);
        ids = Array.isArray(result.ids) ? (result.ids as (string | null)[]) : [];
      } catch {
        // No dev server, or one that does not know this route (started before the canvas was updated):
        // every change in this batch goes to the agent instead.
        unreachable = true;
        failed = new Set(edits.map((e) => e.id));
        rejected = new Set(adds.map((_, i) => i));
      }
    }
    const failedNew = new Set(pendingNew.filter((_, i) => rejected.has(i)).map((m) => m.id));
    if (!unreachable) {
      // What was written can be undone: the entries put back, the new ones removed.
      const savedEdits = edits.filter((e) => !failed.has(e.id)).flatMap((e) => inverse.get(e.id) ?? []);
      const savedNew = pendingNew.flatMap((m, i) => (!rejected.has(i) && ids[i] ? [{ kind: m.kind, id: ids[i]! }] : []));
      if (savedEdits.length || savedNew.length) {
        remember({
          edits: savedEdits,
          removes: savedNew,
          adds: [],
          positions: Object.fromEntries(Object.entries(backPositions).filter(([id]) => !failed.has(id))),
        });
      }
    }
    if (!failed.size && !failedNew.size) return;
    const names = [...failed, ...(failedNew.size ? ["a new note or section"] : [])];
    notify(unreachable ? labels.saveNeedsServer : labels.saveCouldntPlace(names.slice(0, 3).join(", ")), undefined, true);
    setMarks((prev) =>
      prev.map((m) =>
        (markIds.has(m.id) && m.target && failed.has(m.target)) || failedNew.has(m.id) ? { ...m, direct: undefined, sent: undefined } : m,
      ),
    );
    setMoveStates((prev) => ({
      ...prev,
      ...Object.fromEntries(pendingMoves.filter((m) => failed.has(m.id)).map((m) => [m.id, { x: m.x, y: m.y, state: "failed" as const }])),
    }));
  }, [notify, remember, shared]);
  // Saves still on their way, so an undo can wait for them (see undoSaved).
  const savesInFlight = useRef(new Set<Promise<void>>());
  const flushTracked = useCallback(() => {
    const run = flushDirect();
    savesInFlight.current.add(run);
    void run.finally(() => savesInFlight.current.delete(run));
    return run;
  }, [flushDirect]);
  const flushTrackedRef = useRef(flushTracked);
  flushTrackedRef.current = flushTracked;
  // Saves once the person pauses, so a drag or a line of typing is one write.
  useEffect(() => {
    const timer = window.setTimeout(() => void flushTracked(), 300);
    return () => window.clearTimeout(timer);
  }, [flushTracked, marks, positions, sizes, dragEnds]);
  // An item whose position matches the registry again is applied, or was put back.
  useEffect(() => {
    const moved = new Set(movedItems.map((m) => m.id));
    setMoveStates((prev) => {
      const keep = Object.entries(prev).filter(([id]) => moved.has(id));
      return keep.length === Object.keys(prev).length ? prev : Object.fromEntries(keep);
    });
  }, [movedItems]);
  const setMarkOpen = useCallback((id: string | null) => {
    openMarkRef.current = id;
    setOpenMark(id);
  }, []);
  /** Closes the open mark: an empty one, or an edit that changed nothing, goes away. */
  const closeMark = useCallback(() => {
    const id = openMarkRef.current;
    if (!id) return;
    setMarkOpen(null);
    setMarks((prev) =>
      prev.filter((m) => {
        if (m.id !== id) return true;
        // An empty new note or section stays as a placeholder; an empty change to an entry is no change.
        if (!m.text.trim()) return !m.target;
        return !(isUnchanged(m) && m.sent === undefined);
      }),
    );
  }, [setMarkOpen]);
  const startMark = useCallback(
    (kind: BoardKind, x: number, y: number, size?: { w: number; h: number }) => {
      closeAnnotation();
      closeMark();
      const mark: BoardMark = { id: newMarkId(), kind, x: Math.round(x), y: Math.round(y), text: "", direct: true, ...(size ?? {}) };
      setMarks((prev) => [...prev, mark]);
      setMarkOpen(mark.id);
    },
    [closeAnnotation, closeMark, setMarkOpen],
  );
  const keyOfRef = (ref: BoardRef) => `${ref.ghost ? "g" : "e"}:${ref.kind}:${ref.id}`;
  const select = useCallback((ref: BoardRef | null) => {
    const key = ref ? keyOfRef(ref) : null;
    selectedRef.current = key;
    setSelected(key);
  }, []);
  /**
   * The mark that changes a real note or section, made from the entry as it is
   * now the first time something changes. Until then nothing is pending.
   */
  const ensureMark = useCallback(
    (kind: BoardKind, id: string): string => {
      const existing = marksRef.current.find((m) => m.kind === kind && m.target === id);
      if (existing) return existing.id;
      const entry = boardContext.entryOf(kind, id);
      if (!entry) return "";
      const mark: BoardMark = {
        id: newMarkId(),
        kind,
        target: id,
        direct: true,
        from: entry,
        x: entry.x,
        y: entry.y,
        ...(entry.w ? { w: entry.w } : {}),
        ...(entry.h ? { h: entry.h } : {}),
        text: entry.text,
      };
      // The ref is updated now too: a second change in the same event must find it.
      marksRef.current = [...marksRef.current, mark];
      setMarks(marksRef.current);
      return mark.id;
    },
    [boardContext],
  );
  /** Moving, resizing, and typing all change a mark; a sent or queued one becomes a new request. */
  // A change by hand takes a note out of its section's change; carrying sets it again.
  const updateMark = useCallback((id: string, patch: Partial<Pick<BoardMark, "x" | "y" | "w" | "h">>, carriedBy?: string) => {
    setMarks((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch, sent: undefined, queued: undefined, carriedBy } : m)),
    );
  }, []);
  /** Opens a note's text or a section's title for editing, as a change to the entry if it is a real one. */
  const editBoard = useCallback(
    (ref: BoardRef) => {
      closeAnnotation();
      closeMark();
      const id = ref.ghost ? ref.id : ensureMark(ref.kind, ref.id);
      if (!id) return;
      select({ kind: ref.kind, id, ghost: true });
      setMarkOpen(id);
    },
    [closeAnnotation, closeMark, ensureMark, select, setMarkOpen],
  );
  const markHandlers = useMemo(
    () => ({
      // Editing a sent or queued mark makes it a new request, so it goes out again.
      onText: (id: string, text: string) =>
        setMarks((prev) =>
          prev.map((m) => (m.id === id ? { ...m, text: limitMarkText(text), sent: undefined, queued: undefined, carriedBy: undefined } : m)),
        ),
      onClose: closeMark,
      onDelete: (id: string) => {
        if (openMarkRef.current === id) setMarkOpen(null);
        setMarks((prev) => prev.filter((m) => m.id !== id));
      },
    }),
    [closeMark, setMarkOpen],
  );
  // Delete: a selected note or section is removed from registry.tsx, and Undo puts it back as it was.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  // It stays hidden from the click until the registry stops listing it.
  useEffect(() => {
    setRemoved((prev) => {
      const next = new Set(
        [...prev].filter((key) => notes.some((n) => `note:${n.id}` === key) || sections.some((s) => `section:${s.id}` === key)),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [notes, sections]);
  const postRegistry = async (body: { edits?: unknown[]; removes?: unknown[]; adds?: unknown[] }) => {
    try {
      const response = await fetch(EDIT_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return response.ok ? ((await response.json()) as { rejected?: number[]; unremoved?: string[]; missing?: string[] }) : undefined;
    } catch {
      return undefined;
    }
  };
  // A caption edit shows at once and stays until the registry has the text.
  const [captions, setCaptions] = useState<Record<string, string>>({});
  useEffect(() => {
    setCaptions((prev) => {
      const keep = Object.entries(prev).filter(([id, text]) => items.find((item) => item.id === id)?.note !== text);
      return keep.length === Object.keys(prev).length ? prev : Object.fromEntries(keep);
    });
  }, [items]);
  const saveCaption = async (item: CanvasItem, text: string) => {
    if (shared) return;
    setCaptions((prev) => ({ ...prev, [item.id]: text }));
    const result = await postRegistry({ edits: [{ kind: "item", id: item.id, set: { note: text } }] });
    if (result && !result.missing?.length) {
      if (item.note !== undefined) remember({ edits: [{ kind: "item", id: item.id, set: { note: item.note } }], removes: [], adds: [], positions: {} });
      return;
    }
    // Not written: show what is in the registry again.
    setCaptions((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    notify(result ? labels.saveCouldntPlace(item.name) : labels.captionNotSaved, undefined, true);
  };
  const deleteBoard = async (kind: BoardKind, id: string) => {
    const note = kind === "note" ? notes.find((n) => n.id === id) : undefined;
    const section = kind === "section" ? sections.find((s) => s.id === id) : undefined;
    const snapshot: DirectAdd | undefined = note
      ? { kind, id, text: note.text, x: note.x, y: note.y, ...(note.width ? { width: note.width } : {}), ...(note.height ? { height: note.height } : {}) }
      : section
        ? { kind, id, text: section.title, x: section.x, y: section.y, width: section.width, height: section.height }
        : undefined;
    if (!snapshot) return;
    const key = `${kind}:${id}`;
    setRemoved((prev) => new Set(prev).add(key));
    select(null);
    // A change waiting on the entry means nothing once it is gone.
    setMarks((prev) => prev.filter((m) => !(m.kind === kind && m.target === id)));
    const result = await postRegistry({ removes: [{ kind, id }] });
    if (!result || result.unremoved?.length) {
      setRemoved((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      notify(labels.deleteFailed);
      return;
    }
    const entry: SavedChange = { edits: [], removes: [], adds: [snapshot], positions: {} };
    remember(entry);
    notify(kind === "note" ? labels.noteDeleted : labels.sectionDeleted, {
      label: labels.undo,
      run: async () => {
        // This Undo and ⌘/Ctrl + Z are the same undo: taken out of the history so it cannot run twice.
        savedHistory.current = savedHistory.current.filter((change) => change !== entry);
        // Shown again at once: if the registry's removal and this restore reach the page together, it never sees the entry gone to clear this itself.
        setRemoved((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        const back = await postRegistry({ adds: [snapshot] });
        notify(back && !back.rejected?.length ? (kind === "note" ? labels.noteRestored : labels.sectionRestored) : labels.restoreFailed);
      },
    });
  };
  const deleteSelected = () => {
    const key = selectedRef.current;
    if (!key || shared) return;
    const [side, kind, id] = key.split(":") as ["g" | "e", BoardKind, string];
    if (side === "e") {
      void deleteBoard(kind, id);
      return;
    }
    const mark = marksRef.current.find((m) => m.id === id);
    if (!mark) return;
    // A change to an entry that exists deletes the entry; a new one is just dropped.
    if (mark.target) void deleteBoard(kind, mark.target);
    else {
      if (openMarkRef.current === id) setMarkOpen(null);
      setMarks((prev) => prev.filter((m) => m.id !== id));
      select(null);
    }
  };
  const deleteBoardRef = useRef(deleteSelected);
  deleteBoardRef.current = deleteSelected;
  // ⌘/Ctrl + Z: puts back what the last saved change replaced.
  const undoSaved = async () => {
    // A change made just before the key may still wait for its pause or its write.
    // It goes first, so the key undoes it rather than the change before it.
    await flushTrackedRef.current();
    await Promise.all([...savesInFlight.current]);
    const change = savedHistory.current[savedHistory.current.length - 1];
    if (!change) {
      notify(labels.nothingToUndo);
      return;
    }
    savedHistory.current = savedHistory.current.slice(0, -1);
    quietUntil.current = Date.now() + 2000;
    // A ghost still waiting for the registry to show the change this undoes would
    // wait forever once the undo writes the old values: the entry shows instead,
    // and keeps the selection.
    const undone = new Set(change.edits.map((edit) => `${edit.kind}:${edit.id}`));
    const settled = marksRef.current.filter((m) => m.direct && m.target && undone.has(`${m.kind}:${m.target}`));
    if (settled.length) {
      const chosen = settled.find((m) => selectedRef.current === `g:${m.kind}:${m.id}`);
      if (chosen?.target) select({ kind: chosen.kind, id: chosen.target, ghost: false });
      const gone = new Set(settled.map((m) => m.id));
      marksRef.current = marksRef.current.filter((m) => !gone.has(m.id));
      setMarks(marksRef.current);
    }
    // Items go back in the browser too, or their saved layout would be saved again.
    if (Object.keys(change.positions).length) {
      const next = { ...positionsRef.current };
      for (const [id, place] of Object.entries(change.positions)) next[id] = sanitizePosition(place);
      positionsRef.current = next;
      setPositions(next);
      queueSave();
    }
    // An entry that comes back must not stay hidden as deleted.
    const returning = change.adds.flatMap((add) => (add.id ? [`${add.kind}:${add.id}`] : []));
    if (returning.length) {
      setRemoved((prev) => {
        const next = new Set(prev);
        for (const key of returning) next.delete(key);
        return next;
      });
    }
    const result = await postRegistry({ edits: change.edits, removes: change.removes, adds: change.adds });
    if (!result) {
      savedHistory.current = [...savedHistory.current, change];
      notify(labels.undoFailed);
      return;
    }
    notify(labels.undone);
  };
  const undoSavedRef = useRef(undoSaved);
  undoSavedRef.current = undoSaved;
  // Leaving annotate mode with changes still waiting is where they get
  // forgotten, so say so, with the way to apply them.
  const sendRef = useRef<() => Promise<void>>(async () => {});
  const setAnnotateMode = useCallback(
    (on: boolean, quiet = false) => {
      annotatingRef.current = on;
      setAnnotating(on);
      // Switching to the Note or Section tool is not leaving to finish: nothing is lost or forgotten.
      if (!on && quiet) closeAnnotation();
      if (!on && !quiet) {
        closeAnnotation();
        closeMark();
        setBoardTool(null);
        const waiting =
          annotationsRef.current.filter((a) => shownIds.has(a.itemId) && !a.sent && !a.queued && a.text.trim()).length +
          standalone(marksRef.current.filter(isUnsent), marksRef.current).length +
          unsentMovesRef.current.length;
        if (waiting) {
          const listening = agentRef.current === "listening" || agentRef.current === "working";
          notify(labels.unapplied(waiting), { label: listening ? labels.applyNow : labels.copyNow, run: () => void sendRef.current() }, true);
          return;
        }
      }
      announce(on ? labels.annotateModeOn : labels.annotateModeOff);
    },
    [announce, closeAnnotation, closeMark, notify, setBoardTool, shownIds],
  );
  /**
   * The toolbar's tools: Select (the default, nothing armed), Annotate, and the
   * one-shot Note and Section. Only one is on at a time, and Escape returns to Select.
   */
  const chooseTool = useCallback(
    (tool: "select" | "annotate" | BoardKind) => {
      if (tool === "select") {
        setBoardTool(null);
        if (annotatingRef.current) setAnnotateMode(false);
        return;
      }
      if (tool === "annotate") {
        setBoardTool(null);
        setAnnotateMode(!annotatingRef.current);
        return;
      }
      if (annotatingRef.current) setAnnotateMode(false, true);
      setBoardTool(boardToolRef.current === tool ? null : tool);
    },
    [setAnnotateMode, setBoardTool],
  );
  const unsentCount = unsentAnnotations + standalone(unsentMarks, marks).length + unsentMoves.length;
  // What the bar of waiting changes shows: anything to discard, and what has gone out but is not applied yet.
  const hasChanges =
    !shared &&
    (visibleAnnotations.some((a) => a.text.trim()) || marks.some((m) => m.text.trim() && !m.direct) || movedItems.length > 0);
  const waitingCount =
    visibleAnnotations.filter((a) => a.sent || a.queued).length +
    standalone(marks.filter((m) => (m.sent !== undefined || m.queued) && !m.direct), marks).length +
    movedItems.filter((m) => moveStateOf(m) === "sent" || moveStateOf(m) === "queued").length;
  // A press anywhere but on a note or section lets go of the selection. A press on
  // empty canvas decides when it ends: a click selects the section under it or
  // nothing, and a pan keeps the selection (tapSurface). Camera gestures (Space,
  // Z, the middle button) never change it.
  useEffect(() => {
    if (!selected) return;
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".canvas-note-card, .canvas-section-tab, .canvas-board-edge, .canvas-resize")) return;
      if (event.target === viewportRef.current || event.target === worldRef.current) return;
      if (event.button === 1 || spaceArmed.current || zoomArmed.current) return;
      select(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [select, selected]);
  // A mark leaves once the registry shows it.
  useEffect(() => {
    const applied = marksRef.current.filter((m) => isApplied(m, counts, boardContext));
    if (!applied.length) return;
    const done = new Set(applied.map((m) => m.id));
    if (openMarkRef.current && done.has(openMarkRef.current)) setMarkOpen(null);
    // A note or section stays selected once its move or resize is saved: the
    // selection passes from the ghost to the entry it changed.
    const chosen = applied.find((m) => selectedRef.current === `g:${m.kind}:${m.id}`);
    if (chosen?.target) select({ kind: chosen.kind, id: chosen.target, ghost: false });
    setMarks((prev) => prev.filter((m) => !done.has(m.id)));
  }, [boardContext, counts, select, setMarkOpen]);
  // Discards every change not applied yet: annotations, notes and sections, and
  // moved items, which go back to the registry's positions. Annotations on
  // trashed items wait for them. Undo brings all of it back.
  const discardChanges = useCallback(() => {
    const before = annotationsRef.current.filter((a) => shownIds.has(a.itemId) && a.text.trim());
    const beforeMarks = marksRef.current.filter((m) => m.text.trim());
    const beforePositions = positionsRef.current;
    const beforeMoves = moveStatesRef.current;
    const moved = shown.filter((item) => {
      const p = beforePositions[item.id];
      return p && (Math.abs(p.x - item.x) > 1 || Math.abs(p.y - item.y) > 1);
    });
    // Carried items count with their section, as they do in the toolbar.
    const count = before.length + beforeMarks.length + movedItemsRef.current.length;
    setOpen(null);
    setMarkOpen(null);
    setAnnotations((prev) => prev.filter((a) => !shownIds.has(a.itemId)));
    setMarks([]);
    if (moved.length) {
      const next = { ...beforePositions };
      for (const item of moved) next[item.id] = sanitizePosition({ x: item.x, y: item.y });
      positionsRef.current = next;
      setPositions(next);
      queueSave();
    }
    notify(labels.discardedChanges(count), {
      label: labels.undo,
      run: () => {
        setAnnotations((now) => [...before, ...now.filter((a) => !before.some((old) => old.id === a.id))]);
        setMarks((now) => [...beforeMarks, ...now.filter((m) => !beforeMarks.some((old) => old.id === m.id))]);
        if (moved.length) {
          const back = { ...positionsRef.current };
          for (const item of moved) back[item.id] = beforePositions[item.id]!;
          positionsRef.current = back;
          setPositions(back);
          setMoveStates(beforeMoves);
          queueSave();
        }
      },
    });
  }, [notify, queueSave, setMarkOpen, setOpen, shown, shownIds]);
  /** One message: annotations, then notes and sections, then moved items. */
  const message = useCallback(
    (list: Annotation[], markList: BoardMark[] = [], moveList: MovedItem[] = []) =>
      [
        list.length ? formatAnnotations(list, (itemId) => items.find((item) => item.id === itemId)?.name ?? itemId) : "",
        markList.length ? formatBoard(markList, boardContext) : "",
        moveList.length ? formatMoves(moveList) : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    [boardContext, items],
  );
  const markSent = useCallback(
    (list: Annotation[], markList: BoardMark[] = [], moveList: MovedItem[] = []) => {
      const sentIds = new Set(list.map((a) => a.id));
      if (moveList.length) {
        setMoveStates((prev) => ({ ...prev, ...Object.fromEntries(moveList.map((m) => [m.id, { x: m.x, y: m.y, state: "sent" as const }])) }));
      }
      // "?" when the item is not rendered yet (a loading frame); the first check sets it.
      setAnnotations((prev) =>
        prev.map((a) => (sentIds.has(a.id) ? { ...a, queued: undefined, sent: sentPrint(a) ?? "?" } : a)),
      );
      if (!markList.length) return;
      const targets = sentTargets(markList, counts);
      setMarks((prev) => prev.map((m) => (targets.has(m.id) ? { ...m, queued: undefined, sent: targets.get(m.id) } : m)));
    },
    [counts, sentPrint],
  );
  const copyAnnotations = useCallback(
    async (list: Annotation[], done: (n: number) => string, markList: BoardMark[] = [], moveList: MovedItem[] = []) => {
      const text = message(list, markList, moveList);
      window.clearTimeout(toastTimer.current);
      try {
        await writeClipboard(text);
      } catch {
        // Not sent: the person copies from the fallback field, and the pins stay new.
        setToast({ kind: "failed", text });
        return;
      }
      markSent(list, markList, moveList);
      notify(done(list.length + standalone(markList, marksRef.current).length + moveList.length));
    },
    [markSent, message, notify],
  );
  /**
   * The toolbar's main action. With a listening agent it sends; while the agent
   * is busy with the last message it queues on this page; without one, or if
   * the agent left in the meantime, it copies.
   */
  const sendAnnotations = useCallback(async () => {
    closeAnnotation();
    closeMark();
    const list = annotationsRef.current.filter((a) => shownIds.has(a.itemId) && !a.sent && !a.queued && a.text.trim());
    const markList = marksRef.current.filter(isUnsent);
    const moveList = unsentMovesRef.current;
    const total = list.length + standalone(markList, marksRef.current).length + moveList.length;
    if (!total) return;
    const offered = agentRef.current === "listening" || agentRef.current === "working";
    let state = agentRef.current;
    if (state === "listening") {
      const result = await sendToAgent(message(list, markList, moveList));
      if (result.delivered) {
        markSent(list, markList, moveList);
        notify(labels.sentToAgent(total));
        return;
      }
      state = result.state;
    }
    if (state === "working") {
      const queuedIds = new Set(list.map((a) => a.id));
      const queuedMarks = new Set(markList.map((m) => m.id));
      setAnnotations((prev) => prev.map((a) => (queuedIds.has(a.id) ? { ...a, queued: true } : a)));
      setMarks((prev) => prev.map((m) => (queuedMarks.has(m.id) ? { ...m, queued: true } : m)));
      setMoveStates((prev) => ({ ...prev, ...Object.fromEntries(moveList.map((m) => [m.id, { x: m.x, y: m.y, state: "queued" as const }])) }));
      notify(labels.queuedForAgent(total));
      return;
    }
    await copyAnnotations(list, offered ? labels.agentGoneCopied : labels.copiedAnnotations, markList, moveList);
  }, [closeAnnotation, closeMark, copyAnnotations, markSent, message, notify, shownIds]);
  sendRef.current = sendAnnotations;

  // Queued annotations go out as one message once the agent listens again, and
  // turn back into unsent ones if it stops listening, so nothing waits for an
  // agent that is gone.
  const flushing = useRef(false);
  useEffect(() => {
    if (agent === undefined || agent === "working") return;
    if (agent === "off") {
      const queued = annotationsRef.current.filter((a) => a.queued);
      const queuedMarks = marksRef.current.filter((m) => m.queued);
      const queuedMoves = Object.entries(moveStatesRef.current).filter(([, m]) => m.state === "queued");
      if (!queued.length && !queuedMarks.length && !queuedMoves.length) return;
      setAnnotations((prev) => prev.map((a) => (a.queued ? { ...a, queued: undefined } : a)));
      setMarks((prev) => prev.map((m) => (m.queued ? { ...m, queued: undefined } : m)));
      // A queued move that never went out is simply not sent: it is a move to apply again.
      setMoveStates((prev) => Object.fromEntries(Object.entries(prev).filter(([, m]) => m.state !== "queued")));
      notify(labels.agentGoneQueued(queued.length + queuedMarks.length + queuedMoves.length));
      return;
    }
    const queued = annotationsRef.current.filter((a) => a.queued && shownIds.has(a.itemId));
    const queuedMarks = marksRef.current.filter((m) => m.queued);
    const queuedMoves = movedItemsRef.current.filter((m) => {
      const sent = moveStatesRef.current[m.id];
      return sent?.state === "queued" && sent.x === m.x && sent.y === m.y;
    });
    if ((!queued.length && !queuedMarks.length && !queuedMoves.length) || flushing.current) return;
    flushing.current = true;
    void sendToAgent(message(queued, queuedMarks, queuedMoves)).then((result) => {
      flushing.current = false;
      if (!result.delivered) return;
      markSent(queued, queuedMarks, queuedMoves);
      notify(labels.sentToAgent(queued.length + queuedMarks.length + queuedMoves.length));
    });
  }, [agent, markSent, message, notify, shownIds]);

  /**
   * Removes sent annotations whose item now renders differently, or, for "new
   * version" ones, whose item has a new version. Items that are not rendered
   * yet, or were sent under another theme, are only re-read.
   */
  const checkSent = useCallback(() => {
    const prints = new Map<string, string | undefined>();
    const now = (itemId: string) => {
      if (!prints.has(itemId)) prints.set(itemId, printOf(itemId));
      return prints.get(itemId);
    };
    const gone: Annotation[] = [];
    const reread = new Map<string, string>();
    for (const a of annotationsRef.current) {
      if (!a.sent || !ids.has(a.itemId)) continue;
      if (a.version) {
        // Only a new item made from this one counts; the original stays as it was.
        const versions = versionsOf(a.itemId);
        if (!a.sent.startsWith("v|")) reread.set(a.id, versions);
        else if (Number(versions.slice(2)) > Number(a.sent.slice(2))) gone.push(a);
        continue;
      }
      const current = now(a.itemId);
      if (!current || current === a.sent) continue;
      const sameTheme = a.sent.split("|")[0] === current.split("|")[0];
      if (a.sent === "?" || !sameTheme) reread.set(a.id, current);
      else gone.push(a);
    }
    if (!gone.length && !reread.size) return;
    const goneIds = new Set(gone.map((a) => a.id));
    if (openRef.current && goneIds.has(openRef.current.id)) setOpen(null);
    setAnnotations((prev) =>
      prev.filter((a) => !goneIds.has(a.id)).map((a) => (reread.has(a.id) ? { ...a, sent: reread.get(a.id) } : a)),
    );
    if (!gone.length) return;
    const text = gone.every((a) => a.version) ? labels.clearedVersioned(gone.length) : labels.clearedSent(gone.length);
    notify(text, {
      label: labels.undo,
      // Back as sent against how the items look now, so they stay until the next change.
      run: () =>
        setAnnotations((current) => [
          ...current,
          ...gone.filter((a) => !current.some((c) => c.id === a.id)).map((a) => ({ ...a, sent: sentPrint(a) ?? "?" })),
        ]),
    });
  }, [ids, notify, printOf, sentPrint, setOpen, versionsOf]);
  const checkSentRef = useRef(checkSent);
  checkSentRef.current = checkSent;

  // Checks run after each hot update (Vite), after a reload, and when a frame
  // loads; twice, because React Refresh and frames re-render a moment later.
  useEffect(() => {
    const timers: number[] = [];
    const soon = () => {
      for (const ms of [400, 1500]) timers.push(window.setTimeout(() => checkSentRef.current(), ms));
    };
    const hot = (import.meta as ImportMeta & { hot?: HotUpdates }).hot;
    hot?.on("vite:afterUpdate", soon);
    void document.fonts.ready.then(soon);
    const world = worldRef.current;
    const onFrameLoad = (event: Event) => {
      if (event.target instanceof HTMLIFrameElement) soon();
    };
    world?.addEventListener("load", onFrameLoad, true);
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      hot?.off?.("vite:afterUpdate", soon);
      world?.removeEventListener("load", onFrameLoad, true);
    };
  }, []);

  // A press anywhere outside the open annotation closes it and keeps the text.
  useEffect(() => {
    if (!openAnnotation) return;
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".canvas-pin[data-open]")) return;
      closeAnnotation();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [closeAnnotation, openAnnotation]);

  const register = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) elements.current.set(id, element);
    else elements.current.delete(id);
  }, []);

  /** Canvas-unit box of an item: title, handle, and preview. */
  const rectOf = useCallback((item: CanvasItem) => {
    const element = elements.current.get(item.id);
    if (!element) return null;
    const p = positionsRef.current[item.id] ?? { x: item.x, y: item.y };
    // Layout sizes ignore the camera transform, so they are canvas units.
    return { x: p.x, y: p.y, w: element.offsetWidth, h: element.offsetHeight };
  }, []);

  // Items whose centre is inside a section, at the positions they have now,
  // which the agent writes back to source so the shared file keeps the arrangement.
  const itemsInside = (bounds: { x: number; y: number; w: number; h: number }) =>
    shown.flatMap((item) => {
      const r = rectOf(item);
      if (!r) return [];
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      return cx >= bounds.x && cx <= bounds.x + bounds.w && cy >= bounds.y && cy <= bounds.y + bounds.h
        ? [{ id: item.id, name: item.name, x: r.x, y: r.y }]
        : [];
    });
  insideRef.current = itemsInside;

  // Notes inside a section move with it, as items do. A registry note's move is a
  // change to it, so it is made into a mark only when the section actually moves.
  const notesInside = (bounds: { x: number; y: number; w: number; h: number }): CarriedNote[] => {
    const measured = (selector: string) => worldRef.current?.querySelector<HTMLElement>(selector)?.offsetHeight ?? 0;
    const isInside = (x: number, y: number, w: number, h: number) => {
      const cx = x + w / 2;
      const cy = y + h / 2;
      return cx >= bounds.x && cx <= bounds.x + bounds.w && cy >= bounds.y && cy <= bounds.y + bounds.h;
    };
    const found: CarriedNote[] = [];
    for (const note of notes) {
      const mark = marksRef.current.find((m) => m.kind === "note" && m.target === note.id);
      const x = mark?.x ?? note.x;
      const y = mark?.y ?? note.y;
      const w = mark?.w ?? note.width ?? NOTE_WIDTH;
      const el = mark ? `[data-board-ghost="${CSS.escape(mark.id)}"]` : `[data-board-id="${CSS.escape(note.id)}"]`;
      const h = mark?.h ?? note.height ?? (measured(el) || 80);
      if (isInside(x, y, w, h)) found.push({ id: mark ? mark.id : note.id, ghost: !!mark, x, y });
    }
    // A new note the person added is a mark of its own, not in the registry yet.
    for (const m of marksRef.current) {
      // Empty drafts move with their section too; they are not sent, so only their place matters.
      if (m.kind !== "note" || m.target) continue;
      const h = m.h ?? (measured(`[data-board-ghost="${CSS.escape(m.id)}"]`) || 80);
      if (isInside(m.x, m.y, m.w ?? NOTE_WIDTH, h)) found.push({ id: m.id, ghost: true, x: m.x, y: m.y });
    }
    return found;
  };
  /** Moves carried notes by the same step as their section, which they then belong to. Each registry note gets its mark on first move. */
  const carryNotes = (carried: CarriedNote[], dx: number, dy: number, section: string) => {
    for (const c of carried) {
      const id = c.ghost ? c.id : ensureMark("note", c.id);
      if (id) updateMark(id, { x: Math.round(c.x + dx), y: Math.round(c.y + dy) }, section);
    }
  };

  // Moving and resizing notes and sections. The first change to a real one
  // makes its mark; from then on the ghost is what moves. Everything runs on the
  // viewport with pointer capture, because the real element is replaced by its
  // ghost mid-drag and a capture on it would be lost.
  const boardImpl = useRef<Omit<BoardHandlers, "select">>({ move: () => {}, resize: () => {}, edit: () => {}, nudge: () => {} });
  const boardHandlers = useMemo<BoardHandlers>(
    () => ({
      select,
      move: (event, ref) => boardImpl.current.move(event, ref),
      resize: (event, ref, corner) => boardImpl.current.resize(event, ref, corner),
      edit: (ref) => boardImpl.current.edit(ref),
      nudge: (ref, dx, dy) => boardImpl.current.nudge(ref, dx, dy),
    }),
    [select],
  );
  /** What a ref points at now: its mark if it is a ghost, else its registry entry. */
  const boardOrigin = (ref: BoardRef) => {
    if (ref.ghost) {
      const m = marksRef.current.find((mark) => mark.id === ref.id);
      return m && { x: m.x, y: m.y, w: m.w, h: m.h };
    }
    const e = boardContext.entryOf(ref.kind, ref.id);
    return e && { x: e.x, y: e.y, w: e.w, h: e.h };
  };
  const shiftItems = (carried: { id: string; x: number; y: number }[], dx: number, dy: number) => {
    if (!carried.length) return;
    const next = { ...positionsRef.current };
    for (const c of carried) next[c.id] = sanitizePosition({ x: c.x + dx, y: c.y + dy });
    positionsRef.current = next;
    setPositions(next);
  };
  /** A change that ended where it began is no change. */
  const pruneUnchanged = () =>
    setMarks((prev) => prev.filter((m) => !(isUnchanged(m) && m.sent === undefined && m.id !== openMarkRef.current)));
  // A double-click is two quick presses that never travel. The browser's own
  // dblclick goes to the viewport, which holds the pointer capture during a press,
  // so it never reaches a note or tab.
  const lastTap = useRef<{ key: string; time: number } | null>(null);
  /** Runs `step` for each pointer move of this drag after the drag threshold, `done` once it ends, and `tap` instead if it never moved. */
  const dragBoard = (
    event: ReactPointerEvent<HTMLElement>,
    first: () => void,
    step: (dx: number, dy: number) => void,
    done: () => void,
    tap?: () => void,
  ) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const pointerId = event.pointerId;
    const start = { x: event.clientX, y: event.clientY };
    let moved = false;
    try {
      viewport.setPointerCapture(pointerId);
    } catch {
      // The pointer may already be gone.
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!moved) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= DRAG_THRESHOLD) return;
        moved = true;
        dragging.current = true;
        first();
      }
      const z = camera.current.z;
      step((e.clientX - start.x) / z, (e.clientY - start.y) / z);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerup", end);
      viewport.removeEventListener("pointercancel", end);
      if (!moved) {
        if (e.type === "pointerup") tap?.();
        return;
      }
      dragging.current = false;
      suppressNextClick();
      done();
      setDragEnds((n) => n + 1);
    };
    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("pointerup", end);
    viewport.addEventListener("pointercancel", end);
  };
  boardImpl.current = {
    move: (event, ref) => {
      if (event.button !== 0 || spaceArmed.current || boardToolRef.current) return;
      if (event.target instanceof Element && event.target.closest("textarea, button, .canvas-resize, .canvas-board-edge")) return;
      const origin = boardOrigin(ref);
      if (!origin) return;
      event.stopPropagation();
      // Stops text selection while dragging.
      event.preventDefault();
      select(ref);
      let id = ref.ghost ? ref.id : "";
      // A section carries the items inside it, so the frame never leaves its contents behind.
      const carried = ref.kind === "section" && origin.w && origin.h ? itemsInside({ x: origin.x, y: origin.y, w: origin.w, h: origin.h }) : [];
      const carriedNotes = ref.kind === "section" && origin.w && origin.h ? notesInside({ x: origin.x, y: origin.y, w: origin.w, h: origin.h }) : [];
      dragBoard(
        event,
        () => {
          if (id) return;
          id = ensureMark(ref.kind, ref.id);
          select({ kind: ref.kind, id, ghost: true });
        },
        (dx, dy) => {
          if (!id) return;
          const x = Math.round(origin.x + dx);
          const y = Math.round(origin.y + dy);
          updateMark(id, { x, y });
          shiftItems(carried, x - origin.x, y - origin.y);
          carryNotes(carriedNotes, x - origin.x, y - origin.y, id);
        },
        () => {
          if (carried.length) queueSave();
          pruneUnchanged();
        },
        () => {
          const key = `${ref.kind}:${ref.id}`;
          const now = performance.now();
          if (lastTap.current?.key === key && now - lastTap.current.time < DOUBLE_TAP_MS) {
            lastTap.current = null;
            editBoard(ref);
          } else lastTap.current = { key, time: now };
        },
      );
    },
    resize: (event, ref, edge: BoardEdge) => {
      if (event.button !== 0 || spaceArmed.current) return;
      const origin = boardOrigin(ref);
      if (!origin) return;
      event.stopPropagation();
      event.preventDefault();
      // A note's height follows its text until it is resized, so its drawn size is the start.
      const drawn = worldRef.current?.querySelector<HTMLElement>(
        ref.ghost ? `[data-board-ghost="${CSS.escape(ref.id)}"]` : `[data-board-id="${CSS.escape(ref.id)}"]`,
      );
      const w0 = origin.w ?? drawn?.offsetWidth ?? NOTE_WIDTH;
      const h0 = origin.h ?? drawn?.offsetHeight ?? 80;
      const least = ref.kind === "section" ? { w: 120, h: 80 } : { w: 120, h: 60 };
      // An edge changes one dimension, a corner both.
      const east = edge.includes("e");
      const west = edge.includes("w");
      const south = edge.includes("s");
      const north = edge.includes("n");
      let id = ref.ghost ? ref.id : "";
      dragBoard(
        event,
        () => {
          if (id) return;
          id = ensureMark(ref.kind, ref.id);
          select({ kind: ref.kind, id, ghost: true });
        },
        (dx, dy) => {
          if (!id) return;
          const w = Math.max(least.w, east ? w0 + dx : west ? w0 - dx : w0);
          const h = Math.max(least.h, south ? h0 + dy : north ? h0 - dy : h0);
          // The edge opposite the one pulled stays where it was.
          updateMark(id, {
            x: Math.round(west ? origin.x + w0 - w : origin.x),
            y: Math.round(north ? origin.y + h0 - h : origin.y),
            w: Math.round(w),
            h: Math.round(h),
          });
        },
        pruneUnchanged,
        // A click on the border, like one inside, selects it.
        () => select(ref),
      );
    },
    edit: editBoard,
    nudge: (ref, dx, dy) => {
      const origin = boardOrigin(ref);
      if (!origin) return;
      const id = ref.ghost ? ref.id : ensureMark(ref.kind, ref.id);
      if (!id) return;
      const carried = ref.kind === "section" && origin.w && origin.h ? itemsInside({ x: origin.x, y: origin.y, w: origin.w, h: origin.h }) : [];
      const carriedNotes = ref.kind === "section" && origin.w && origin.h ? notesInside({ x: origin.x, y: origin.y, w: origin.w, h: origin.h }) : [];
      updateMark(id, { x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) });
      shiftItems(carried, dx, dy);
      carryNotes(carriedNotes, dx, dy, id);
      queueSave();
      if (!ref.ghost) {
        // The real element is replaced by its ghost; keyboard focus follows it.
        select({ kind: ref.kind, id, ghost: true });
        requestAnimationFrame(() =>
          worldRef.current
            ?.querySelector<HTMLElement>(
              `[data-board-ghost="${CSS.escape(id)}"].canvas-note-card, [data-board-ghost="${CSS.escape(id)}"] .canvas-section-tab`,
            )
            ?.focus({ preventScroll: true }),
        );
      }
    },
  };

  // Drag a corner of an item to resize it. The corner opposite the grip stays
  // where it is, so a north or west grip also moves the item (the move saves
  // itself like any other). Width and height are what `viewport` items use
  // for their breakpoints, so the frame re-lays-out as it is dragged.
  const resizeItemImpl = useRef<(event: ReactPointerEvent<HTMLElement>, item: CanvasItem, edge: ResizeEdge) => void>(() => {});
  resizeItemImpl.current = (event, item, edge) => {
    if (event.button !== 0 || spaceArmed.current || boardToolRef.current) return;
    event.stopPropagation();
    event.preventDefault();
    const origin = positionsRef.current[item.id] ?? { x: item.x, y: item.y };
    const w0 = item.width;
    const h0 = item.height;
    const least = item.viewport ? { w: 200, h: 120 } : { w: 80, h: 40 };
    const east = edge.includes("e");
    const west = edge.includes("w");
    const south = edge.includes("s");
    const north = edge.includes("n");
    dragBoard(
      event,
      () => {},
      (dx, dy) => {
        // An edge changes one dimension, a corner both.
        const w = Math.round(Math.max(least.w, east ? w0 + dx : west ? w0 - dx : w0));
        const h = Math.round(Math.max(least.h, south ? h0 + dy : north ? h0 - dy : h0));
        const raw = itemsRawRef.current.find((entry) => entry.id === item.id);
        if (!raw) return;
        setSizes((prev) => ({ ...prev, [item.id]: { w, h, bw: raw.width, bh: raw.height } }));
        if (west || north) {
          const x = west ? origin.x + w0 - w : origin.x;
          const y = north ? origin.y + h0 - h : origin.y;
          setPositions((prev) => ({ ...prev, [item.id]: { x, y } }));
        }
      },
      queueSave,
    );
  };
  const onResizeItem = useCallback(
    (event: ReactPointerEvent<HTMLElement>, item: CanvasItem, edge: ResizeEdge) => resizeItemImpl.current(event, item, edge),
    [],
  );

  const boundsOf = useCallback(
    (targets: CanvasItem[]) => {
      let bounds: Bounds | null = null;
      for (const item of targets) {
        const r = rectOf(item);
        if (!r) continue;
        const box = { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h };
        bounds = bounds
          ? {
              minX: Math.min(bounds.minX, box.minX),
              minY: Math.min(bounds.minY, box.minY),
              maxX: Math.max(bounds.maxX, box.maxX),
              maxY: Math.max(bounds.maxY, box.maxY),
            }
          : box;
      }
      return bounds;
    },
    [rectOf],
  );

  const fitAll = useCallback(() => {
    const viewport = viewportRef.current;
    let bounds = boundsOf(shown);
    // Sections and notes belong to the picture too. A section's title sits above its frame.
    const extra: Bounds[] = [
      ...sections.map((s) => ({ minX: s.x, minY: s.y - SECTION_TITLE_ROOM, maxX: s.x + s.width, maxY: s.y + s.height })),
      ...notes.map((n) => {
        const height = worldRef.current?.querySelector<HTMLElement>(`[data-board-id="${CSS.escape(n.id)}"]`)?.offsetHeight ?? 80;
        return { minX: n.x, minY: n.y, maxX: n.x + (n.width ?? NOTE_WIDTH), maxY: n.y + height };
      }),
    ];
    for (const box of extra) {
      bounds = bounds
        ? {
            minX: Math.min(bounds.minX, box.minX),
            minY: Math.min(bounds.minY, box.minY),
            maxX: Math.max(bounds.maxX, box.maxX),
            maxY: Math.max(bounds.maxY, box.maxY),
          }
        : box;
    }
    if (viewport && bounds) setCamera(fitBounds(bounds, viewport.clientWidth, viewport.clientHeight, FIT_PADDING));
  }, [boundsOf, notes, sections, setCamera, shown]);
  const fitAllRef = useRef(fitAll);
  fitAllRef.current = fitAll;

  /** Moves the camera only as far as needed to show `targets`, keeping the zoom when they fit. */
  const reveal = useCallback(
    (targets: CanvasItem[]) => {
      const viewport = viewportRef.current;
      const bounds = boundsOf(targets);
      if (!viewport || !bounds) return;
      const { x, y, z } = camera.current;
      const w = viewport.clientWidth;
      const h = viewport.clientHeight;
      const m = REVEAL_MARGIN;
      // Revealed items stop above the toolbar and its notices, which would
      // otherwise cover a new version just as it arrives.
      const toolbar = viewport.parentElement?.querySelector(".canvas-toolbar")?.getBoundingClientRect();
      const bottom = toolbar ? Math.max(m, viewport.getBoundingClientRect().bottom - toolbar.top + TOAST_ROW) : m;
      const top = Math.max(m, CHROME_TOP);
      const visible =
        bounds.minX * z + x >= m &&
        bounds.minY * z + y >= top &&
        bounds.maxX * z + x <= w - m &&
        bounds.maxY * z + y <= h - bottom;
      if (visible) return;
      // Zoom out only as far as the targets need; never zoom in.
      const next = clampZoom(
        Math.min(
          z,
          (w - m * 2) / Math.max(1, bounds.maxX - bounds.minX),
          (h - top - bottom) / Math.max(1, bounds.maxY - bounds.minY),
        ),
      );
      setCamera({
        x: w / 2 - ((bounds.minX + bounds.maxX) / 2) * next,
        y: (top + h - bottom) / 2 - ((bounds.minY + bounds.maxY) / 2) * next,
        z: next,
      });
    },
    [boundsOf, setCamera],
  );

  /**
   * Gives items a free saved position; other items never move. A new item
   * starts at its source position and an item put back from the trash where it
   * was; when that spot is taken, it goes just right of the items beside it.
   * A new version goes right of its original, else below it, else to the end
   * of the original's row or column, whichever is nearer.
   */
  const placeFree = useCallback(
    (targets: CanvasItem[], { besideOrigin }: { besideOrigin: boolean }) => {
      const targetIds = new Set(targets.map((item) => item.id));
      const taken = shown.filter((item) => !targetIds.has(item.id)).flatMap((item) => rectOf(item) ?? []);
      const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      const placed: Record<string, Position> = {};
      for (const item of targets) {
        const r = rectOf(item);
        if (!r) continue;
        const origin = besideOrigin && item.from ? shown.find((other) => other.id === item.from) : undefined;
        const o = origin && rectOf(origin);
        const spots = o
          ? [
              { x: o.x + o.w + ADD_GAP, y: o.y },
              { x: o.x, y: o.y + o.h + ADD_GAP },
            ]
          : [{ x: r.x, y: r.y }];
        let next = spots.find((spot) => !taken.some((other) => overlaps({ ...r, ...spot }, other)));
        if (!next) {
          const start = o ?? spots[0]!;
          const row = taken.filter((other) => other.y < start.y + r.h && start.y < other.y + other.h);
          const right = Math.max(...(row.length ? row : taken).map((other) => other.x + other.w));
          next = { x: right + ADD_GAP, y: start.y };
          if (o) {
            const column = taken.filter((other) => other.x < o.x + r.w && o.x < other.x + other.w);
            const below = { x: o.x, y: Math.max(...column.map((other) => other.y + other.h)) + ADD_GAP };
            if (below.y - o.y < next.x - o.x) next = below;
          }
        }
        next = sanitizePosition(next);
        placed[item.id] = next;
        taken.push({ ...r, ...next });
      }
      positionsRef.current = { ...positionsRef.current, ...placed };
      setPositions(positionsRef.current);
      queueSave();
    },
    [queueSave, rectOf, shown],
  );

  // New items, on reload or hot update, land in free space and come into view.
  useEffect(() => {
    const seen = known.current;
    const added = items.filter((item) => !seen?.has(item.id));
    if (!seen || !added.length) return;
    for (const item of added) seen.add(item.id);
    void document.fonts.ready.then(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          placeFree(added, { besideOrigin: true });
          // A new version comes into view with its original, ready to compare.
          const origins = shown.filter((item) => added.some((other) => other.from === item.id));
          reveal([...origins, ...added]);
        }),
      ),
    );
  }, [items, placeFree, reveal, shown]);

  /**
   * Writes `trashed` into the registry for an item the person moved into or out of
   * the trash. Until the registry has it, the canvas shows it as made; what the
   * registry cannot take stays in this browser instead.
   */
  const trashPending = useRef(new Map<string, boolean>());
  const [trashChecks, setTrashChecks] = useState(0);
  const saveTrashed = useCallback(
    (item: CanvasItem, want: boolean) => {
      if (shared) return;
      if (!want && trashKept.current.delete(item.id)) queueSave();
      const registered = itemsRef.current.find((entry) => entry.id === item.id);
      if (!registered) return;
      // A write the other way may still be on its way, as after a quick Undo: this one must follow it.
      const pending = trashPending.current.get(item.id);
      if (pending === want || (pending === undefined && !!registered.trashed === want)) return;
      trashPending.current.set(item.id, want);
      const refused = () => {
        // A put back the registry refused stays put back until the page closes.
        if (!want || trashPending.current.get(item.id) !== want) return;
        trashPending.current.delete(item.id);
        trashKept.current.add(item.id);
        queueSave();
      };
      const edit: DirectEdit = { kind: "item", id: item.id, set: { trashed: want } };
      fetch(EDIT_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ edits: [edit] }) })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`edit ${response.status}`))))
        .then((result: { missing?: unknown }) => {
          if (Array.isArray(result.missing) && result.missing.includes(item.id)) return refused();
          window.setTimeout(() => {
            if (trashPending.current.get(item.id) !== want) return;
            trashPending.current.delete(item.id);
            setTrashChecks((n) => n + 1);
          }, TRASH_WRITE_GRACE);
        })
        .catch(refused);
    },
    [queueSave],
  );

  /** Back on the canvas where it was, or beside its row if that spot was taken meanwhile. */
  const restore = useCallback(
    (item: CanvasItem) => {
      setTrash(trashRef.current.filter((id) => id !== item.id));
      setFrontId(item.id);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          placeFree([item], { besideOrigin: false });
          reveal([item]);
        }),
      );
    },
    [placeFree, reveal, setTrash],
  );
  const putBack = useCallback(
    (item: CanvasItem) => {
      restore(item);
      saveTrashed(item, false);
    },
    [restore, saveTrashed],
  );
  const moveToTrash = useCallback(
    (item: CanvasItem) => {
      const open = openRef.current && annotationsRef.current.find((a) => a.id === openRef.current?.id);
      if (open && open.itemId === item.id) closeAnnotation();
      setTrash([item.id, ...trashRef.current.filter((id) => id !== item.id)]);
      saveTrashed(item, true);
      setFrontId((front) => (front === item.id ? null : front));
      // The button that had focus is gone with its item.
      viewportRef.current?.focus({ preventScroll: true });
      notify(labels.movedToTrash(item.name), { label: labels.undo, run: () => putBack(item) });
    },
    [closeAnnotation, notify, putBack, saveTrashed, setTrash],
  );

  // A trash an older shell kept only in this browser goes into the registry, once.
  const movedOldTrash = useRef(false);
  useEffect(() => {
    if (shared || saved.trash.inRegistry || movedOldTrash.current) return;
    movedOldTrash.current = true;
    for (const id of saved.trash.ids) {
      const item = itemsRef.current.find((entry) => entry.id === id);
      if (item) saveTrashed(item, true);
    }
    queueSave();
  }, [queueSave, saveTrashed, saved.trash]);
  // The trash follows the registry: a write landing, or `trashed` changed by the agent or another tab.
  useEffect(() => {
    if (shared) return;
    const inTrash = (item: CanvasItem) => {
      const pending = trashPending.current.get(item.id);
      if (pending !== undefined && pending !== !!item.trashed) return pending;
      trashPending.current.delete(item.id);
      return !!item.trashed || trashKept.current.has(item.id);
    };
    const into = items.filter((item) => inTrash(item) && !trashRef.current.includes(item.id)).map((item) => item.id);
    if (into.length) setTrash([...into, ...trashRef.current]);
    for (const item of items) if (!inTrash(item) && trashRef.current.includes(item.id)) restore(item);
  }, [items, restore, setTrash, trashChecks]);

  const closeSharePanel = useCallback(() => {
    setSharedFile(null);
    shareButtonRef.current?.focus({ preventScroll: true });
  }, []);
  // Like the trash, the share panel closes on a press outside it.
  useEffect(() => {
    if (!sharedFile) return;
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".canvas-share-popover, .canvas-share-button")) return;
      setSharedFile(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [sharedFile]);

  const closeTrash = useCallback(() => {
    setTrashOpen(false);
    trashButtonRef.current?.focus({ preventScroll: true });
  }, []);

  // The trash closes on a press outside it, and when it has nothing left.
  useEffect(() => {
    if (!trashOpen) return;
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".canvas-trash-popover, .canvas-trash-button")) return;
      setTrashOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [trashOpen]);
  useEffect(() => {
    if (!trashedItems.length) setTrashOpen(false);
  }, [trashedItems.length]);

  /** Canvas-item links (`#<id>`) reveal their item; anything else stays on the canvas. */
  const followLink = useCallback(
    (href: string) => {
      if (href.startsWith("#")) {
        const target = shown.find((item) => item.id === decodeURIComponent(href.slice(1)));
        if (target) {
          setFrontId(target.id);
          reveal([target]);
        }
        return;
      }
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      const here = window.location;
      if (url.origin === here.origin && url.pathname === here.pathname && url.search === here.search) return;
      notify(labels.linkBlocked(url.origin === here.origin ? `${url.pathname}${url.search}` : url.href));
    },
    [notify, reveal, shown],
  );

  const resetCamera = useCallback(() => setCamera(DEFAULT_CAMERA), [setCamera]);

  // The buttons and + and − step between fixed levels (see ZOOM_STOPS), around the centre of the view.
  const zoomStep = useCallback(
    (direction: 1 | -1) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const z = camera.current.z;
      setCamera(zoomAt(camera.current, nextZoomStop(z, direction) / z, viewport.clientWidth / 2, viewport.clientHeight / 2));
    },
    [setCamera],
  );

  // Figma's view keys, read by the key handler below: Shift + 0 zooms to 100%
  // around the centre and keeps the place (plain 0 also moves the camera back to
  // the start), Shift + 2 fits the selected note or section. With nothing
  // selected Shift + 2 does nothing, as in Figma.
  const viewKeys = useRef({ actualSize: () => {}, selection: () => {} });
  viewKeys.current = {
    actualSize: () => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      setCamera(zoomAt(camera.current, 1 / camera.current.z, viewport.clientWidth / 2, viewport.clientHeight / 2));
    },
    selection: () => {
      const viewport = viewportRef.current;
      const key = selectedRef.current;
      if (!viewport || !key) return;
      const [side, kind, id] = key.split(":") as ["g" | "e", BoardKind, string];
      const attr = side === "g" ? "data-board-ghost" : "data-board-id";
      const element = worldRef.current?.querySelector<HTMLElement>(
        kind === "section" ? `.canvas-section[${attr}="${CSS.escape(id)}"] .canvas-section-frame` : `.canvas-note-card[${attr}="${CSS.escape(id)}"]`,
      );
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const view = viewport.getBoundingClientRect();
      const { x, y, z } = camera.current;
      const bounds = {
        minX: (rect.left - view.left - x) / z,
        minY: (rect.top - view.top - y) / z - (kind === "section" ? SECTION_TITLE_ROOM : 0),
        maxX: (rect.right - view.left - x) / z,
        maxY: (rect.bottom - view.top - y) / z,
      };
      setCamera(fitBounds(bounds, viewport.clientWidth, viewport.clientHeight, FIT_PADDING, ZOOM_MAX));
    },
  };

  // A click on empty canvas selects the section under it, the innermost one
  // where sections overlap, or lets go of the selection when there is none. The
  // frame takes no presses (a drag inside still pans), so this is a hit test.
  const tapSurfaceRef = useRef<(clientX: number, clientY: number) => void>(() => {});
  tapSurfaceRef.current = (clientX, clientY) => {
    if (shared || boardToolRef.current) return;
    let best: { ref: BoardRef; area: number } | null = null;
    for (const element of worldRef.current?.querySelectorAll<HTMLElement>(".canvas-section[data-interactive]") ?? []) {
      const frame = element.querySelector(".canvas-section-frame")?.getBoundingClientRect();
      if (!frame || clientX < frame.left || clientX > frame.right || clientY < frame.top || clientY > frame.bottom) continue;
      const ghost = element.dataset.boardGhost;
      const id = ghost ?? element.dataset.boardId;
      const area = frame.width * frame.height;
      if (id && (!best || area < best.area)) best = { ref: { kind: "section", id, ghost: ghost !== undefined }, area };
    }
    select(best?.ref ?? null);
  };

  // First paint: apply the saved camera, or fit everything once layout settles
  // and the viewport has a real size. A tab opened in the background can
  // report a zero-size viewport, which would fit everything at minimum zoom.
  useEffect(() => {
    render();
    const viewport = viewportRef.current;
    if (saved.camera || !viewport) return;
    let settled = false;
    let fitted = false;
    const tryFit = () => {
      if (fitted || !settled || viewport.clientWidth < MIN_FIT_SIZE || viewport.clientHeight < MIN_FIT_SIZE) return;
      fitted = true;
      observer.disconnect();
      fitAllRef.current();
    };
    const observer = new ResizeObserver(tryFit);
    observer.observe(viewport);
    void document.fonts.ready.then(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          settled = true;
          tryFit();
        }),
      ),
    );
    return () => {
      fitted = true;
      observer.disconnect();
    };
  }, [render, saved.camera]);

  // A theme change reaches every item frame and is saved with the layout.
  const lastTheme = useRef(themeId);
  useEffect(() => {
    if (!theme || themeId === undefined || themeId === lastTheme.current) return;
    lastTheme.current = themeId;
    for (const frameElement of worldRef.current?.querySelectorAll<HTMLIFrameElement>("iframe[data-canvas-frame]") ?? []) {
      if (frameElement.contentWindow) postToFrame(frameElement.contentWindow, { type: "theme", id: themeId });
    }
    queueSave();
  }, [queueSave, theme, themeId]);

  // Annotate mode reaches the viewport (cursor) and every item frame, including
  // frames that load or reload while it is on.
  useEffect(() => {
    const viewport = viewportRef.current;
    const world = worldRef.current;
    if (!viewport || !world) return;
    viewport.toggleAttribute("data-annotating", annotating);
    if (!annotating && pickRef.current) pickRef.current.hidden = true;
    const tell = (frameElement: HTMLIFrameElement) => {
      if (frameElement.contentWindow) postToFrame(frameElement.contentWindow, { type: "annotate-mode", on: annotating });
    };
    for (const frameElement of world.querySelectorAll<HTMLIFrameElement>("iframe[data-canvas-frame]")) tell(frameElement);
    const onLoad = (event: Event) => {
      if (event.target instanceof HTMLIFrameElement && event.target.dataset.canvasFrame) tell(event.target);
    };
    world.addEventListener("load", onLoad, true);
    return () => world.removeEventListener("load", onLoad, true);
  }, [annotating]);

  // Gesture ownership. Only one gesture owns the pointer at a time.
  const gesture = useRef<
    // `tap`: a press on empty canvas, which selects a section if it never travels.
    | { kind: "pan"; pointerId: number; lastX: number; lastY: number; moved: number; tap: boolean }
    | { kind: "move"; pointerId: number; id: string; startX: number; startY: number; origin: Position; moved: number }
    | { kind: "pinch"; startMid: Position; startDistance: number; startCamera: Camera }
    | null
  >(null);
  const spaceArmed = useRef(false);
  /** Z held, as in Figma: presses zoom instead of reaching items, notes, sections, or previews. */
  const zoomArmed = useRef(false);
  const touches = useRef(new Map<number, Position>());

  const suppressNextClick = useCallback(() => {
    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    clickSuppressed.current = true;
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.addEventListener("auxclick", swallow, { capture: true, once: true });
    window.setTimeout(() => {
      clickSuppressed.current = false;
      window.removeEventListener("click", swallow, { capture: true });
      window.removeEventListener("auxclick", swallow, { capture: true });
    }, 0);
  }, []);

  const endGesture = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    const viewport = viewportRef.current;
    viewport?.removeAttribute("data-gesture");
    if (!current) return;
    if (current.kind === "move") {
      const element = elements.current.get(current.id);
      const transform = element?.style.transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/);
      if (transform) {
        const next = sanitizePosition({ x: Number(transform[1]), y: Number(transform[2]) });
        setPositions((prev) => ({ ...prev, [current.id]: next }));
        positionsRef.current = { ...positionsRef.current, [current.id]: next };
      }
      queueSave();
    }
    if ((current.kind === "pan" || current.kind === "move") && current.moved > DRAG_THRESHOLD) suppressNextClick();
  }, [queueSave, suppressNextClick]);

  // The Note and Section tools place marks on empty canvas. Held in a ref so the
  // gesture effect below, which sets up once, always runs the current version.
  const boardPressRef = useRef<(event: PointerEvent) => boolean>(() => false);
  boardPressRef.current = (event) => {
    const tool = boardToolRef.current;
    const viewport = viewportRef.current;
    const world = worldRef.current;
    if (!tool || !viewport || !world) return false;
    if (event.button !== 0 || event.pointerType === "touch" || spaceArmed.current) return false;
    if (event.target !== viewport && event.target !== world) return false;
    event.preventDefault();
    event.stopPropagation();
    // The new mark's field takes focus; without this the press's own focus change would blur it at once.
    window.addEventListener("mousedown", (e) => e.preventDefault(), { capture: true, once: true });
    const toWorld = (clientX: number, clientY: number) => {
      const rect = viewport.getBoundingClientRect();
      const { x, y, z } = camera.current;
      return { x: (clientX - rect.left - x) / z, y: (clientY - rect.top - y) / z };
    };
    if (tool === "note") {
      const point = toWorld(event.clientX, event.clientY);
      startMark("note", point.x, point.y);
      setBoardTool(null);
      return true;
    }
    const start = { x: event.clientX, y: event.clientY };
    const box = drawRef.current;
    const dragged = (e: PointerEvent) => ({
      left: Math.min(start.x, e.clientX),
      top: Math.min(start.y, e.clientY),
      right: Math.max(start.x, e.clientX),
      bottom: Math.max(start.y, e.clientY),
    });
    try {
      viewport.setPointerCapture(event.pointerId);
    } catch {
      // The pointer may already be gone.
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId || !box) return;
      const r = dragged(e);
      Object.assign(box.style, {
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.right - r.left}px`,
        height: `${r.bottom - r.top}px`,
      });
      box.hidden = false;
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerup", end);
      viewport.removeEventListener("pointercancel", end);
      if (box) box.hidden = true;
      if (e.type === "pointercancel") return;
      const r = dragged(e);
      const a = toWorld(r.left, r.top);
      const b = toWorld(r.right, r.bottom);
      if (b.x - a.x < SECTION_MIN_W || b.y - a.y < SECTION_MIN_H) return;
      suppressNextClick();
      startMark("section", a.x, a.y, { w: Math.round(b.x - a.x), h: Math.round(b.y - a.y) });
      setBoardTool(null);
    };
    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("pointerup", end);
    viewport.addEventListener("pointercancel", end);
    return true;
  };
  // The tool turns previews and notes inert and the cursor into a crosshair (canvas.css).
  useEffect(() => {
    viewportRef.current?.toggleAttribute("data-board-tool", !!boardTool);
  }, [boardTool]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const world = worldRef.current;
    if (!viewport || !world) return;

    const isSurface = (target: EventTarget | null) => target === viewport || target === world;
    const local = (clientX: number, clientY: number) => {
      const rect = viewport.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const armSpace = () => {
      spaceArmed.current = true;
      viewport.setAttribute("data-space", "true");
    };
    const clearHeld = () => {
      spaceArmed.current = false;
      viewport.removeAttribute("data-space");
    };
    // Z held: the cursor shows which way a click zooms; Alt flips it to zoom out.
    const armZoom = (out: boolean) => {
      zoomArmed.current = true;
      viewport.setAttribute("data-zoom", out ? "out" : "in");
      hidePick();
    };
    const clearZoom = () => {
      zoomArmed.current = false;
      viewport.removeAttribute("data-zoom");
    };
    const isZoomKey = (event: KeyboardEvent) => event.code === "KeyZ" || event.key === "z" || event.key === "Z";

    // A press while Z is held: a click zooms one step in (Alt: out) around the
    // pointer, a drag zooms to the area it draws, as Figma's zoom does.
    let zoomDrag: { pointerId: number; x: number; y: number; moved: boolean } | null = null;
    const startZoom = (event: PointerEvent) => {
      zoomDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      try {
        viewport.setPointerCapture(event.pointerId);
      } catch {
        // The pointer may already be gone.
      }
    };
    const zoomArea = (current: NonNullable<typeof zoomDrag>, clientX: number, clientY: number) => ({
      left: Math.min(current.x, clientX),
      top: Math.min(current.y, clientY),
      right: Math.max(current.x, clientX),
      bottom: Math.max(current.y, clientY),
    });
    const moveZoom = (event: PointerEvent) => {
      if (!zoomDrag || event.pointerId !== zoomDrag.pointerId) return false;
      if (!zoomDrag.moved && Math.hypot(event.clientX - zoomDrag.x, event.clientY - zoomDrag.y) <= DRAG_THRESHOLD) return true;
      zoomDrag.moved = true;
      placeBox(drawRef.current, zoomArea(zoomDrag, event.clientX, event.clientY));
      return true;
    };
    const endZoom = (event: PointerEvent) => {
      if (!zoomDrag || event.pointerId !== zoomDrag.pointerId) return false;
      const current = zoomDrag;
      zoomDrag = null;
      if (drawRef.current) drawRef.current.hidden = true;
      if (event.type !== "pointerup") return true;
      // The release must not also click what is under it, copy a reference, or place an annotation.
      suppressNextClick();
      const area = zoomArea(current, event.clientX, event.clientY);
      const rect = viewport.getBoundingClientRect();
      const { x, y, z } = camera.current;
      // An area too thin to mean anything is a click.
      if (current.moved && area.right - area.left > 8 && area.bottom - area.top > 8) {
        const toWorld = (cx: number, cy: number) => ({ x: (cx - rect.left - x) / z, y: (cy - rect.top - y) / z });
        const a = toWorld(area.left, area.top);
        const b = toWorld(area.right, area.bottom);
        setCamera(fitBounds({ minX: a.x, minY: a.y, maxX: b.x, maxY: b.y }, viewport.clientWidth, viewport.clientHeight, 0, ZOOM_MAX));
      } else {
        const factor = nextZoomStop(z, event.altKey ? -1 : 1) / z;
        setCamera(zoomAt(camera.current, factor, event.clientX - rect.left, event.clientY - rect.top));
      }
      return true;
    };

    const startPan = (event: PointerEvent, tap = false) => {
      gesture.current = { kind: "pan", pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, moved: 0, tap };
      viewport.setAttribute("data-gesture", "pan");
      try {
        viewport.setPointerCapture(event.pointerId);
      } catch {
        // The pointer may already be gone.
      }
    };

    const startPinch = () => {
      const [a, b] = [...touches.current.values()];
      if (!a || !b) return;
      const rect = viewport.getBoundingClientRect();
      gesture.current = {
        kind: "pinch",
        startMid: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top },
        startDistance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        startCamera: { ...camera.current },
      };
    };

    // Moving, resizing, and selecting cancel the press's default to stop text
    // selection, which also keeps keyboard focus where it was. If that was in a
    // preview, ⌘/Ctrl + Z, Delete, and the tool keys would go to the preview after
    // the drag, so a press on the canvas outside previews takes focus back.
    const releasePreviewFocus = (target: EventTarget | null) => {
      const active = document.activeElement;
      if (!active || active === viewport || !world.contains(active) || !active.closest(".canvas-preview")) return;
      if (target instanceof Element && target.closest(".canvas-preview")) return;
      viewport.focus({ preventScroll: true });
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 0 && zoomArmed.current && event.pointerType !== "touch") {
        // Z wins over everything under the pointer, as Space does.
        event.preventDefault();
        event.stopPropagation();
        startZoom(event);
        return;
      }
      if (event.button === 0 && !spaceArmed.current) releasePreviewFocus(event.target);
      if (boardPressRef.current(event)) return;
      if (event.pointerType === "touch") {
        touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.current.size === 2) {
          // Two fingers always belong to the canvas, even over a preview.
          if (gesture.current?.kind === "move") endGesture();
          startPinch();
        } else if (touches.current.size === 1 && isSurface(event.target)) startPan(event, true);
        return;
      }
      const middle = event.button === 1;
      const spacePan = event.button === 0 && spaceArmed.current;
      const surface = event.button === 0 && !event.altKey && isSurface(event.target);
      if (!middle && !spacePan && !surface) return;
      event.preventDefault();
      if (middle || spacePan) event.stopPropagation();
      if (surface) viewport.focus({ preventScroll: true });
      startPan(event, surface && !spacePan);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" && touches.current.has(event.pointerId)) {
        touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const pinch = gesture.current;
        if (pinch?.kind === "pinch" && touches.current.size >= 2) {
          const [a, b] = [...touches.current.values()];
          if (!a || !b) return;
          const rect = viewport.getBoundingClientRect();
          const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
          const start = pinch.startCamera;
          const z = sanitizeCamera({ ...start, z: (start.z * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.startDistance }).z;
          const worldX = (pinch.startMid.x - start.x) / start.z;
          const worldY = (pinch.startMid.y - start.y) / start.z;
          setCamera({ x: mid.x - worldX * z, y: mid.y - worldY * z, z });
          return;
        }
      }
      if (moveZoom(event)) return;
      const pan = gesture.current;
      if (pan?.kind !== "pan" || pan.pointerId !== event.pointerId) return;
      const dx = event.clientX - pan.lastX;
      const dy = event.clientY - pan.lastY;
      pan.lastX = event.clientX;
      pan.lastY = event.clientY;
      pan.moved += Math.abs(dx) + Math.abs(dy);
      setCamera({ ...camera.current, x: camera.current.x + dx, y: camera.current.y + dy });
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (endZoom(event)) return;
      if (event.pointerType === "touch") {
        touches.current.delete(event.pointerId);
        if (gesture.current?.kind === "pinch" && touches.current.size < 2) endGesture();
      }
      const current = gesture.current;
      if (current && "pointerId" in current && current.pointerId === event.pointerId) {
        const tapped = current.kind === "pan" && current.tap && current.moved <= DRAG_THRESHOLD && event.type === "pointerup";
        endGesture();
        if (tapped) tapSurfaceRef.current(event.clientX, event.clientY);
      }
    };

    // Middle-button autoscroll starts on mousedown, so it is cancelled there too.
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };

    const wheelAt = (dx: number, dy: number, x: number, y: number, zoom: boolean) => {
      if (zoom) setCamera(zoomAt(camera.current, Math.exp(-dy * WHEEL_ZOOM), x, y));
      else setCamera({ ...camera.current, x: camera.current.x - dx, y: camera.current.y - dy });
    };

    const onWheel = (event: WheelEvent) => {
      const { dx, dy } = wheelPixels(event, viewport.clientHeight);
      // Trackpad pinch arrives as a ctrl-modified wheel.
      const zoom = event.ctrlKey || event.metaKey;
      if (!zoom && nestedCanScroll(event.target, viewport, dx, dy)) return;
      event.preventDefault();
      const point = local(event.clientX, event.clientY);
      wheelAt(dx, dy, point.x, point.y, zoom);
    };

    // Focus moving offscreen scrolls the clipped viewport natively; turn that
    // scroll into camera movement so nothing shifts under the transform.
    const onScroll = () => {
      const { scrollLeft, scrollTop } = viewport;
      if (!scrollLeft && !scrollTop) return;
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
      setCamera({ ...camera.current, x: camera.current.x - scrollLeft, y: camera.current.y - scrollTop });
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target === viewport || !world.contains(target)) return;
      const rect = target.getBoundingClientRect();
      const view = viewport.getBoundingClientRect();
      const margin = 32;
      let dx = 0;
      let dy = 0;
      if (rect.right > view.right - margin) dx = view.right - margin - rect.right;
      if (rect.left < view.left + margin) dx = view.left + margin - rect.left;
      if (rect.bottom > view.bottom - margin) dy = view.bottom - margin - rect.bottom;
      if (rect.top < view.top + margin) dy = view.top + margin - rect.top;
      if (dx || dy) setCamera({ ...camera.current, x: camera.current.x + dx, y: camera.current.y + dy });
    };

    // Element references: hold Alt/Option to outline, click to copy.
    const pointer = { x: -1, y: -1 };
    const pickTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element) || target instanceof HTMLIFrameElement) return null;
      const preview = target.closest<HTMLElement>("[data-canvas-preview]");
      if (!preview || !world.contains(preview)) return null;
      const item = items.find((entry) => entry.id === preview.dataset.canvasPreview);
      const element = pickElement(target, preview);
      return item && element ? { item, element, preview } : null;
    };
    const hidePick = () => {
      if (pickRef.current) pickRef.current.hidden = true;
    };
    const placeBox = (box: HTMLElement | null, rect: { left: number; top: number; right: number; bottom: number }) => {
      if (!box) return;
      Object.assign(box.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.right - rect.left}px`,
        height: `${rect.bottom - rect.top}px`,
      });
      box.hidden = false;
    };
    const showPick = (target: EventTarget | null) => {
      const pick = pickTarget(target);
      if (!pick) return hidePick();
      placeBox(pickRef.current, pick.element.getBoundingClientRect());
    };
    // In annotate mode an item's title (its name or grip, not its actions) stands for the whole item.
    const headItem = (target: EventTarget | null) => {
      if (!(target instanceof Element) || target.closest(".canvas-item-action")) return null;
      const element = target.closest(".canvas-item-head")?.closest<HTMLElement>(".canvas-item");
      const item = element && items.find((entry) => entry.id === element.dataset.canvasItem);
      const preview = element?.querySelector<HTMLElement>("[data-canvas-preview]");
      return item && preview && world.contains(element) ? { item, preview } : null;
    };

    // In annotate mode a drag across a preview marks an area; a press that does
    // not travel past the drag threshold stays a click on one element.
    let drawing: { pointerId: number; item: CanvasItem; preview: HTMLElement; x: number; y: number; moved: boolean } | null =
      null;
    const areaOf = (current: NonNullable<typeof drawing>, clientX: number, clientY: number) => {
      const rect = current.preview.getBoundingClientRect();
      const clampX = (x: number) => Math.min(rect.right, Math.max(rect.left, x));
      const clampY = (y: number) => Math.min(rect.bottom, Math.max(rect.top, y));
      const [x1, x2] = [clampX(current.x), clampX(clientX)].sort((a, b) => a - b);
      const [y1, y2] = [clampY(current.y), clampY(clientY)].sort((a, b) => a - b);
      return { left: x1!, top: y1!, right: x2!, bottom: y2! };
    };
    const cancelDraw = () => {
      drawing = null;
      if (drawRef.current) drawRef.current.hidden = true;
    };
    const moveDraw = (event: PointerEvent) => {
      if (!drawing || event.pointerId !== drawing.pointerId) return false;
      if (!drawing.moved) {
        if (Math.hypot(event.clientX - drawing.x, event.clientY - drawing.y) <= DRAG_THRESHOLD) return true;
        drawing.moved = true;
        // Keeps the drag when it passes over another item's frame. Only now: a
        // captured plain click would land on the preview, not the element.
        try {
          drawing.preview.setPointerCapture(event.pointerId);
        } catch {
          // The pointer may already be gone.
        }
        hidePick();
      }
      placeBox(drawRef.current, areaOf(drawing, event.clientX, event.clientY));
      return true;
    };
    const endDraw = (event: PointerEvent) => {
      if (!drawing || event.pointerId !== drawing.pointerId) return;
      const current = drawing;
      cancelDraw();
      if (!current.moved || event.type === "pointercancel") return;
      // The drag made an area; its click must not also annotate one element.
      suppressNextClick();
      const area = areaOf(current, event.clientX, event.clientY);
      const rect = current.preview.getBoundingClientRect();
      const scale = rect.width / Math.max(1, current.preview.offsetWidth);
      const x = Math.round((area.left - rect.left) / scale);
      const y = Math.round((area.top - rect.top) / scale);
      const w = Math.round((area.right - area.left) / scale);
      const h = Math.round((area.bottom - area.top) / scale);
      if (w < 4 || h < 4) return;
      const { names, more } = describeArea(current.preview, area);
      startAnnotation(current.item.id, x, y, `${current.item.name} › ${labels.areaRef(w, h, x, y, names, more)}`, { w, h });
    };

    const onPickMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      // Alt shows the copy cursor over previews (canvas.css); the key event alone can be missed.
      viewport.toggleAttribute("data-alt", event.altKey);
      if (zoomArmed.current) {
        // With Z held, Alt means zoom out, never a reference.
        viewport.setAttribute("data-zoom", event.altKey ? "out" : "in");
        hidePick();
        return;
      }
      if (moveDraw(event)) return;
      if ((event.altKey || annotatingRef.current) && !gesture.current) {
        const head = annotatingRef.current && !event.altKey ? headItem(event.target) : null;
        if (head) placeBox(pickRef.current, head.preview.getBoundingClientRect());
        else showPick(event.target);
      } else hidePick();
    };
    // In annotate mode previews stop reacting to presses, except the ones that
    // pan (Space held, middle button).
    const blockPick = (event: MouseEvent) => {
      // A press with Z held zooms (onPointerDown), so it must reach the canvas.
      if (zoomArmed.current) return;
      const annotatePress = annotatingRef.current && event.button === 0 && !spaceArmed.current;
      const pick = pickTarget(event.target);
      if ((!event.altKey && !annotatePress) || !pick) return;
      event.preventDefault();
      event.stopPropagation();
      if (annotatePress && !event.altKey && event.type === "pointerdown" && (event as PointerEvent).pointerType !== "touch") {
        const { pointerId } = event as PointerEvent;
        drawing = { pointerId, item: pick.item, preview: pick.preview, x: event.clientX, y: event.clientY, moved: false };
      }
    };
    const onPickClick = (event: MouseEvent) => {
      if ((!event.altKey && !annotatingRef.current) || clickSuppressed.current) return;
      const head = annotatingRef.current && !event.altKey ? headItem(event.target) : null;
      if (head) {
        // Instead of copying the name: a note on the whole item, outlined like an area.
        event.preventDefault();
        event.stopPropagation();
        const { item, preview } = head;
        startAnnotation(item.id, 0, 0, item.name, { w: preview.offsetWidth, h: preview.offsetHeight });
        return;
      }
      const pick = pickTarget(event.target);
      if (!pick) return;
      event.preventDefault();
      event.stopPropagation();
      const ref = `${pick.item.name} › ${describeElement(pick.element, pick.preview)}`;
      if (event.altKey) {
        void copyReference(ref);
        return;
      }
      // Pin point in unscaled preview units, so it stays put at any zoom. The
      // scale is read from the preview as drawn, not from the camera, which can
      // be a frame ahead of the paint.
      const rect = pick.preview.getBoundingClientRect();
      const scale = rect.width / Math.max(1, pick.preview.offsetWidth);
      startAnnotation(pick.item.id, (event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale, ref);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") viewport.setAttribute("data-alt", "");
      if (event.key === "Alt" && zoomArmed.current) viewport.setAttribute("data-zoom", "out");
      else if (event.key === "Alt" && pointer.x >= 0) showPick(document.elementFromPoint(pointer.x, pointer.y));
      // Hold Z to zoom, as in Figma, unless a field takes the letter. Repeats arm it
      // too, so it comes back if a frame's focus loss let it go while the key is down.
      if (isZoomKey(event) && !event.metaKey && !event.ctrlKey && !(event.target instanceof Element && typingIn(event.target))) {
        if (!zoomArmed.current) armZoom(event.altKey);
        if (event.target === viewport || event.target === document.body) event.preventDefault();
      }
      // A toggles annotate mode, Escape leaves it, as long as nothing editable has focus.
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
      // Previews keep their own keys; the canvas, its toolbar, and pins take these.
      const canvasFocus =
        event.target === viewport ||
        event.target === document.body ||
        (event.target instanceof Element && event.target.closest(".canvas-toolbar, .canvas-pin-bubble") !== null) ||
        // A focused note or section itself, not the field inside a ghost.
        (event.target instanceof Element && event.target.matches(".canvas-note-card, .canvas-section-tab"));
      // ⌘/Ctrl + Z undoes the last saved change, unless a field or a preview has the key (its own undo).
      if (
        !shared &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "z" &&
        // From anywhere on the canvas, a grip included, but not in a preview, which keeps its own keys.
        !(event.target instanceof Element && (event.target.closest(".canvas-preview") || typingIn(event.target)))
      ) {
        event.preventDefault();
        void undoSavedRef.current();
        return;
      }
      if (!shared && plain && canvasFocus && (event.key === "a" || event.key === "A") && !event.repeat) {
        event.preventDefault();
        chooseTool("annotate");
        if (annotatingRef.current && pointer.x >= 0) showPick(document.elementFromPoint(pointer.x, pointer.y));
        return;
      }
      // V puts every tool down, N and S pick the Note and Section tools.
      const toolKey = shared || !plain || !canvasFocus || event.repeat ? undefined : { v: "select", n: "note", s: "section" }[event.key.toLowerCase()];
      if (toolKey) {
        event.preventDefault();
        chooseTool(toolKey as "select" | BoardKind);
        return;
      }
      // Delete or Backspace removes the selected note or section, unless a field has the keys.
      if (
        !shared &&
        plain &&
        canvasFocus &&
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedRef.current &&
        !openMarkRef.current &&
        !(event.target instanceof Element && typingIn(event.target))
      ) {
        event.preventDefault();
        deleteBoardRef.current();
        return;
      }
      // Escape puts a Note or Section tool down first, then leaves annotate mode.
      if (event.key === "Escape" && boardToolRef.current && canvasFocus) {
        setBoardTool(null);
        return;
      }
      if (event.key === "Escape" && annotatingRef.current && !openRef.current && !openMarkRef.current && canvasFocus) {
        setAnnotateMode(false);
        return;
      }
      if (event.key === "Escape" && selectedRef.current && !openMarkRef.current && canvasFocus) {
        select(null);
        return;
      }
      if (event.code === "Space" && !event.repeat) {
        const active = document.activeElement;
        const idle = !active || active === document.body || active === viewport;
        if (idle && !isEditable(active === viewport ? null : active)) {
          armSpace();
          event.preventDefault();
        }
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // The view keys work wherever the tool keys do; arrow keys pan only from the
      // canvas itself, since a focused note or section moves with them.
      if (!canvasFocus || (event.target instanceof Element && typingIn(event.target))) return;
      // Figma's: Shift + 0 is 100%, Shift + 1 fits all, Shift + 2 fits the selection.
      // By key position, since Shift changes the character (and differs by layout).
      const figmaView = event.shiftKey ? { Digit0: viewKeys.current.actualSize, Digit1: fitAll, Digit2: viewKeys.current.selection }[event.code] : undefined;
      if (figmaView) {
        event.preventDefault();
        figmaView();
        return;
      }
      const step = event.shiftKey ? KEY_PAN * 5 : KEY_PAN;
      const pan = event.target === viewport ? { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key] : undefined;
      if (pan) {
        event.preventDefault();
        setCamera({ ...camera.current, x: camera.current.x + pan[0]!, y: camera.current.y + pan[1]! });
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomStep(1);
      } else if (event.key === "-") {
        event.preventDefault();
        zoomStep(-1);
      } else if (event.key === "0") {
        event.preventDefault();
        resetCamera();
      } else if (event.key === "1") {
        event.preventDefault();
        fitAll();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") clearHeld();
      if (isZoomKey(event)) clearZoom();
      if (event.key === "Alt") viewport.removeAttribute("data-alt");
      if (event.key === "Alt" && zoomArmed.current) viewport.setAttribute("data-zoom", "in");
      if (event.key === "Alt" && !annotatingRef.current) hidePick();
    };
    const onBlur = () => {
      clearHeld();
      clearZoom();
      hidePick();
      cancelDraw();
      viewport.removeAttribute("data-alt");
      touches.current.clear();
      endGesture();
    };
    const onVisibility = () => {
      if (document.hidden) onBlur();
    };
    // Write only a pending change, so leaving never stores an untouched camera.
    const onPageHide = () => {
      if (saveTimer.current) flushSave();
    };

    // Item frames forward the gestures and picks they receive.
    const onMessage = (event: MessageEvent) => {
      if (!fromThisCanvas(event)) return;
      const message = readFrameMessage(event.data);
      if (!message) return;
      const frameElement = [...world.querySelectorAll<HTMLIFrameElement>("iframe[data-canvas-frame]")].find(
        (element) => element.contentWindow === event.source,
      );
      const item = frameElement && items.find((entry) => entry.id === frameElement.dataset.canvasFrame);
      if (!frameElement || !item) return;
      if (message.type === "wheel") {
        // Frame coordinates are unscaled; place them on the zoomed frame.
        const rect = frameElement.getBoundingClientRect();
        const z = camera.current.z;
        const point = local(rect.left + message.x * z, rect.top + message.y * z);
        wheelAt(message.dx, message.dy, point.x, point.y, message.zoom);
      } else if (message.type === "space") {
        if (message.down) armSpace();
        else clearHeld();
      } else if (message.type === "zoom-key") {
        if (message.down) armZoom(message.out);
        else clearZoom();
      } else if (message.type === "pick") {
        void copyReference(`${item.name} › ${message.label}`);
      } else if (message.type === "annotate") {
        // A frame fills its preview at item size, so frame pixels are preview units.
        if (annotatingRef.current) startAnnotation(item.id, message.x, message.y, `${item.name} › ${message.label}`);
      } else if (message.type === "annotate-area") {
        if (annotatingRef.current) {
          const { x, y, w, h } = message;
          startAnnotation(item.id, x, y, `${item.name} › ${message.label}`, { w, h });
        }
      } else if (message.type === "escape") {
        if (annotatingRef.current) setAnnotateMode(false);
      } else if (message.type === "link") {
        followLink(message.href);
      } else {
        notify(labels.formBlocked);
      }
    };

    // Previews and their portals never navigate the canvas away. Their own
    // click handlers still run; only the browser's navigation is cancelled.
    const onLinkClick = (event: MouseEvent) => {
      // A click that placed a annotation was already cancelled by the pick handler.
      if (annotatingRef.current && event.defaultPrevented) return;
      const anchor = previewLink(event);
      if (!anchor) return;
      event.preventDefault();
      if (!clickSuppressed.current) followLink(anchor.getAttribute("href") ?? "");
    };
    // Router mocks report programmatic navigation the same way.
    const onNavigate = (event: Event) => {
      const href = (event as CustomEvent<unknown>).detail;
      if (typeof href === "string") followLink(href);
    };
    // Bubble phase: a preview that handles its own submit has already cancelled it.
    const onSubmit = (event: SubmitEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element) || event.target.closest(CHROME)) return;
      event.preventDefault();
      notify(labels.formBlocked);
    };

    // Block horizontal overscroll (Chrome history swipes) while the canvas is open.
    const html = document.documentElement;
    const previous = { html: html.style.overscrollBehaviorX, body: document.body.style.overscrollBehaviorX };
    html.style.overscrollBehaviorX = "none";
    document.body.style.overscrollBehaviorX = "none";

    viewport.addEventListener("pointerdown", onPointerDown, { capture: true });
    viewport.addEventListener("pointermove", onPointerMove, { capture: true });
    viewport.addEventListener("pointerup", onPointerEnd, { capture: true });
    viewport.addEventListener("pointercancel", onPointerEnd, { capture: true });
    viewport.addEventListener("lostpointercapture", onPointerEnd);
    viewport.addEventListener("mousedown", onMouseDown, { capture: true });
    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("scroll", onScroll);
    viewport.addEventListener("focusin", onFocusIn);
    // Picks run before React and preview handlers, so Alt-click never activates a control.
    window.addEventListener("pointermove", onPickMove, { capture: true });
    window.addEventListener("pointerdown", blockPick, { capture: true });
    window.addEventListener("mousedown", blockPick, { capture: true });
    window.addEventListener("click", onPickClick, { capture: true });
    window.addEventListener("pointerup", endDraw, { capture: true });
    window.addEventListener("pointercancel", endDraw, { capture: true });
    window.addEventListener("click", onLinkClick, { capture: true });
    window.addEventListener("submit", onSubmit);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("message", onMessage);
    window.addEventListener(NAVIGATE_EVENT, onNavigate);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      viewport.removeEventListener("pointerdown", onPointerDown, { capture: true });
      viewport.removeEventListener("pointermove", onPointerMove, { capture: true });
      viewport.removeEventListener("pointerup", onPointerEnd, { capture: true });
      viewport.removeEventListener("pointercancel", onPointerEnd, { capture: true });
      viewport.removeEventListener("lostpointercapture", onPointerEnd);
      viewport.removeEventListener("mousedown", onMouseDown, { capture: true });
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("pointermove", onPickMove, { capture: true });
      window.removeEventListener("pointerdown", blockPick, { capture: true });
      window.removeEventListener("mousedown", blockPick, { capture: true });
      window.removeEventListener("click", onPickClick, { capture: true });
      window.removeEventListener("pointerup", endDraw, { capture: true });
      window.removeEventListener("pointercancel", endDraw, { capture: true });
      window.removeEventListener("click", onLinkClick, { capture: true });
      window.removeEventListener("submit", onSubmit);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("message", onMessage);
      window.removeEventListener(NAVIGATE_EVENT, onNavigate);
      document.removeEventListener("visibilitychange", onVisibility);
      html.style.overscrollBehaviorX = previous.html;
      document.body.style.overscrollBehaviorX = previous.body;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      if (saveTimer.current) flushSave();
    };
  }, [
    copyReference,
    endGesture,
    fitAll,
    flushSave,
    followLink,
    items,
    notify,
    resetCamera,
    setCamera,
    setAnnotateMode,
    chooseTool,
    select,
    startAnnotation,
    suppressNextClick,
    zoomStep,
  ]);

  // The grip and the name both move an item. A press that never travels past
  // the drag threshold stays a click, so clicking the name still copies it.
  const onTitlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, item: CanvasItem) => {
      const target = event.target as Element;
      if (event.button !== 0 || gesture.current || target.closest(".canvas-item-action, .canvas-item-tag, input")) return;
      // Stops text selection while dragging; the click still fires.
      event.preventDefault();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const origin = positionsRef.current[item.id] ?? { x: item.x, y: item.y };
      const element = elements.current.get(item.id);
      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId || !element) return;
        let current = gesture.current;
        if (!current) {
          if (Math.hypot(move.clientX - startX, move.clientY - startY) <= DRAG_THRESHOLD) return;
          current = { kind: "move", pointerId, id: item.id, startX, startY, origin, moved: 0 };
          gesture.current = current;
          viewportRef.current?.setAttribute("data-gesture", "move");
        }
        if (current.kind !== "move" || current.pointerId !== pointerId) return;
        const z = camera.current.z;
        current.moved = Math.abs(move.clientX - startX) + Math.abs(move.clientY - startY);
        const next = sanitizePosition({ x: origin.x + (move.clientX - startX) / z, y: origin.y + (move.clientY - startY) / z });
        element.style.transform = `translate(${next.x}px, ${next.y}px)`;
      };
      const onEnd = (end: PointerEvent) => {
        if (end.pointerId !== pointerId) return;
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onEnd, true);
        window.removeEventListener("pointercancel", onEnd, true);
        const current = gesture.current;
        if (current?.kind === "move" && current.pointerId === pointerId) endGesture();
      };
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onEnd, true);
      window.addEventListener("pointercancel", onEnd, true);
    },
    [endGesture],
  );

  /** Puts an item back where the registry has it. */
  const undoMove = useCallback(
    (item: CanvasItem) => {
      const next = { ...positionsRef.current, [item.id]: sanitizePosition({ x: item.x, y: item.y }) };
      positionsRef.current = next;
      setPositions(next);
      queueSave();
    },
    [queueSave],
  );

  const onHandleKey = useCallback(
    (item: CanvasItem, dx: number, dy: number) => {
      setPositions((prev) => {
        const current = prev[item.id] ?? { x: item.x, y: item.y };
        const next = { ...prev, [item.id]: sanitizePosition({ x: current.x + dx, y: current.y + dy }) };
        positionsRef.current = next;
        return next;
      });
      queueSave();
    },
    [queueSave],
  );

  // A shared file only shows notes and sections; while a Note or Section tool is armed the canvas takes every press.
  const boardInteractive = !shared && !boardTool;

  return (
    <div className="canvas-root">
      <div
        ref={viewportRef}
        className="canvas-viewport"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the canvas takes keyboard camera controls.
        tabIndex={0}
        role="region"
        aria-roledescription="canvas"
        aria-label={labels.region}
        aria-describedby="canvas-help"
      >
        <div ref={worldRef} className="canvas-world">
          {/* Sections first, so items draw above their frame; notes and ghosts last, above everything. */}
          {sections.map((section) => (
            <SectionView
              key={section.id}
              section={section}
              hidden={removed.has(`section:${section.id}`) || marks.some((m) => m.kind === "section" && m.target === section.id)}
              interactive={boardInteractive}
              selected={selected === `e:section:${section.id}`}
              handlers={boardHandlers}
            />
          ))}
          {shown.map((item) => (
            <CanvasItemView
              key={item.id}
              item={item}
              position={resolved(item)}
              front={frontId === item.id}
              register={register}
              onFront={setFrontId}
              onTitlePointerDown={onTitlePointerDown}
              onHandleKey={onHandleKey}
              onResize={!shared && !annotating ? onResizeItem : undefined}
              announce={announce}
              pins={visibleAnnotations.flatMap((annotation) =>
                annotation.itemId === item.id
                  ? [{ annotation, number: annotation.sent || annotation.queued ? undefined : pending.indexOf(annotation) + 1 }]
                  : [],
              )}
              openAnnotation={openAnnotation?.id ?? null}
              annotationHandlers={annotationHandlers}
              onTrash={moveToTrash}
              move={(() => {
                const moved = movedItems.find((m) => m.id === item.id);
                return moved ? moveStateOf(moved) : undefined;
              })()}
              onUndoMove={undoMove}
              caption={captions[item.id] ?? item.note}
              editable={!shared}
              onCaption={saveCaption}
            />
          ))}
          {notes.map((note) => (
            <NoteView
              key={note.id}
              note={note}
              hidden={removed.has(`note:${note.id}`) || marks.some((m) => m.kind === "note" && m.target === note.id)}
              interactive={boardInteractive}
              selected={selected === `e:note:${note.id}`}
              handlers={boardHandlers}
            />
          ))}
          {marks.map((mark) => (
            <MarkView
              key={mark.id}
              mark={mark}
              open={openMark === mark.id}
              folded={foldedMarks.has(mark.id)}
              interactive={boardInteractive}
              selected={selected === `g:${mark.kind}:${mark.id}`}
              handlers={boardHandlers}
              onText={markHandlers.onText}
              onClose={markHandlers.onClose}
              onDelete={markHandlers.onDelete}
            />
          ))}
        </div>
      </div>
      <div ref={pickRef} className="canvas-pick" hidden aria-hidden="true" />
      <div ref={drawRef} className="canvas-draw" hidden aria-hidden="true" />
      {toast && (
        <div className="canvas-toast">
          {toast.kind === "copied" ? (
            <span>{labels.copiedText(toast.text)}</span>
          ) : toast.kind === "notice" ? (
            <>
              <span>{toast.text}</span>
              {toast.action && (
                <button
                  type="button"
                  className="canvas-button"
                  onClick={() => {
                    toast.action?.run();
                    setToast(null);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </>
          ) : (
            <>
              <span className="canvas-subtle">{labels.copyFailed}</span>
              {/* A list of annotations keeps its lines; one reference fits a field. */}
              {toast.text.includes("\n") ? (
                <textarea
                  readOnly
                  rows={4}
                  value={toast.text}
                  aria-label={labels.copyFailed}
                  onFocus={(event) => event.currentTarget.select()}
                  // biome-ignore lint/a11y/noAutofocus: the fallback appears only after a copy attempt.
                  autoFocus
                />
              ) : (
                <input
                  readOnly
                  value={toast.text}
                  aria-label={labels.copyFailed}
                  onFocus={(event) => event.currentTarget.select()}
                  // biome-ignore lint/a11y/noAutofocus: the fallback appears only after a copy attempt.
                  autoFocus
                />
              )}
              <button type="button" className="canvas-button" onClick={() => setToast(null)}>
                {labels.dismiss}
              </button>
            </>
          )}
        </div>
      )}
      {/* Four groups, each where designers expect it: tools at the bottom centre, the view bottom right, the
          file's own controls top right, and the changes waiting for the agent, only when there are any, top
          centre. The tools bar comes first: item reveals measure the first bar for the bottom margin. */}
      {!shared && (
        <div className="canvas-toolbar" data-place="tools" role="toolbar" aria-label={labels.toolsBar}>
          {/* One tool at a time. Select is the default; Escape or V returns to it. */}
          <button
            type="button"
            className="canvas-button canvas-icon-button"
            aria-pressed={!annotating && !boardTool}
            aria-label={labels.selectTool}
            data-tip={labels.selectToolHint}
            onClick={() => chooseTool("select")}
          >
            <SelectIcon />
          </button>
          <button
            type="button"
            className="canvas-button canvas-icon-button"
            aria-pressed={annotating}
            aria-label={labels.annotate}
            data-tip={labels.annotateHint}
            onClick={() => chooseTool("annotate")}
          >
            <AnnotateIcon />
          </button>
          <button
            type="button"
            className="canvas-button canvas-icon-button"
            aria-pressed={boardTool === "note"}
            aria-label={labels.noteTool}
            data-tip={labels.noteToolHint}
            onClick={() => chooseTool("note")}
          >
            <NoteIcon />
          </button>
          <button
            type="button"
            className="canvas-button canvas-icon-button"
            aria-pressed={boardTool === "section"}
            aria-label={labels.sectionTool}
            data-tip={labels.sectionToolHint}
            onClick={() => chooseTool("section")}
          >
            <SectionIcon />
          </button>
        </div>
      )}
      <div className="canvas-toolbar" data-place="view" role="toolbar" aria-label={labels.viewBar}>
        <button
          type="button"
          className="canvas-button canvas-icon-button"
          aria-label={labels.zoomOut}
          data-tip={labels.zoomOut}
          onClick={() => zoomStep(-1)}
        >
          <MinusIcon />
        </button>
        <span ref={zoomLabelRef} className="canvas-zoom" aria-live="off">
          100%
        </span>
        <button
          type="button"
          className="canvas-button canvas-icon-button"
          aria-label={labels.zoomIn}
          data-tip={labels.zoomIn}
          onClick={() => zoomStep(1)}
        >
          <PlusIcon />
        </button>
        <span className="canvas-separator" aria-hidden="true" />
        <button
          type="button"
          className="canvas-button canvas-icon-button"
          aria-label={labels.fitAll}
          data-tip={labels.fitAll}
          onClick={fitAll}
        >
          <FitIcon />
        </button>
        <button
          type="button"
          className="canvas-button canvas-icon-button"
          aria-label={labels.resetCamera}
          data-tip={labels.resetCamera}
          onClick={resetCamera}
        >
          <ResetIcon />
        </button>
      </div>
      {trashedItems.length > 0 && (
        <div className="canvas-toolbar" data-place="trash" role="toolbar" aria-label={labels.trashHeading}>
          <button
            ref={trashButtonRef}
            type="button"
            className="canvas-button canvas-trash-button"
            aria-label={labels.trash(trashedItems.length)}
            aria-expanded={trashOpen}
            aria-controls={trashOpen ? "canvas-trash" : undefined}
            data-tip={labels.trashHeading}
            onClick={() => {
              // The trash opens where notices and the share panel show.
              setToast(null);
              setSharedFile(null);
              setTrashOpen((open) => !open);
            }}
          >
            <TrashIcon />
            {trashedItems.length}
          </button>
        </div>
      )}
      <div className="canvas-toolbar" data-place="top" role="toolbar" aria-label={labels.canvasBar}>
        {theme && theme.options.length > 1 && (
          <>
            <fieldset className="canvas-themes" aria-label={labels.theme}>
              {theme.options.map((option) => {
                const Icon = THEME_ICONS[option.id];
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`canvas-button${Icon ? " canvas-icon-button" : ""}`}
                    aria-pressed={option.id === themeId}
                    aria-label={Icon ? option.label : undefined}
                    data-tip={Icon ? option.label : undefined}
                    onClick={() => theme.set(option.id)}
                  >
                    {Icon ? <Icon /> : option.label}
                  </button>
                );
              })}
            </fieldset>
            <span className="canvas-separator" aria-hidden="true" />
          </>
        )}
        {!shared && (
          <>
            {/* While the file builds, the icon pulses and the button takes no second click. */}
            <button
              ref={shareButtonRef}
              type="button"
              className="canvas-button canvas-icon-button canvas-share-button"
              disabled={sharing}
              aria-busy={sharing}
              aria-label={sharing ? labels.sharing : labels.share}
              data-tip={sharing ? labels.sharing : labels.share}
              onClick={() => void share()}
            >
              <ShareIcon />
            </button>
            <span className="canvas-separator" aria-hidden="true" />
          </>
        )}
        {/* Instructions stay one hover or focus away instead of filling the toolbar. */}
        <span className="canvas-help">
          <button
            type="button"
            className="canvas-button canvas-icon-button"
            aria-label={labels.help}
            aria-describedby="canvas-help"
          >
            <HelpIcon />
          </button>
          <span id="canvas-help" role="tooltip" className="canvas-help-popover">
            {HELP_LINES.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        </span>
      </div>
      {/* Only while something is waiting: the one place to apply or drop every change, so it is hard to miss. */}
      {!shared && (hasChanges || agentHandling) && (
        <div className="canvas-toolbar" data-place="pending" role="group" aria-label={labels.changesBar}>
          {agentHandling && (
            <span className="canvas-agent-status">
              <span className="canvas-agent-dot" aria-hidden="true" />
              {labels.agentWorking}
            </span>
          )}
          {unsentCount === 0 && waitingCount > 0 && <span className="canvas-pending-note">{labels.waitingForAgent(waitingCount)}</span>}
          {hasChanges && (
            <button
              type="button"
              className="canvas-button"
              aria-label={labels.discardChanges}
              data-tip={labels.discardChanges}
              onClick={discardChanges}
            >
              <EraserIcon />
              {labels.discardShort}
            </button>
          )}
          {unsentCount > 0 && (
            <button type="button" className="canvas-button canvas-button-primary" onClick={() => void sendAnnotations()}>
              {agentOn ? <SendIcon /> : <CopyIcon />}
              {agentOn ? labels.sendAnnotations(unsentCount) : labels.copyAnnotations(unsentCount)}
            </button>
          )}
        </div>
      )}
      {sharedFile && <SharePanel file={sharedFile.name} missing={sharedFile.missing} onClose={closeSharePanel} />}
      {trashOpen && (
        <TrashPopover
          items={trashedItems}
          onClose={closeTrash}
          onPutBack={(item) => {
            setTrashOpen(false);
            viewportRef.current?.focus({ preventScroll: true });
            putBack(item);
          }}
        />
      )}
      <span id="canvas-move-help" hidden>
        {labels.moveHelp}
      </span>
      <div ref={liveRef} className="canvas-live" aria-live="polite" />
    </div>
  );
}
