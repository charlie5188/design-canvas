import {
  type ComponentType,
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
import { frameUrl, NAVIGATE_EVENT, postToFrame, readFrameMessage } from "./bridge";
import {
  type Annotation,
  fingerprintItem,
  formatAnnotations,
  limitText,
  loadAnnotations,
  newAnnotationId,
  saveAnnotations,
} from "./annotations";
import {
  CHROME,
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
  type Position,
  sanitizeCamera,
  sanitizePosition,
  saveLayout,
  zoomAt,
} from "./layout";
import { type ThemeStore, useThemeId } from "./theme";
import type { CanvasItem } from "./types";
import "./canvas.css";

const DEFAULT_CAMERA: Camera = { x: 48, y: 120, z: 1 };
const BUTTON_ZOOM = 1.2;
const WHEEL_ZOOM = 0.0025;
const KEY_PAN = 48;
const MOVE_STEP = 8;
const DRAG_THRESHOLD = 3;
const SAVE_DELAY = 400;
const SAVE_MAX_WAIT = 2000;
const TOAST_MS = 2500;
const TOAST_ACTION_MS = 8000;
/** Space a note keeps from the viewport edge before it opens on the other side. */
const FLIP_MARGIN = 16;
const ADD_GAP = 96;
const REVEAL_MARGIN = 48;
const MIN_FIT_SIZE = 100;

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
      src={frameUrl(item.id, "canvas")}
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
const CopyIcon = () => (
  <ToolIcon>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </ToolIcon>
);
const TrashIcon = () => (
  <ToolIcon>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1" />
  </ToolIcon>
);

const SentIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
  </svg>
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
    <div ref={cardRef} className="canvas-annotation-card" role="dialog" aria-label={labels.annotationField(annotation.ref)}>
      <span className="canvas-annotation-ref">{annotation.ref}</span>
      {annotation.sent && <span className="canvas-annotation-sent">{labels.sentNote}</span>}
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
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            handlers.onCancel();
            done();
          }
        }}
      />
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
  /** Its place in the next message; absent once sent. */
  number?: number;
  open: boolean;
  handlers: AnnotationHandlers;
}) {
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const text = annotation.text || labels.annotationPlaceholder;
  return (
    <div className="canvas-pin" style={{ left: annotation.x, top: annotation.y }} data-open={open || undefined}>
      <button
        ref={bubbleRef}
        type="button"
        className="canvas-pin-bubble"
        data-sent={number === undefined || undefined}
        aria-label={number === undefined ? labels.sentPin(text) : labels.annotationPin(number, text)}
        aria-expanded={open}
        onClick={() => (open ? handlers.onSave() : handlers.onOpen(annotation.id))}
      >
        {number ?? <SentIcon />}
      </button>
      {open && <AnnotationCard annotation={annotation} handlers={handlers} done={() => bubbleRef.current?.focus({ preventScroll: true })} />}
    </div>
  );
}

function CanvasItemView({
  item,
  position,
  front,
  register,
  onFront,
  onTitlePointerDown,
  onHandleKey,
  announce,
  pins,
  openAnnotation,
  annotationHandlers,
}: {
  item: CanvasItem;
  position: Position;
  /** The item last touched or focused sits above overlapping items. */
  front: boolean;
  register: (id: string, element: HTMLDivElement | null) => void;
  onFront: (id: string) => void;
  onTitlePointerDown: (event: ReactPointerEvent<HTMLElement>, item: CanvasItem) => void;
  onHandleKey: (item: CanvasItem, dx: number, dy: number) => void;
  announce: (text: string) => void;
  /** This item's annotations with their list numbers. */
  pins: { annotation: Annotation; number?: number }[];
  openAnnotation: string | null;
  annotationHandlers: AnnotationHandlers;
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
            {/* A new tab keeps the canvas, its camera, and preview state intact. */}
            <a
              className="canvas-open"
              href={frameUrl(item.id)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={labels.openAlone(item.name)}
              data-tip={labels.openAloneHint}
            >
              <OpenIcon />
            </a>
          </NameButton>
        </span>
        {item.note && <p className="canvas-note canvas-subtle">{item.note}</p>}
      </div>
      <div className="canvas-preview-wrap">
        <div
          className="canvas-preview"
          data-canvas-preview={item.id}
          style={{ inlineSize: item.width, blockSize: item.height }}
        >
          {item.viewport ? <ItemFrame item={item} /> : <Preview component={item.component} />}
        </div>
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

type Toast = { kind: "copied" | "failed" | "notice"; text: string; action?: { label: string; run: () => void } };
/** The open annotation, and how it was before opening, for Escape. */
type OpenAnnotation = { id: string; original: Annotation };
/** The part of Vite's `import.meta.hot` the canvas uses; absent outside the dev server. */
type HotUpdates = { on(event: string, listener: () => void): void; off?(event: string, listener: () => void): void };

export function Canvas({
  items,
  storageKey,
  theme,
}: {
  items: CanvasItem[];
  storageKey: string;
  /** The project's themes. Leave out when the project has a single theme. */
  theme?: ThemeStore;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef<HTMLDivElement>(null);
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
      if (worldRef.current) {
        worldRef.current.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
        // Annotation pins counter-scale with this, so they keep one size on screen.
        worldRef.current.style.setProperty("--canvas-unzoom", String(1 / z));
      }
      // The outline is drawn in screen space; after the camera moves it would
      // point at the wrong place, so it waits for the next pointer move.
      if (pickRef.current) pickRef.current.hidden = true;
      if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(z * 100)}%`;
    });
  }, []);

  const saveTimer = useRef(0);
  const firstQueued = useRef(0);
  const flushSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = 0;
    firstQueued.current = 0;
    saveLayout(storageKey, camera.current, positionsRef.current, theme?.get());
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
    (text: string, action?: Toast["action"]) => {
      window.clearTimeout(toastTimer.current);
      setToast({ kind: "notice", text, action });
      announce(text);
      // A notice with an action stays long enough to reach the button.
      toastTimer.current = window.setTimeout(() => setToast(null), action ? TOAST_ACTION_MS : TOAST_MS);
    },
    [announce],
  );
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // Annotations. Annotate mode turns clicks in previews into numbered pins. The
  // toolbar copies the unsent ones as one message and marks them sent; a sent
  // one leaves once its item renders differently after a code update. The open
  // annotation's text is live state, so switching elements never loses typing.
  const [annotations, setAnnotations] = useState<Annotation[]>(() => loadAnnotations(storageKey, ids));
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const [openAnnotation, setOpenAnnotation] = useState<OpenAnnotation | null>(null);
  const openRef = useRef(openAnnotation);
  const [annotating, setAnnotating] = useState(false);
  const annotatingRef = useRef(false);
  useEffect(() => saveAnnotations(storageKey, annotations), [annotations, storageKey]);
  const visibleAnnotations = useMemo(() => annotations.filter((a) => ids.has(a.itemId)), [annotations, ids]);
  // Pins number the next message: unsent annotations in order. Sent ones show a check.
  const pending = visibleAnnotations.filter((a) => !a.sent);
  const unsentCount = pending.filter((a) => a.text.trim()).length;

  /** What an item renders now, tagged with the theme so a theme switch never reads as an update. */
  const printOf = useCallback(
    (itemId: string) => {
      const preview = worldRef.current?.querySelector(`[data-canvas-preview="${CSS.escape(itemId)}"]`) ?? null;
      const print = fingerprintItem(preview);
      return print && `${theme?.get() ?? ""}|${print}`;
    },
    [theme],
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
      open.original.text
        ? prev.map((a) => (a.id === open.id ? open.original : a))
        : prev.filter((a) => a.id !== open.id),
    );
  }, [setOpen]);
  const openExisting = useCallback(
    (id: string) => {
      closeAnnotation();
      const annotation = annotationsRef.current.find((a) => a.id === id);
      if (!annotation) return;
      setOpen({ id, original: annotation });
      setFrontId(annotation.itemId);
    },
    [closeAnnotation, setOpen],
  );
  const startAnnotation = useCallback(
    (itemId: string, x: number, y: number, ref: string) => {
      closeAnnotation();
      const annotation: Annotation = { id: newAnnotationId(), itemId, x: Math.round(x), y: Math.round(y), ref, text: "" };
      setAnnotations((prev) => [...prev, annotation]);
      setOpen({ id: annotation.id, original: annotation });
      setFrontId(itemId);
    },
    [closeAnnotation, setOpen],
  );
  const annotationHandlers = useMemo<AnnotationHandlers>(
    () => ({
      onOpen: openExisting,
      // Editing a sent annotation makes it a new request, so it goes out again.
      onText: (id, text) =>
        setAnnotations((prev) =>
          prev.map((a) => (a.id === id ? { id: a.id, itemId: a.itemId, x: a.x, y: a.y, ref: a.ref, text: limitText(text) } : a)),
        ),
      onSave: closeAnnotation,
      onCancel: cancelAnnotation,
      onDelete: (id) => {
        if (openRef.current?.id === id) setOpen(null);
        setAnnotations((prev) => prev.filter((a) => a.id !== id));
      },
    }),
    [cancelAnnotation, closeAnnotation, openExisting, setOpen],
  );
  const setAnnotateMode = useCallback(
    (on: boolean) => {
      annotatingRef.current = on;
      setAnnotating(on);
      if (!on) closeAnnotation();
      announce(on ? labels.annotateModeOn : labels.annotateModeOff);
    },
    [announce, closeAnnotation],
  );
  const clearAnnotations = useCallback(() => {
    const before = annotationsRef.current.filter((a) => a.text.trim());
    setOpen(null);
    setAnnotations([]);
    notify(labels.clearedAnnotations(before.filter((a) => ids.has(a.itemId)).length), {
      label: labels.undo,
      run: () => setAnnotations((now) => [...before, ...now.filter((a) => !before.some((old) => old.id === a.id))]),
    });
  }, [ids, notify, setOpen]);
  const copyAnnotations = useCallback(async () => {
    closeAnnotation();
    const list = annotationsRef.current.filter((a) => ids.has(a.itemId) && !a.sent && a.text.trim());
    if (!list.length) return;
    const text = formatAnnotations(list);
    window.clearTimeout(toastTimer.current);
    try {
      await writeClipboard(text);
    } catch {
      // Not sent: the person copies from the fallback field, and the pins stay new.
      setToast({ kind: "failed", text });
      return;
    }
    const sentIds = new Set(list.map((a) => a.id));
    // "?" when the item is not rendered yet (a loading frame); the first check sets it.
    setAnnotations((prev) => prev.map((a) => (sentIds.has(a.id) ? { ...a, sent: printOf(a.itemId) ?? "?" } : a)));
    notify(labels.copiedAnnotations(list.length));
  }, [closeAnnotation, ids, notify, printOf]);

  /**
   * Removes sent annotations whose item now renders differently. Items that are
   * not rendered yet, or were sent under another theme, are only re-read.
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
    notify(labels.clearedSent(gone.length), {
      label: labels.undo,
      // Back as sent against how the items look now, so they stay until the next change.
      run: () =>
        setAnnotations((current) => [
          ...current,
          ...gone.filter((a) => !current.some((c) => c.id === a.id)).map((a) => ({ ...a, sent: printOf(a.itemId) ?? "?" })),
        ]),
    });
  }, [ids, notify, printOf, setOpen]);
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
    const bounds = boundsOf(items);
    if (viewport && bounds) setCamera(fitBounds(bounds, viewport.clientWidth, viewport.clientHeight));
  }, [boundsOf, items, setCamera]);

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
      const visible =
        bounds.minX * z + x >= m &&
        bounds.minY * z + y >= m &&
        bounds.maxX * z + x <= w - m &&
        bounds.maxY * z + y <= h - m;
      if (visible) return;
      // Zoom out only as far as the targets need; never zoom in.
      const next = clampZoom(
        Math.min(z, (w - m * 2) / Math.max(1, bounds.maxX - bounds.minX), (h - m * 2) / Math.max(1, bounds.maxY - bounds.minY)),
      );
      setCamera({
        x: w / 2 - ((bounds.minX + bounds.maxX) / 2) * next,
        y: h / 2 - ((bounds.minY + bounds.maxY) / 2) * next,
        z: next,
      });
    },
    [boundsOf, setCamera],
  );

  /**
   * Gives each new item a saved position: its source position when that is
   * free, otherwise just right of the items beside it. Existing items never move.
   */
  const placeAdded = useCallback(
    (added: CanvasItem[]) => {
      const addedIds = new Set(added.map((item) => item.id));
      const taken = items.filter((item) => !addedIds.has(item.id)).flatMap((item) => rectOf(item) ?? []);
      const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      const placed: Record<string, Position> = {};
      for (const item of added) {
        const r = rectOf(item);
        if (!r) continue;
        let next = { x: r.x, y: r.y };
        if (taken.some((other) => overlaps(r, other))) {
          const row = taken.filter((other) => other.y < r.y + r.h && r.y < other.y + other.h);
          const right = Math.max(...(row.length ? row : taken).map((other) => other.x + other.w));
          next = sanitizePosition({ x: right + ADD_GAP, y: r.y });
        }
        placed[item.id] = next;
        taken.push({ ...r, ...next });
      }
      positionsRef.current = { ...positionsRef.current, ...placed };
      setPositions(positionsRef.current);
      queueSave();
    },
    [items, queueSave, rectOf],
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
          placeAdded(added);
          reveal(added);
        }),
      ),
    );
  }, [items, placeAdded, reveal]);

  /** Canvas-item links (`#<id>`) reveal their item; anything else stays on the canvas. */
  const followLink = useCallback(
    (href: string) => {
      if (href.startsWith("#")) {
        const target = items.find((item) => item.id === decodeURIComponent(href.slice(1)));
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
    [items, notify, reveal],
  );

  const resetCamera = useCallback(() => setCamera(DEFAULT_CAMERA), [setCamera]);

  const zoomBy = useCallback(
    (factor: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      setCamera(zoomAt(camera.current, factor, viewport.clientWidth / 2, viewport.clientHeight / 2));
    },
    [setCamera],
  );

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
      fitAll();
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
  }, [fitAll, render, saved.camera]);

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
    | { kind: "pan"; pointerId: number; lastX: number; lastY: number; moved: number }
    | { kind: "move"; pointerId: number; id: string; startX: number; startY: number; origin: Position; moved: number }
    | { kind: "pinch"; startMid: Position; startDistance: number; startCamera: Camera }
    | null
  >(null);
  const spaceArmed = useRef(false);
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

    const startPan = (event: PointerEvent) => {
      gesture.current = { kind: "pan", pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, moved: 0 };
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

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.current.size === 2) {
          // Two fingers always belong to the canvas, even over a preview.
          if (gesture.current?.kind === "move") endGesture();
          startPinch();
        } else if (touches.current.size === 1 && isSurface(event.target)) startPan(event);
        return;
      }
      const middle = event.button === 1;
      const spacePan = event.button === 0 && spaceArmed.current;
      const surface = event.button === 0 && !event.altKey && isSurface(event.target);
      if (!middle && !spacePan && !surface) return;
      event.preventDefault();
      if (middle || spacePan) event.stopPropagation();
      if (surface) viewport.focus({ preventScroll: true });
      startPan(event);
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
      if (event.pointerType === "touch") {
        touches.current.delete(event.pointerId);
        if (gesture.current?.kind === "pinch" && touches.current.size < 2) endGesture();
      }
      const current = gesture.current;
      if (current && "pointerId" in current && current.pointerId === event.pointerId) endGesture();
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
    const showPick = (target: EventTarget | null) => {
      const box = pickRef.current;
      const pick = pickTarget(target);
      if (!box || !pick) return hidePick();
      const rect = pick.element.getBoundingClientRect();
      Object.assign(box.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      box.hidden = false;
    };
    const onPickMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      if ((event.altKey || annotatingRef.current) && !gesture.current) showPick(event.target);
      else hidePick();
    };
    // In annotate mode previews stop reacting to presses, except the ones that
    // pan (Space held, middle button).
    const blockPick = (event: MouseEvent) => {
      const annotatePress = annotatingRef.current && event.button === 0 && !spaceArmed.current;
      if ((!event.altKey && !annotatePress) || !pickTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onPickClick = (event: MouseEvent) => {
      if ((!event.altKey && !annotatingRef.current) || clickSuppressed.current) return;
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
      if (event.key === "Alt" && pointer.x >= 0) showPick(document.elementFromPoint(pointer.x, pointer.y));
      // A toggles annotate mode, Escape leaves it, as long as nothing editable has focus.
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
      // Previews keep their own keys; the canvas, its toolbar, and pins take these.
      const canvasFocus =
        event.target === viewport ||
        event.target === document.body ||
        (event.target instanceof Element && event.target.closest(".canvas-toolbar, .canvas-pin-bubble") !== null);
      if (plain && canvasFocus && (event.key === "a" || event.key === "A") && !event.repeat) {
        event.preventDefault();
        setAnnotateMode(!annotatingRef.current);
        if (annotatingRef.current && pointer.x >= 0) showPick(document.elementFromPoint(pointer.x, pointer.y));
        return;
      }
      if (event.key === "Escape" && annotatingRef.current && !openRef.current && canvasFocus) {
        setAnnotateMode(false);
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
      if (event.target !== viewport || event.metaKey || event.ctrlKey || event.altKey) return;
      const step = event.shiftKey ? KEY_PAN * 5 : KEY_PAN;
      const pan = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key];
      if (pan) {
        event.preventDefault();
        setCamera({ ...camera.current, x: camera.current.x + pan[0]!, y: camera.current.y + pan[1]! });
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(BUTTON_ZOOM);
      } else if (event.key === "-") {
        event.preventDefault();
        zoomBy(1 / BUTTON_ZOOM);
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
      if (event.key === "Alt" && !annotatingRef.current) hidePick();
    };
    const onBlur = () => {
      clearHeld();
      hidePick();
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
      if (event.origin !== window.location.origin) return;
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
      } else if (message.type === "pick") {
        void copyReference(`${item.name} › ${message.label}`);
      } else if (message.type === "annotate") {
        // A frame fills its preview at item size, so frame pixels are preview units.
        if (annotatingRef.current) startAnnotation(item.id, message.x, message.y, `${item.name} › ${message.label}`);
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
    startAnnotation,
    zoomBy,
  ]);

  // The grip and the name both move an item. A press that never travels past
  // the drag threshold stays a click, so clicking the name still copies it.
  const onTitlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, item: CanvasItem) => {
      const target = event.target as Element;
      if (event.button !== 0 || gesture.current || target.closest(".canvas-open, input")) return;
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
          {items.map((item) => (
            <CanvasItemView
              key={item.id}
              item={item}
              position={resolved(item)}
              front={frontId === item.id}
              register={register}
              onFront={setFrontId}
              onTitlePointerDown={onTitlePointerDown}
              onHandleKey={onHandleKey}
              announce={announce}
              pins={visibleAnnotations.flatMap((annotation) =>
                annotation.itemId === item.id
                  ? [{ annotation, number: annotation.sent ? undefined : pending.indexOf(annotation) + 1 }]
                  : [],
              )}
              openAnnotation={openAnnotation?.id ?? null}
              annotationHandlers={annotationHandlers}
            />
          ))}
        </div>
      </div>
      <div ref={pickRef} className="canvas-pick" hidden aria-hidden="true" />
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
      <div className="canvas-toolbar" role="toolbar" aria-label={labels.toolbar}>
        <button
          type="button"
          className="canvas-button canvas-icon-button"
          aria-label={labels.zoomOut}
          data-tip={labels.zoomOut}
          onClick={() => zoomBy(1 / BUTTON_ZOOM)}
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
          onClick={() => zoomBy(BUTTON_ZOOM)}
        >
          <PlusIcon />
        </button>
        <span className="canvas-separator" aria-hidden="true" />
        <button type="button" className="canvas-button" onClick={fitAll}>
          <FitIcon />
          {labels.fitAll}
        </button>
        <button type="button" className="canvas-button" onClick={resetCamera}>
          <ResetIcon />
          {labels.resetCamera}
        </button>
        <span className="canvas-separator" aria-hidden="true" />
        <button
          type="button"
          className="canvas-button"
          aria-pressed={annotating}
          data-tip={labels.annotateHint}
          onClick={() => setAnnotateMode(!annotatingRef.current)}
        >
          <AnnotateIcon />
          {labels.annotate}
        </button>
        {unsentCount > 0 && (
          <button type="button" className="canvas-button canvas-button-primary" onClick={() => void copyAnnotations()}>
            <CopyIcon />
            {labels.copyAnnotations(unsentCount)}
          </button>
        )}
        {visibleAnnotations.some((a) => a.text.trim()) && (
          <>
            <button
              type="button"
              className="canvas-button canvas-icon-button"
              aria-label={labels.clearAnnotations}
              data-tip={labels.clearAnnotations}
              onClick={clearAnnotations}
            >
              <TrashIcon />
            </button>
          </>
        )}
        <span className="canvas-separator" aria-hidden="true" />
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
            {labels.helpLines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        </span>
      </div>
      <span id="canvas-move-help" hidden>
        {labels.moveHelp}
      </span>
      <div ref={liveRef} className="canvas-live" aria-live="polite" />
    </div>
  );
}
