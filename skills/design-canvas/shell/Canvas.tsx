import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { sendToAgent, useAgentReplies, useAgentStatus } from "./agent";
import {
  type BoardEdge,
  type BoardHandlers,
  type BoardRef,
  MarkView,
  NoteView,
  SectionView,
} from "./Board";
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
} from "./marks";
import {
  frameParams,
  fromThisCanvas,
  BACK_EVENT,
  NAVIGATE_EVENT,
  PLAN_EVENT,
  postToFrame,
  readFrameMessage,
  shared,
  sharedStorageKey,
} from "./bridge";
import { FrameHost } from "./FrameHost";
import { useFresh } from "./fresh";
import { CanvasMenu } from "./Help";
import { ZoomMenu } from "./Zoom";
import { type AnnotationHandlers, AnnotationPin, SendContext } from "./AnnotationView";
import {
  type Annotation,
  fingerprintItem,
  formatAnnotations,
  limitText,
  loadAnnotations,
  newAnnotationId,
  placeOf,
  saveAnnotations,
  sectionKey,
  sectionOf,
  threadOf,
  withFollowUp,
} from "./annotations";
import {
  CHROME,
  clearPending,
  describeArea,
  describeElement,
  editText,
  isEditable,
  nestedCanScroll,
  pendingOf,
  pickElement,
  previewLink,
  showPending,
  type TextEdit,
  textTarget,
  TYPING,
  wheelPixels,
} from "./dom";
import { AnnotateIcon, CopyIcon, EraserIcon, HandIcon, InspectIcon, MoonIcon, NoteIcon, SectionIcon, SelectIcon, SendIcon, SunIcon } from "./icons";
import { CanvasItemView, type ResizeEdge } from "./Item";
import { InspectPanel } from "./Inspect";
import { type InspectRecord, useInspect } from "./inspect-edit";
import { type DesignSystem, selectable, showProp, showStyle } from "./inspect-read";
import { type FlowStep, FlowView } from "./FlowView";
import { opensNewTab, screenIndex, screensOf } from "./routes";
import { labels } from "./labels";
import { useLinks } from "./links";
import { pickedPaths, versionSpot } from "./lineage";
import { LineagePaths } from "./LineagePaths";
import { comparedWith, planAside } from "./pick";
import { usePinAnchors } from "./pin-anchors";
import {
  type Bounds,
  type Camera,
  clampZoom,
  fitBounds,
  ITEM_HEAD,
  loadLayout,
  nextZoomStop,
  ZOOM_MAX,
  type Position,
  sanitizeCamera,
  sanitizePosition,
  saveLayout,
  zoomAt,
} from "./layout";
import { ToastView, useNotices, useOpeningChecks, writeClipboard } from "./Notices";
import { type Background, loadBackground, saveBackground } from "./Settings";
import { ShareButton, SharePanel, useShare } from "./Share";
import { type ThemeStore, useThemeId } from "./theme";
import { TrashButton, TrashDialog, useTrash, useTrashList } from "./Trash";
import { type Box, type Guide, SNAP_DISTANCE, type Snap, snapBox } from "./snap";
import { type CanvasImage, type CanvasItem, type CanvasNote, type CanvasSection, isSetAside } from "./types";
import { refreshImages, useCanvasImages } from "./images";
import { DEFAULT_CAMERA, useCamera } from "./camera";
import { EDIT_PATH, IMAGE_PATH, MAX_IMAGE_BYTES } from "./channel.ts";
import type { DirectAdd, DirectEdit, DirectRemove } from "./registry-edit.ts";
import "./canvas.css";

const WHEEL_ZOOM = 0.0025;
const KEY_PAN = 48;
const DRAG_THRESHOLD = 3;
const ADD_GAP = 96;
/** Canvas units above a section's frame that its title tab takes, kept clear when a new version is placed. */
const SECTION_TAB = 40;
const REVEAL_MARGIN = 48;
/** The notice row that opens under the top bars, at the top centre. */
const TOAST_ROW = 48;
const MIN_FIT_SIZE = 100;
/** Room the top bars take (16 px from the edge, a 42 px bar, a little air), so a revealed or fitted item never sits under them. */
const CHROME_TOP = 74;
const FIT_PADDING = 72;
/** Two presses this close, without moving, are a double-click. */
const DOUBLE_TAP_MS = 400;
/** Room a section's title takes above its frame, in canvas units. */
const SECTION_TITLE_ROOM = 32;

/** How much of each note a section note's reference quotes. */
const MAX_NOTE_QUOTE = 120;

/**
 * How far an item's name and caption rise above its position, in canvas units. A caption
 * grows upward so that previews side by side line up (canvas.css, `.canvas-item-head`),
 * and that part lies outside the item element's own box.
 */
const liftOf = (element: HTMLElement) => Math.max(0, -(element.querySelector<HTMLElement>(".canvas-item-title")?.offsetTop ?? 0));

/** An item's box on screen, with the name and caption above it. */
const itemScreenRect = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect();
  const top = Math.min(rect.top, element.querySelector(".canvas-item-title")?.getBoundingClientRect().top ?? rect.top);
  return new DOMRect(rect.left, top, rect.width, rect.bottom - top);
};

/** Rows top to bottom, each left to right: a box joins a row when it starts above the middle of the row's first box. */
function readingOrder<T extends { x: number; y: number; h: number }>(boxes: T[]) {
  const rows: T[][] = [];
  for (const box of [...boxes].sort((a, b) => a.y - b.y)) {
    const row = rows[rows.length - 1];
    if (row && box.y < row[0]!.y + row[0]!.h / 2) row.push(box);
    else rows.push([box]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}
/** The smallest section a drag makes; anything smaller reads as a stray click. */
const SECTION_MIN_W = 80;
const SECTION_MIN_H = 60;
/**
 * A note inside a section that is being moved. `ghost` says `id` is a mark (a
 * new note, or a change already made to a registry note); otherwise `id` is the
 * registry note, which gets a mark once it actually moves.
 */
type CarriedNote = { id: string; ghost: boolean; x: number; y: number };
/** Where an image is and how large, in canvas units. */
type ImageBox = { x: number; y: number; w: number; h: number };
const IMAGE_CORNERS = ["nw", "ne", "sw", "se"] as const;
/** The longest side a new image is shown at; the person resizes it from there. */
const IMAGE_SHOWN = 640;
/** A picture larger than this on its longest side, in its own pixels, is made smaller before it is kept. */
const IMAGE_SIDE = 2400;
const IMAGE_MIN = 40;
/** How much of the picture a stored WebP or JPEG keeps: text in a screenshot stays sharp at this. */
const IMAGE_QUALITY = 0.9;

/**
 * A pasted or dropped picture as the data URL the dev server stores, with its size in its
 * own pixels. Every picture is stored again as WebP, drawn smaller when it is very large:
 * a screenshot is several times smaller that way, and the canvas folder and the shared
 * file, which holds every image inside it, stay light. Two exceptions:
 *
 * - A GIF goes as it is. It may move, and a browser can only write one frame of a
 *   picture, so storing it again would stop it.
 * - The file as it came is kept when storing it again would not make it smaller.
 *
 * A browser that cannot write WebP (Safari) writes a JPEG, which is also lossy, or a PNG
 * when the picture has see-through parts, which a JPEG would fill in.
 * Throws when the browser cannot read the picture.
 */
async function prepareImage(file: Blob): Promise<{ data: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  try {
    const asIs = () =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
    const fits = Math.max(width, height) <= IMAGE_SIDE && file.size <= MAX_IMAGE_BYTES;
    if (file.type === "image/gif" && fits) return { data: await asIs(), width, height };
    for (let side = IMAGE_SIDE; side >= 300; side = Math.round(side / 2)) {
      const scale = Math.min(1, side / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) break;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let data = canvas.toDataURL("image/webp", IMAGE_QUALITY);
      // A browser that cannot write WebP answers with a PNG.
      if (!data.startsWith("data:image/webp")) {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let opaque = true;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i]! < 255) {
            opaque = false;
            break;
          }
        }
        if (opaque) data = canvas.toDataURL("image/jpeg", IMAGE_QUALITY);
      }
      if (data.length > MAX_IMAGE_BYTES * 1.3) continue;
      // Base64 is a third longer than the bytes it carries.
      const smaller = data.length * 0.75 < file.size;
      const kept = scale === 1 && fits && !smaller && ["image/png", "image/jpeg", "image/webp"].includes(file.type);
      return kept ? { data: await asIs(), width, height } : { data, width: canvas.width, height: canvas.height };
    }
    throw new Error("too large");
  } finally {
    bitmap.close();
  }
}
/** One saved change and what undoes it. `positions` are items' places in the browser, which go back with their registry values. */
type SavedChange = { edits: DirectEdit[]; removes: DirectRemove[]; adds: DirectAdd[]; positions: Record<string, { x: number; y: number }> };
const HISTORY_LIMIT = 30;
/** A text field, where Delete, Backspace, and ⌘/Ctrl + Z belong to the text. Buttons and the canvas itself are not. */
const typingIn = (element: Element) => element.closest(TYPING) !== null;
/** The marks that are a change of their own: a note folded into its section's change is counted with that section. */
const standalone = (list: BoardMark[], all: BoardMark[]) => {
  const folded = foldedNotes(all);
  return list.filter((m) => !folded.has(m.id));
};

/** Light and dark get icons; other themes show their label. */
const THEME_ICONS: Partial<Record<string, () => ReactNode>> = { light: SunIcon, dark: MoonIcon };

const NO_STEPS: FlowStep[] = [];

/**
 * The open annotation, and how it and its item's other annotations were before
 * opening, for Escape: the "new version" choice is shared across the item.
 */
type OpenAnnotation = { id: string; original: Annotation; versions: Map<string, boolean | undefined> };
/** The part of Vite's `import.meta.hot` the canvas uses; absent outside the dev server. */
type HotUpdates = { on(event: string, listener: () => void): void; off?(event: string, listener: () => void): void };

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
  /** The project's design system, for the Inspect tool. Leave out to have no Inspect tool. */
  designSystem?: DesignSystem;
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

/**
 * The board: everything on the canvas page and what the person does with it.
 *
 * A part with a clear edge has its own file and is only wired in here: the trash (Trash.tsx),
 * Share (Share.tsx), notices (Notices.tsx), fresh tags (fresh.ts), the Inspect tool
 * (inspect-edit.ts), the working-out of a pick (pick.ts), the camera (camera.ts), pin anchors
 * (pin-anchors.ts), links (links.ts), and the steps Start here reports (start.ts, used by
 * Item.tsx). The views are Item.tsx, AnnotationView.tsx, Board.tsx,
 * FlowView.tsx, Help.tsx, and Settings.tsx.
 *
 * What stays here is one piece, and is kept together on purpose: annotations, notes and
 * sections (marks), moves and resizes, what is saved straight to the registry and its undo,
 * sending to the agent, and the pointer and key handling. Each of them reads and changes the
 * others' state, and the order of their effects and listeners matters, so moving one out would
 * mean passing most of the board to it. Splitting it further needs a new design for that
 * state, not a move.
 */
function CanvasBoard({
  items: itemsProp,
  notes: notesProp = NO_NOTES,
  sections: sectionsProp = NO_SECTIONS,
  storageKey,
  theme,
  designSystem,
}: CanvasProps) {
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
  const [background, setBackgroundState] = useState<Background>(() => loadBackground(storageKey));
  const setBackground = (value: Background) => {
    setBackgroundState(value);
    saveBackground(storageKey, value);
  };
  const [positions, setPositions] = useState<Record<string, Position>>(() =>
    Object.fromEntries(items.map((item) => [item.id, saved.positions[item.id] ?? { x: item.x, y: item.y }])),
  );
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  // New registry entries appear at their source position until placed.
  const resolved = (item: CanvasItem) => positions[item.id] ?? { x: item.x, y: item.y };
  // The trash (Trash.tsx): the items it holds are not on the canvas. Only the list is here,
  // since the rest of the board is built on which items are shown; moving items in and out is `useTrash`, below.
  const trashList = useTrashList(items, saved.trash, !!saved.camera);
  const { ids: trash, idsRef: trashRef, kept: trashKept, times: trashTimes } = trashList;
  const shown = useMemo(() => items.filter((item) => !trash.includes(item.id)), [items, trash]);
  const shownIds = useMemo(() => new Set(shown.map((item) => item.id)), [shown]);
  // What an annotation can be on: a shown item, or a section (sectionKey).
  const targetIds = useMemo(() => new Set([...shownIds, ...sections.map((s) => sectionKey(s.id))]), [shownIds, sections]);
  /** The order sections are drawn in: larger first, so one inside another is never hidden behind it. */
  const sectionsByArea = useMemo(() => [...sections].sort((a, b) => b.width * b.height - a.width * a.height), [sections]);
  const { toast, setToast, toastTimer, liveRef, announce, copyReference, notify } = useNotices();
  const [frontId, setFrontId] = useState<string | null>(null);
  // The item last touched: where a router call came from, since the call itself does not say.
  const frontIdRef = useRef(frontId);
  frontIdRef.current = frontId;
  // The flow view (FlowView.tsx): the item it shows.
  const [flowId, setFlowId] = useState<string | null>(null);
  const openFlow = useCallback((item: CanvasItem) => setFlowId(item.id), []);
  const closeFlow = useCallback(() => setFlowId(null), []);
  // Items the saved layout already knows. Anything else is new and gets
  // placed in free space and revealed once it has a measured size.
  const known = useRef<Set<string> | null>(null);
  if (!known.current) {
    known.current = new Set(saved.camera ? Object.keys(saved.positions) : items.map((item) => item.id));
  }
  // Set for one tick after a pan or move, so the click it ends on stays silent.
  const clickSuppressed = useRef(false);

  // The camera (camera.ts). It decides when the layout is written; what is in it is here.
  const writeLayout = useCallback(
    (now: Camera) =>
      saveLayout(storageKey, now, positionsRef.current, theme?.get(), {
        ids: trashRef.current,
        kept: [...trashKept.current],
        inRegistry: !shared,
        at: trashTimes.current,
      }),
    [storageKey, theme],
  );
  const { camera, frame, saveTimer, render, glide, flushSave, queueSave, setCamera, flyTo } = useCamera({
    initial: saved.camera,
    worldRef,
    pickRef,
    zoomLabelRef,
    viewportRef,
    writeLayout,
  });

  useOpeningChecks(items, notify);
  // Share (Share.tsx): what goes in the file, and the download.
  const {
    sharing,
    open: shareOpen,
    setOpen: setShareOpen,
    buttonRef: shareButtonRef,
    scopes: shareScopes,
    contents: shareContents,
    share,
    close: closeSharePanel,
  } = useShare({ items, notes, sections, positions, trash, notify });

  // Annotations. Annotate mode turns clicks in previews into numbered pins. The
  // toolbar sends the unsent ones to a listening agent, or copies them, as one
  // message and marks them sent; a sent one leaves once its item renders
  // differently after a code update. The open annotation's text is live state,
  // so switching elements never loses typing.
  // A shared file has no annotation tools, so it neither shows nor stores any.
  const [annotations, setAnnotations] = useState<Annotation[]>(() =>
    shared ? [] : loadAnnotations(storageKey, new Set([...ids, ...sections.map((s) => sectionKey(s.id))])),
  );
  const annotationsRef = useRef(annotations);
  const inspectRecords = useRef(new Map<string, InspectRecord>());
  // Notes discarded or deleted: an Undo that brings one back shows its changes again.
  const inspectGone = useRef(new Map<string, InspectRecord>());
  annotationsRef.current = annotations;
  const [openAnnotation, setOpenAnnotation] = useState<OpenAnnotation | null>(null);
  const openRef = useRef(openAnnotation);
  const [annotating, setAnnotating] = useState(false);
  const annotatingRef = useRef(false);
  /** A text being edited in place in a preview on this page (a double-click in annotate mode). */
  const textEditRef = useRef<TextEdit | null>(null);
  useEffect(() => {
    if (!shared) saveAnnotations(storageKey, annotations);
  }, [annotations, storageKey]);
  // Annotations on trashed items wait, unseen and unsent, until it is put back.
  const visibleAnnotations = useMemo(() => annotations.filter((a) => targetIds.has(a.itemId)), [annotations, targetIds]);
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
  // The annotations in the message the agent is handling. Their items and
  // sections pulse until the change arrives or the agent finishes, so a person
  // doing something else meanwhile knows those are about to change. Nothing is
  // locked: the agent edits source, and the canvas only saves positions and sizes.
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!agentHandling) setInFlight(new Set());
  }, [agentHandling]);
  const working = useMemo(() => {
    if (!agentHandling) return new Set<string>();
    // After a reload mid-work the message is not known: every sent note counts.
    const mine = annotations.filter((a) => a.sent && (inFlight.size ? inFlight.has(a.id) : true));
    return new Set(mine.map((a) => a.itemId));
  }, [agentHandling, annotations, inFlight]);

  const [fresh, setFresh] = useFresh(storageKey, ids, viewportRef, elements);

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
  /**
   * What a sent annotation waits on: its item's content, or its item's count of
   * versions. A section's waits on the number of items: its usual answer is a new
   * item made from the ones inside, and the person's own moves never touch that.
   */
  const sentPrint = useCallback(
    (a: Annotation) => (sectionOf(a) !== null ? `s|${items.length}` : a.version ? versionsOf(a.itemId) : printOf(a.itemId)),
    [items.length, printOf, versionsOf],
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
      // Opening a note reads its answer. The read note is also what Escape goes back to, so closing does not make it unread again.
      const opened = annotation.reply !== undefined && !annotation.seen ? { ...annotation, seen: true } : annotation;
      if (opened !== annotation) setAnnotations((prev) => prev.map((a) => (a.id === id ? opened : a)));
      setOpen({ id, original: opened, versions: versionsBefore(annotation.itemId) });
      if (sectionOf(annotation) === null) setFrontId(annotation.itemId);
    },
    [closeAnnotation, setOpen, versionsBefore],
  );
  const startAnnotation = useCallback(
    (itemId: string, x: number, y: number, ref: string, area?: { w: number; h: number }, text = "", id = newAnnotationId(), asked?: boolean) => {
      closeAnnotation();
      // The item's choice so far, or a new version by default: exploring keeps what was there.
      // `asked`: the note says itself which it is, as Start here, which changes the item in place.
      const unsent = annotationsRef.current.filter((a) => a.itemId === itemId && !a.sent && !a.queued && a.text.trim());
      const version = asked ?? (unsent.length ? !!unsent[unsent.length - 1]!.version : true);
      const onSection = sectionOf({ itemId }) !== null;
      const annotation: Annotation = {
        id,
        itemId,
        x: Math.round(x),
        y: Math.round(y),
        ...(area ? { w: Math.round(area.w), h: Math.round(area.h) } : {}),
        ref,
        text: limitText(text),
        ...(onSection ? {} : { version }),
      };
      const versions = versionsBefore(itemId);
      setAnnotations((prev) => [...prev, annotation]);
      // A note written for the person (a text edit) is still new: Escape removes it.
      setOpen({ id: annotation.id, original: { ...annotation, text: "" }, versions });
      if (!onSection) setFrontId(itemId);
    },
    [closeAnnotation, setOpen, versionsBefore],
  );
  /**
   * A text edited in place became annotation `id`, or changed it; its new words
   * are already on show (dom.ts showPending). `was`: the words it showed before,
   * for an edit of new words. `after` equal to `before` takes the annotation back.
   */
  const textEdited = useCallback(
    (itemId: string, id: string, x: number, y: number, ref: string, before: string, after: string, was?: string) => {
      const existing = annotationsRef.current.find((a) => a.id === id);
      if (after === before) {
        if (!existing) return;
        if (openRef.current?.id === id) setOpen(null);
        setAnnotations((prev) => prev.filter((a) => a.id !== id));
        return;
      }
      const line = labels.textChange(before, after);
      if (!existing) {
        startAnnotation(itemId, x, y, ref, undefined, line, id);
        return;
      }
      // The sentence it wrote changes and what the person added stays. Changed, it is a new request again.
      const old = was === undefined ? "" : labels.textChange(before, was);
      const text = old && existing.text.includes(old) ? existing.text.replace(old, line) : `${line}\n${existing.text}`;
      const updated: Annotation = { ...placeOf(existing), text: limitText(text), ...(existing.version !== undefined ? { version: existing.version } : {}) };
      closeAnnotation();
      setAnnotations((prev) => prev.map((a) => (a.id === id ? updated : a)));
      // Escape then only closes it: the words on show are the new ones.
      setOpen({ id, original: updated, versions: versionsBefore(existing.itemId) });
    },
    [closeAnnotation, setOpen, startAnnotation, versionsBefore],
  );
  // A section's pin sits just right of its title tab, which stays one size on
  // screen. The tab's size is measured here; CSS turns it into canvas units at
  // the current zoom, so the pin follows the camera without a render.
  useLayoutEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    for (const layer of world.querySelectorAll<HTMLElement>(".canvas-section-pins[data-section]")) {
      const id = layer.dataset.section ?? "";
      const mark = marksRef.current.find((m) => m.kind === "section" && m.target === id);
      const tab = world.querySelector<HTMLElement>(
        mark ? `[data-board-ghost="${CSS.escape(mark.id)}"] .canvas-section-tab` : `[data-board-id="${CSS.escape(id)}"] .canvas-section-tab`,
      );
      if (!tab) continue;
      layer.style.setProperty("--section-tab-w", `${tab.offsetWidth}px`);
      layer.style.setProperty("--section-tab-h", `${tab.offsetHeight}px`);
    }
  });
  // New words on show belong to their annotation. When it goes (deleted,
  // discarded, emptied, or cleared once applied), the text shows its own again.
  const shownBefore = useRef(annotations);
  useEffect(() => {
    const now = new Set(annotations.map((a) => a.id));
    for (const gone of shownBefore.current) {
      if (now.has(gone.id)) continue;
      clearPending(gone.id);
      // A change from the Inspect panel stops showing with its note. A prop shown on a component
      // goes back only if the note was never sent: once the agent applied it, the code has it.
      const record = inspectRecords.current.get(gone.id);
      if (record && designSystem) {
        for (const [property, style] of record.styles) showStyle(record.element, property, style.before, designSystem);
        if (!gone.sent) for (const [name, prop] of record.props) showProp(prop.fiber, name, prop.had ? prop.original : undefined);
        inspectRecords.current.delete(gone.id);
        if (!gone.sent) inspectGone.current.set(gone.id, record);
      }
      const frame = worldRef.current?.querySelector<HTMLIFrameElement>(
        `[data-canvas-preview="${CSS.escape(gone.itemId)}"] iframe[data-canvas-frame]`,
      );
      if (frame?.contentWindow) postToFrame(frame.contentWindow, { type: "text-revert", id: gone.id });
    }
    // Back by Undo: its changes show again, on the element if it is still there.
    for (const back of annotations) {
      const record = inspectGone.current.get(back.id);
      if (!record || !designSystem) continue;
      inspectGone.current.delete(back.id);
      if (!record.element.isConnected) continue;
      for (const [property, style] of record.styles) showStyle(record.element, property, style.value, designSystem);
      for (const [name, prop] of record.props) showProp(prop.fiber, name, prop.value);
      inspectRecords.current.set(back.id, record);
    }
    shownBefore.current = annotations;
  }, [annotations]);
  // Ask agent about a whole item, from the button at its top right: the same note a click on
  // its name makes in Ask agent mode, with no tool to choose first. A note about the item
  // that still waits opens again, so two presses do not make two notes.
  const askItem = useCallback(
    (item: CanvasItem) => {
      const waiting = annotationsRef.current.find((a) => a.itemId === item.id && a.ref === item.name && a.w && !a.sent && !a.queued);
      if (waiting) return openExisting(waiting.id);
      const preview = worldRef.current?.querySelector<HTMLElement>(`[data-canvas-preview="${CSS.escape(item.id)}"]`);
      if (preview) startAnnotation(item.id, 0, 0, item.name, { w: preview.offsetWidth, h: preview.offsetHeight });
    },
    [openExisting, startAnnotation],
  );
  // Start here (start.ts): a note about the whole item, written for the person, which they can
  // change before sending. It changes the item in place, so not as a new version. A Start here
  // note that still waits takes the new words, so pressing it again after going further does
  // not make two.
  const startHere = useCallback(
    (item: CanvasItem, text: string) => {
      const first = labels.startHereNote(undefined, [], 0);
      const waiting = annotationsRef.current.find((a) => a.itemId === item.id && a.w && !a.sent && !a.queued && a.text.startsWith(first));
      if (waiting) {
        setAnnotations((prev) => prev.map((a) => (a.id === waiting.id ? { ...placeOf(a), text: limitText(text), version: false, ...threadOf(a) } : a)));
        return openExisting(waiting.id);
      }
      const preview = worldRef.current?.querySelector<HTMLElement>(`[data-canvas-preview="${CSS.escape(item.id)}"]`);
      if (preview) startAnnotation(item.id, 0, 0, item.name, { w: preview.offsetWidth, h: preview.offsetHeight }, text, undefined, false);
    },
    [openExisting, startAnnotation],
  );
  const annotationHandlers = useMemo<AnnotationHandlers>(
    () => ({
      onOpen: openExisting,
      // Editing a sent or queued annotation makes it a new request, so it goes out again.
      onText: (id, text) =>
        setAnnotations((prev) =>
          prev.map((a) =>
            a.id === id
              ? { ...placeOf(a), text: limitText(text), version: a.version, ...threadOf(a) }
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
              ? { ...placeOf(a), text: a.text, version, ...threadOf(a) }
              : a,
          );
        }),
      onSave: closeAnnotation,
      onCancel: cancelAnnotation,
      onFollowUp: (id, text) => {
        // The ref too: Send may follow in the same press, and it reads the ref.
        annotationsRef.current = annotationsRef.current.map((a) => (a.id === id ? withFollowUp(a, text) : a));
        setAnnotations(annotationsRef.current);
      },
      onSend: () => void sendRef.current(),
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
  /** A section note's reference as it is now (see describeSection). */
  const sectionRefRef = useRef<(id: string) => string | undefined>(() => undefined);
  /** Outlines the sections a dragged box would be in; null clears them (see where it is set). */
  const dropTargetRef = useRef<(box: { x: number; y: number; w: number; h: number } | null) => void>(() => {});
  // The two alignment guides shown while an item is dragged. They are always in
  // the page and only shown, hidden, and placed here: adding or removing a node on
  // every pointer move would restyle the whole page (see `render`).
  const guideVRef = useRef<HTMLDivElement>(null);
  const guideHRef = useRef<HTMLDivElement>(null);
  const guidesRef = useRef((snap: Snap | null) => {
    const place = (element: HTMLDivElement | null, guide: Guide | undefined, vertical: boolean) => {
      if (!element) return;
      if (element.hidden !== !guide) element.hidden = !guide;
      if (!guide) return;
      const length = `${guide.to - guide.from}px`;
      element.style.transform = vertical ? `translate(${guide.at}px, ${guide.from}px)` : `translate(${guide.from}px, ${guide.at}px)`;
      if (vertical) element.style.height = length;
      else element.style.width = length;
    };
    place(guideVRef.current, snap?.vertical, true);
    place(guideHRef.current, snap?.horizontal, false);
  });
  // The size a resize is at, next to the pointer, so a frame can be dragged to an
  // exact breakpoint without guessing. Like the guides, it is always in the page
  // and only placed and filled here, on every pointer move.
  const sizeTipRef = useRef<HTMLDivElement>(null);
  const sizeTip = (e: PointerEvent | null, w = 0, h = 0, edge: BoardEdge = "se") => {
    const element = sizeTipRef.current;
    if (!element) return;
    if (!e) {
      element.hidden = true;
      return;
    }
    // An edge changes one dimension, so only that one is shown; a corner shows both.
    const both = edge.length === 2;
    const vertical = edge === "n" || edge === "s";
    element.textContent = both ? `${w} × ${h}` : vertical ? `H ${h}` : `W ${w}`;
    // Below and to the right of the pointer, clear of the cursor, flipped near the window's edge.
    const offset = 16;
    const box = { w: element.offsetWidth || 80, h: element.offsetHeight || 22 };
    const x = e.clientX + offset + box.w > window.innerWidth ? e.clientX - offset - box.w : e.clientX + offset;
    const y = e.clientY + offset + box.h > window.innerHeight ? e.clientY - offset - box.h : e.clientY + offset;
    element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    element.hidden = false;
  };
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
  // Reference images (images.ts). The registry says where each one is. A move or resize
  // shows from `imageBoxes` at once and is written to the registry once the person pauses,
  // like an item's (flushDirect); its entry here goes once the registry says the same.
  const { images: listedImages, urls: imageUrls } = useCanvasImages();
  const listedImagesRef = useRef(listedImages);
  listedImagesRef.current = listedImages;
  // Asked again whenever the registry changes: its arrays as main.tsx passes them are new
  // objects each time the file is read, also when only an image changed (`items`, `notes`,
  // and `sections` are kept the same object while their content is, so they would not tell).
  useEffect(() => {
    void refreshImages();
  }, [itemsProp, notesProp, sectionsProp]);
  const [imageBoxes, setImageBoxesState] = useState<Record<string, ImageBox>>({});
  const imageBoxesRef = useRef(imageBoxes);
  const setImageBoxes = useCallback((next: Record<string, ImageBox>) => {
    imageBoxesRef.current = next;
    setImageBoxesState(next);
  }, []);
  // The box last sent for each image, so one move is one write.
  const sentImages = useRef<Record<string, string>>({});
  useEffect(() => {
    const kept = Object.entries(imageBoxesRef.current).filter(([id, box]) => {
      const image = listedImages.find((entry) => entry.id === id);
      return image && !(image.x === box.x && image.y === box.y && image.width === box.w && image.height === box.h);
    });
    if (kept.length === Object.keys(imageBoxesRef.current).length) return;
    for (const id of Object.keys(sentImages.current)) if (!kept.some(([keptId]) => keptId === id)) delete sentImages.current[id];
    setImageBoxes(Object.fromEntries(kept));
  }, [listedImages, imageBoxes, setImageBoxes]);
  // Filled in further down, where the images' own handlers are; the selection reads them.
  const imageBoxRef = useRef<(id: string) => ImageBox | undefined>(() => undefined);
  const imagesInsideRef = useRef<(bounds: ImageBox) => { id: string; x: number; y: number }[]>(() => []);
  const shiftImagesRef = useRef<(list: { id: string; x: number; y: number }[], dx: number, dy: number) => void>(() => {});

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
    // A moved or resized image is pending until its box has been sent once.
    const pendingImages = Object.entries(imageBoxesRef.current).flatMap(([id, box]) => {
      const image = listedImagesRef.current.find((entry) => entry.id === id);
      const print = `${box.x},${box.y},${box.w},${box.h}`;
      return image && sentImages.current[id] !== print ? [{ image, box, print }] : [];
    });
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
    for (const { image, box, print } of pendingImages) {
      sentImages.current[image.id] = print;
      edits.push({ kind: "image", id: image.id, set: { x: box.x, y: box.y, width: box.w, height: box.h } });
      inverse.set(image.id, { kind: "image", id: image.id, set: { x: image.x, y: image.y, width: image.width, height: image.height } });
    }
    const adds: DirectAdd[] = pendingNew.map((m) => ({
      kind: m.kind,
      text: m.text,
      x: m.x,
      y: m.y,
      ...(m.w ? { width: m.w } : {}),
      ...(m.h ? { height: m.h } : {}),
    }));
    if (!markIds.size && !pendingNew.length && !pendingMoves.length && !pendingSizes.length && !pendingImages.length) return;
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
  }, [flushTracked, marks, positions, sizes, imageBoxes, dragEnds]);
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
  // Several things selected at once, or an item: a box drawn on empty canvas, a click on an
  // item's name, or Shift + click. They move together and are deleted together. Kept apart
  // from `selected`, which stays the one note or section with its resize grips: either that
  // is set, or this holds keys, never both. A key is "item:<id>", "image:<id>", a note's or
  // section's registry id as "note:<id>" or "section:<id>" (the same before and after its
  // first move makes it a ghost), or "mark:<id>" for one that is not in the registry yet.
  const [multi, setMultiState] = useState<readonly string[]>([]);
  const multiRef = useRef(multi);
  const setMulti = useCallback((keys: readonly string[]) => {
    multiRef.current = keys;
    setMultiState(keys);
  }, []);
  const select = useCallback(
    (ref: BoardRef | null) => {
      const key = ref ? keyOfRef(ref) : null;
      selectedRef.current = key;
      setSelected(key);
      if (multiRef.current.length) setMulti([]);
    },
    [setMulti],
  );
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
        [...prev].filter(
          (key) => notes.some((n) => `note:${n.id}` === key) || sections.some((s) => `section:${s.id}` === key) || listedImages.some((i) => `image:${i.id}` === key),
        ),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [notes, sections, listedImages]);
  const images = useMemo(() => listedImages.filter((image) => !removed.has(`image:${image.id}`)), [listedImages, removed]);
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
  // Several at once: items go to the trash, notes, sections, and images leave the registry, in
  // one write, with one notice whose Undo brings all of it back. A section's contents stay,
  // as when it is deleted alone, unless they were selected too.
  const deleteGroup = async (keys: readonly string[]) => {
    const trashed = keys.flatMap((key) => (key.startsWith("item:") ? (itemsRef.current.find((item) => item.id === key.slice(5)) ?? []) : []));
    const snapshots: DirectAdd[] = [];
    const drafts: string[] = [];
    for (const key of keys) {
      const at = key.indexOf(":");
      const [type, id] = [key.slice(0, at), key.slice(at + 1)];
      const note = type === "note" ? notes.find((n) => n.id === id) : undefined;
      const section = type === "section" ? sections.find((entry) => entry.id === id) : undefined;
      const image = type === "image" ? images.find((entry) => entry.id === id) : undefined;
      if (note) snapshots.push({ kind: "note", id, text: note.text, x: note.x, y: note.y, ...(note.width ? { width: note.width } : {}), ...(note.height ? { height: note.height } : {}) });
      else if (section) snapshots.push({ kind: "section", id, text: section.title, x: section.x, y: section.y, width: section.width, height: section.height });
      else if (image) {
        // As it is drawn now: a move or resize made a moment ago may not have come back from the registry yet.
        const box = imageBoxRef.current(id) ?? { x: image.x, y: image.y, w: image.width, h: image.height };
        snapshots.push({ kind: "image", id, file: image.file, x: box.x, y: box.y, width: box.w, height: box.h });
      }
      else if (type === "mark") drafts.push(id);
    }
    const gone = snapshots.map((entry) => `${entry.kind}:${entry.id}`);
    select(null);
    setRemoved((prev) => new Set([...prev, ...gone]));
    // A change waiting on an entry means nothing once it is gone; a new note or section is just dropped.
    setMarks((prev) => prev.filter((m) => !(m.target ? gone.includes(`${m.kind}:${m.target}`) : drafts.includes(m.id))));
    if (drafts.includes(openMarkRef.current ?? "")) setMarkOpen(null);
    const result = snapshots.length ? await postRegistry({ removes: snapshots.map((entry) => ({ kind: entry.kind, id: entry.id })) }) : {};
    const left = new Set(result ? (result.unremoved ?? []) : snapshots.map((entry) => entry.id!));
    if (left.size) {
      setRemoved((prev) => new Set([...prev].filter((key) => !left.has(key.slice(key.indexOf(":") + 1)))));
      notify(labels.deleteFailed);
    }
    const removedEntries = snapshots.filter((entry) => !left.has(entry.id!));
    for (const item of trashed) moveToTrash(item, true);
    const count = trashed.length + removedEntries.length + drafts.length;
    if (!trashed.length && !removedEntries.length) return;
    const entry: SavedChange | undefined = removedEntries.length ? { edits: [], removes: [], adds: removedEntries, positions: {} } : undefined;
    if (entry) remember(entry);
    notify(labels.deletedMany(count), {
      label: labels.undo,
      run: async () => {
        for (const item of trashed) putBack(item);
        if (!entry) return;
        // This Undo and ⌘/Ctrl + Z are the same undo (see deleteBoard).
        savedHistory.current = savedHistory.current.filter((change) => change !== entry);
        setRemoved((prev) => new Set([...prev].filter((key) => !gone.includes(key))));
        const back = await postRegistry({ adds: removedEntries });
        if (!back || back.rejected?.length) notify(labels.restoreFailed);
      },
    });
  };
  const deleteSelected = () => {
    if (shared) return;
    if (multiRef.current.length) {
      void deleteGroup(multiRef.current);
      return;
    }
    const key = selectedRef.current;
    if (!key) return;
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
    await undoChange(change);
  };
  // A pick shows at once and stays until the registry has it, like a caption edit. An
  // undo of a pick shows its marks at once the same way, so it never waits on, or loses
  // to, a registry update still on its way from the pick.
  const [picks, setPicks] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setPicks((prev) => {
      const keep = Object.entries(prev).filter(([id, on]) => !!items.find((item) => item.id === id)?.picked !== on);
      return keep.length === Object.keys(prev).length ? prev : Object.fromEntries(keep);
    });
  }, [items]);
  /** Puts back what one saved change replaced. The change is already out of the history. */
  const undoChange = async (change: SavedChange) => {
    quietUntil.current = Date.now() + 2000;
    const pickMarks = Object.fromEntries(
      change.edits.flatMap((edit) => (edit.kind === "item" && typeof edit.set.picked === "boolean" ? [[edit.id, edit.set.picked]] : [])),
    );
    if (Object.keys(pickMarks).length) setPicks((prev) => ({ ...prev, ...pickMarks }));
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
      glide();
      positionsRef.current = next;
      setPositions(next);
      queueSave();
    }
    // An image goes back to what the registry will say: its own box here would be saved again.
    const imageIds = change.edits.flatMap((edit) => (edit.kind === "image" ? [edit.id] : []));
    if (imageIds.length) {
      const next = { ...imageBoxesRef.current };
      for (const id of imageIds) {
        delete next[id];
        delete sentImages.current[id];
      }
      setImageBoxes(next);
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
  const undoChangeRef = useRef(undoChange);
  undoChangeRef.current = undoChange;
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
          annotationsRef.current.filter((a) => targetIds.has(a.itemId) && !a.sent && !a.queued && a.text.trim()).length +
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
    [announce, closeAnnotation, closeMark, notify, setBoardTool, targetIds],
  );
  /**
   * The toolbar's tools: Interact (the default, nothing armed: the prototypes respond to clicks),
   * Move canvas, Inspect, Annotate, and the one-shot Note and Section. Only one is on at a time,
   * and Escape returns to Interact.
   */
  const [handTool, setHandTool] = useState(false);
  // Inspect (inspect-edit.ts): the selected element and the changes made to it in the panel.
  const {
    inspectable,
    inspectTool,
    setInspectTool,
    inspectToolRef,
    inspected,
    setInspected,
    inspectedRef,
    inspectChanged,
    inspectHighlight,
    inspectPreview,
    inspectResetAll,
    inspectEdit,
  } = useInspect({ designSystem, annotations, annotationsRef, setAnnotations, itemsRef, pickRef, inspectRecords, notify });
  const handToolRef = useRef(false);
  handToolRef.current = handTool;
  const chooseTool = useCallback(
    (tool: "interact" | "hand" | "inspect" | "annotate" | BoardKind) => {
      // Hand is Space held, kept on: a drag anywhere moves the canvas. For touch and mouse-only
      // use, where holding a key down is not possible. Any other tool ends it.
      setHandTool(tool === "hand");
      setInspectTool(tool === "inspect");
      if (tool === "hand" || tool === "inspect") {
        setBoardTool(null);
        if (annotatingRef.current) setAnnotateMode(false);
        return;
      }
      if (tool === "interact") {
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
  // Anything Discard would drop, sent or not.
  const hasChanges =
    !shared &&
    (visibleAnnotations.some((a) => a.text.trim()) || marks.some((m) => m.text.trim() && !m.direct) || movedItems.length > 0);
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
  // The same for several selected, or an item or an image: a press on something that can be
  // selected is that thing's to answer (it may start a move of them all), and a press
  // anywhere else, in a preview or on a bar, lets go.
  useEffect(() => {
    if (!multi.length) return;
    const onDown = (event: PointerEvent) => {
      const kept = ".canvas-item-title, .canvas-image, .canvas-note-card, .canvas-section-tab, .canvas-board-edge, .canvas-resize";
      if (event.target instanceof Element && event.target.closest(kept)) return;
      if (event.target === viewportRef.current || event.target === worldRef.current) return;
      if (event.button === 1 || spaceArmed.current || zoomArmed.current) return;
      setMulti([]);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [multi, setMulti]);
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
    const before = annotationsRef.current.filter((a) => targetIds.has(a.itemId) && a.text.trim());
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
    setAnnotations((prev) => prev.filter((a) => !targetIds.has(a.itemId)));
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
  }, [notify, queueSave, setMarkOpen, setOpen, shown, targetIds]);
  /** One message: annotations, then notes and sections, then moved items. */
  const message = useCallback(
    (list: Annotation[], markList: BoardMark[] = [], moveList: MovedItem[] = []) =>
      [
        list.length
          ? formatAnnotations(
              list,
              (itemId) => items.find((item) => item.id === itemId)?.name ?? itemId,
              (id) => sectionRefRef.current(id),
            )
          : "",
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
        prev.map((a) => (sentIds.has(a.id) ? { ...a, queued: undefined, sent: sentPrint(a) ?? "?", sentAt: Date.now() } : a)),
      );
      if (!markList.length) return;
      const targets = sentTargets(markList, counts);
      setMarks((prev) => prev.map((m) => (targets.has(m.id) ? { ...m, queued: undefined, sent: targets.get(m.id) } : m)));
    },
    [counts, sentPrint],
  );
  const copyAnnotations = useCallback(
    async (list: Annotation[], done: (n: number) => string, markList: BoardMark[] = [], moveList: MovedItem[] = []) => {
      const text = `${message(list, markList, moveList)}\n\n${labels.copiedTrailer(`${window.location.origin}/`)}`;
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
    const list = annotationsRef.current.filter((a) => targetIds.has(a.itemId) && !a.sent && !a.queued && a.text.trim());
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
        setInFlight(new Set(list.map((a) => a.id)));
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
  }, [closeAnnotation, closeMark, copyAnnotations, markSent, message, notify, targetIds]);
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
    const queued = annotationsRef.current.filter((a) => a.queued && targetIds.has(a.itemId));
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
      setInFlight(new Set(queued.map((a) => a.id)));
      notify(labels.sentToAgent(queued.length + queuedMarks.length + queuedMoves.length));
    });
  }, [agent, markSent, message, notify, targetIds]);

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
      // A note the agent answered stays until the person deletes it: the answer is what it is there for.
      if (!a.sent || a.reply !== undefined) continue;
      const section = sectionOf(a);
      if (section !== null) {
        if (sections.some((s) => s.id === section) && a.sent !== sentPrint(a)) gone.push(a);
        continue;
      }
      if (!ids.has(a.itemId)) continue;
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
    // An item the agent changed in place says so until it has been seen.
    const changed = gone.filter((a) => !a.version && sectionOf(a) === null).map((a) => a.itemId);
    if (changed.length) {
      setFresh((prev) => ({ ...prev, ...Object.fromEntries(changed.filter((id) => !prev[id]).map((id) => [id, "updated" as const])) }));
    }
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
  }, [ids, notify, printOf, sections, sentPrint, setOpen, versionsOf]);
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

  /**
   * Canvas-unit box of an item: caption, title, handle, and preview. A caption puts the
   * box's top `lift` above the item's position, which is `y + lift`.
   */
  const rectOf = useCallback((item: CanvasItem) => {
    const element = elements.current.get(item.id);
    if (!element) return null;
    const p = positionsRef.current[item.id] ?? { x: item.x, y: item.y };
    // Layout sizes ignore the camera transform, so they are canvas units.
    const lift = liftOf(element);
    return { x: p.x, y: p.y - lift, w: element.offsetWidth, h: element.offsetHeight + lift, lift };
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
        ? [{ id: item.id, name: item.name, x: r.x, y: r.y + r.lift }]
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
  // While an item or a note is dragged, the sections it will be in once dropped
  // are outlined: the ones holding its centre, the rule a section's moves and
  // notes go by, so the person never has to guess whether touching the edge is
  // enough. Set on the elements directly, since it changes on every pointer move.
  dropTargetRef.current = (box) => {
    const world = worldRef.current;
    if (!world) return;
    const cx = box ? box.x + box.w / 2 : 0;
    const cy = box ? box.y + box.h / 2 : 0;
    for (const element of world.querySelectorAll<HTMLElement>(".canvas-section")) {
      const ghost = element.dataset.boardGhost;
      const mark = ghost ? marksRef.current.find((m) => m.id === ghost) : undefined;
      const section = ghost ? undefined : sections.find((s) => s.id === element.dataset.boardId);
      const b = mark
        ? { x: mark.x, y: mark.y, w: mark.w ?? 0, h: mark.h ?? 0 }
        : section && { x: section.x, y: section.y, w: section.width, h: section.height };
      element.toggleAttribute("data-drop", !!box && !!b && cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h);
    }
  };
  // A note on a section names what is in it when it is sent, so moving a screen
  // in or out after writing the note still counts: the items in reading order
  // (the order a flow is laid out in), then the notes the person wrote there.
  sectionRefRef.current = (id) => {
    const section = sections.find((s) => s.id === id);
    if (!section) return undefined;
    // While it moves, its mark has where it is now.
    const mark = marksRef.current.find((m) => m.kind === "section" && m.target === id);
    const bounds = { x: mark?.x ?? section.x, y: mark?.y ?? section.y, w: mark?.w ?? section.width, h: mark?.h ?? section.height };
    const inside = readingOrder(
      itemsInside(bounds).map((entry) => ({ ...entry, h: elements.current.get(entry.id)?.offsetHeight ?? 0 })),
    ).map((entry) => labels.sectionItem(entry.name, entry.id));
    const written = notesInside(bounds)
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((c) => (c.ghost ? marksRef.current.find((m) => m.id === c.id)?.text : notes.find((n) => n.id === c.id)?.text) ?? "")
      .map((text) => text.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((text) => (text.length > MAX_NOTE_QUOTE ? `${text.slice(0, MAX_NOTE_QUOTE - 1)}…` : text));
    return labels.sectionContents(mark?.text || section.title, inside, written);
  };
  /** Moves carried notes by the same step as their section, which they then belong to. Each registry note gets its mark on first move. */
  const carryNotes = (carried: CarriedNote[], dx: number, dy: number, section?: string) => {
    for (const c of carried) {
      const id = c.ghost ? c.id : ensureMark("note", c.id);
      if (id) updateMark(id, { x: Math.round(c.x + dx), y: Math.round(c.y + dy) }, section);
    }
  };
  // Sections wholly inside a section move with it, as its items and notes do: a
  // round of directions keeps a section for each tradeoff inside its own, and a
  // pick moves such sections into "Set aside", which the person then drags as one.
  const sectionsInside = (bounds: { x: number; y: number; w: number; h: number }, self: BoardRef): CarriedNote[] => {
    const isInside = (x: number, y: number, w: number, h: number) => x >= bounds.x && y >= bounds.y && x + w <= bounds.x + bounds.w && y + h <= bounds.y + bounds.h;
    const found: CarriedNote[] = [];
    for (const section of sections) {
      const mark = marksRef.current.find((m) => m.kind === "section" && m.target === section.id);
      if (mark ? self.ghost && mark.id === self.id : !self.ghost && section.id === self.id) continue;
      const x = mark?.x ?? section.x;
      const y = mark?.y ?? section.y;
      if (isInside(x, y, mark?.w ?? section.width, mark?.h ?? section.height)) found.push({ id: mark ? mark.id : section.id, ghost: !!mark, x, y });
    }
    // A new section the person drew is a mark of its own, not in the registry yet.
    for (const m of marksRef.current) {
      if (m.kind !== "section" || m.target || (self.ghost && m.id === self.id) || !m.w || !m.h) continue;
      if (isInside(m.x, m.y, m.w, m.h)) found.push({ id: m.id, ghost: true, x: m.x, y: m.y });
    }
    return found;
  };
  const carrySections = (carried: CarriedNote[], dx: number, dy: number) => {
    for (const c of carried) {
      const id = c.ghost ? c.id : ensureMark("section", c.id);
      if (id) updateMark(id, { x: Math.round(c.x + dx), y: Math.round(c.y + dy) });
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

  // The selection (see `multi`).
  /** A note's or section's key in the selection. */
  const stableKey = (ref: BoardRef) => {
    if (!ref.ghost) return `${ref.kind}:${ref.id}`;
    const mark = marksRef.current.find((m) => m.id === ref.id);
    return mark?.target ? `${ref.kind}:${mark.target}` : `mark:${ref.id}`;
  };
  /** The note or section a key names, as it is drawn now: its ghost once it has one. */
  const boardOfKey = (key: string): BoardRef | undefined => {
    const at = key.indexOf(":");
    const type = key.slice(0, at);
    const id = key.slice(at + 1);
    if (type === "mark") {
      const mark = marksRef.current.find((m) => m.id === id && !m.target);
      return mark && { kind: mark.kind, id: mark.id, ghost: true };
    }
    if (type !== "note" && type !== "section") return undefined;
    const mark = marksRef.current.find((m) => m.kind === type && m.target === id);
    if (mark) return { kind: type, id: mark.id, ghost: true };
    if (removed.has(key)) return undefined;
    return (type === "note" ? notes : sections).some((entry) => entry.id === id) ? { kind: type, id, ghost: false } : undefined;
  };
  /** Everything selected, the one note or section with grips included. */
  const selectionKeys = (): string[] => {
    if (multiRef.current.length) return [...multiRef.current];
    const key = selectedRef.current;
    if (!key) return [];
    const [side, kind, id] = key.split(":") as ["g" | "e", BoardKind, string];
    return [stableKey({ kind, id, ghost: side === "g" })];
  };
  /** Selects exactly these. One note or section alone is the plain selection, with its grips. */
  const chooseKeys = (keys: string[]) => {
    const only = keys.length === 1 ? boardOfKey(keys[0]!) : undefined;
    if (only) {
      select(only);
      return;
    }
    select(null);
    setMulti(keys);
  };
  const toggleKey = (key: string) => {
    const keys = selectionKeys();
    chooseKeys(keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]);
  };
  /**
   * What moves with `primary` (the selected thing the person is dragging): the rest of the
   * selection, and what a selected section holds, each once. The dragged thing itself is
   * left out, since its own drag moves it.
   */
  const groupOf = (primary: string) => {
    const groupItems = new Map<string, { id: string; x: number; y: number }>();
    const groupNotes = new Map<string, CarriedNote>();
    const groupSections = new Map<string, CarriedNote>();
    const groupImages = new Map<string, { id: string; x: number; y: number }>();
    for (const key of multiRef.current) {
      if (key === primary) continue;
      if (key.startsWith("item:")) {
        const item = shown.find((entry) => entry.id === key.slice(5));
        if (!item) continue;
        const p = positionsRef.current[item.id] ?? { x: item.x, y: item.y };
        groupItems.set(item.id, { id: item.id, x: p.x, y: p.y });
        continue;
      }
      if (key.startsWith("image:")) {
        const box = imageBoxRef.current(key.slice(6));
        if (box) groupImages.set(key.slice(6), { id: key.slice(6), x: box.x, y: box.y });
        continue;
      }
      const ref = boardOfKey(key);
      const origin = ref && boardOrigin(ref);
      if (!ref || !origin) continue;
      const carried = { id: ref.id, ghost: ref.ghost, x: origin.x, y: origin.y };
      if (ref.kind === "note") {
        groupNotes.set(ref.id, carried);
        continue;
      }
      groupSections.set(ref.id, carried);
      if (!origin.w || !origin.h) continue;
      const bounds = { x: origin.x, y: origin.y, w: origin.w, h: origin.h };
      for (const inside of itemsInside(bounds)) groupItems.set(inside.id, inside);
      for (const inside of notesInside(bounds)) groupNotes.set(inside.id, inside);
      for (const inside of sectionsInside(bounds, ref)) groupSections.set(inside.id, inside);
      for (const inside of imagesInsideRef.current(bounds)) groupImages.set(inside.id, inside);
    }
    if (primary.startsWith("item:")) groupItems.delete(primary.slice(5));
    else if (primary.startsWith("image:")) groupImages.delete(primary.slice(6));
    else {
      const ref = boardOfKey(primary);
      if (ref) {
        groupNotes.delete(ref.id);
        groupSections.delete(ref.id);
      }
    }
    return { items: [...groupItems.values()], notes: [...groupNotes.values()], sections: [...groupSections.values()], images: [...groupImages.values()] };
  };
  type Group = ReturnType<typeof groupOf>;
  const shiftGroup = (group: Group, dx: number, dy: number) => {
    shiftItems(group.items, dx, dy);
    carryNotes(group.notes, dx, dy);
    carrySections(group.sections, dx, dy);
    shiftImagesRef.current(group.images, dx, dy);
  };
  /** The keys of what a box on screen touches. A section only when the box holds all of it: a box drawn inside a section is for what is in it. */
  const keysIn = (box: { left: number; top: number; right: number; bottom: number }) => {
    const touches = (r: DOMRect) => r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
    const holds = (r: DOMRect) => r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom;
    const keys: string[] = [];
    for (const [id, element] of elements.current) if (touches(itemScreenRect(element))) keys.push(`item:${id}`);
    for (const element of worldRef.current?.querySelectorAll<HTMLElement>("[data-board-id], [data-board-ghost], [data-canvas-image]") ?? []) {
      if (element.dataset.canvasImage) {
        if (touches(element.getBoundingClientRect())) keys.push(`image:${element.dataset.canvasImage}`);
        continue;
      }
      const section = element.classList.contains("canvas-section");
      const rect = (section ? element.querySelector(".canvas-section-frame") : element)?.getBoundingClientRect();
      if (!rect || !(section ? holds(rect) : touches(rect))) continue;
      const ghost = element.dataset.boardGhost;
      keys.push(stableKey({ kind: section ? "section" : "note", id: ghost ?? element.dataset.boardId!, ghost: ghost !== undefined }));
    }
    return [...new Set(keys)];
  };
  // For the handlers that are set up once (an item's name, the canvas's own presses).
  const selection = useRef({ selectionKeys, chooseKeys, toggleKey, groupOf, shiftGroup, keysIn, pruneUnchanged });
  selection.current = { selectionKeys, chooseKeys, toggleKey, groupOf, shiftGroup, keysIn, pruneUnchanged };
  // A key whose thing is gone (deleted, trashed, or a new note now saved under its own id) leaves the selection.
  useEffect(() => {
    if (!multi.length) return;
    const kept = multi.filter((key) =>
      key.startsWith("item:") ? shown.some((item) => item.id === key.slice(5)) : key.startsWith("image:") ? !!imageBoxRef.current(key.slice(6)) : !!boardOfKey(key),
    );
    if (kept.length !== multi.length) setMulti(kept);
  });
  // A double-click is two quick presses that never travel. The browser's own
  // dblclick goes to the viewport, which holds the pointer capture during a press,
  // so it never reaches a note or tab.
  const lastTap = useRef<{ key: string; time: number } | null>(null);
  /** Runs `step` for each pointer move of this drag after the drag threshold, `done` once it ends, and `tap` instead if it never moved. */
  const dragBoard = (
    event: ReactPointerEvent<HTMLElement>,
    first: () => void,
    step: (dx: number, dy: number, e: PointerEvent) => void,
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
      step((e.clientX - start.x) / z, (e.clientY - start.y) / z, e);
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
  // Reference images: pasted or dropped, then moved, resized from a corner (the picture
  // keeps its proportions), selected, and deleted like a note. They sit above sections and
  // under items, and a section carries the ones whose centre is inside it.
  const boxOfImage = (image: CanvasImage): ImageBox => imageBoxesRef.current[image.id] ?? { x: image.x, y: image.y, w: image.width, h: image.height };
  imageBoxRef.current = (id) => {
    const image = images.find((entry) => entry.id === id);
    return image && boxOfImage(image);
  };
  imagesInsideRef.current = (bounds) =>
    images.flatMap((image) => {
      const box = boxOfImage(image);
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      return cx >= bounds.x && cx <= bounds.x + bounds.w && cy >= bounds.y && cy <= bounds.y + bounds.h ? [{ id: image.id, x: box.x, y: box.y }] : [];
    });
  shiftImagesRef.current = (list, dx, dy) => {
    if (!list.length) return;
    const next = { ...imageBoxesRef.current };
    for (const entry of list) {
      const image = images.find((candidate) => candidate.id === entry.id);
      if (image) next[entry.id] = { ...boxOfImage(image), x: Math.round(entry.x + dx), y: Math.round(entry.y + dy) };
    }
    setImageBoxes(next);
  };
  const moveImage = (event: ReactPointerEvent<HTMLElement>, image: CanvasImage) => {
    if (event.button !== 0 || spaceArmed.current || boardToolRef.current || annotatingRef.current) return;
    event.stopPropagation();
    event.preventDefault();
    const key = `image:${image.id}`;
    if (event.shiftKey) {
      toggleKey(key);
      return;
    }
    const group = multiRef.current.length > 1 && multiRef.current.includes(key) ? groupOf(key) : null;
    if (!group) chooseKeys([key]);
    const origin = boxOfImage(image);
    dragBoard(
      event,
      () => {},
      (dx, dy) => {
        const x = Math.round(origin.x + dx);
        const y = Math.round(origin.y + dy);
        setImageBoxes({ ...imageBoxesRef.current, [image.id]: { ...origin, x, y } });
        if (group) shiftGroup(group, x - origin.x, y - origin.y);
      },
      () => {
        if (group?.items.length) queueSave();
        pruneUnchanged();
      },
      () => {
        if (group) chooseKeys([key]);
      },
    );
  };
  const resizeImage = (event: ReactPointerEvent<HTMLElement>, image: CanvasImage, corner: (typeof IMAGE_CORNERS)[number]) => {
    if (event.button !== 0 || spaceArmed.current) return;
    event.stopPropagation();
    event.preventDefault();
    const origin = boxOfImage(image);
    const ratio = origin.w / origin.h;
    const east = corner.endsWith("e");
    const south = corner.startsWith("s");
    dragBoard(
      event,
      () => {},
      (dx, dy, e) => {
        // The corner follows whichever way the pointer has gone further, and the other side keeps the proportions.
        const byWidth = origin.w + (east ? dx : -dx);
        const byHeight = (origin.h + (south ? dy : -dy)) * ratio;
        const w = Math.round(Math.max(IMAGE_MIN, IMAGE_MIN * ratio, byWidth, byHeight));
        const h = Math.round(w / ratio);
        setImageBoxes({
          ...imageBoxesRef.current,
          [image.id]: { x: east ? origin.x : origin.x + origin.w - w, y: south ? origin.y : origin.y + origin.h - h, w, h },
        });
        sizeTip(e, w, h, corner);
      },
      () => sizeTip(null),
    );
  };
  // A new image shows where it was put at once, from the picture itself, until the registry lists it.
  const [placing, setPlacing] = useState<{ key: string; id?: string; url: string; box: ImageBox }[]>([]);
  useEffect(() => {
    setPlacing((prev) => {
      const next = prev.filter((p) => !(p.id && listedImages.some((image) => image.id === p.id && imageUrls[image.file])));
      return next.length === prev.length ? prev : next;
    });
  }, [listedImages, imageUrls]);
  const addImage = async (file: Blob, centre: { x: number; y: number }) => {
    const picture = await prepareImage(file).catch(() => null);
    if (!picture) {
      notify(labels.imageUnreadable, undefined, true);
      return;
    }
    const scale = Math.min(1, IMAGE_SHOWN / Math.max(picture.width, picture.height));
    const w = Math.max(1, Math.round(picture.width * scale));
    const h = Math.max(1, Math.round(picture.height * scale));
    const box = { x: Math.round(centre.x - w / 2), y: Math.round(centre.y - h / 2), w, h };
    const key = newMarkId();
    setPlacing((prev) => [...prev, { key, url: picture.data, box }]);
    let id: string | undefined;
    try {
      const response = await fetch(IMAGE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: picture.data, x: box.x, y: box.y, width: w, height: h }),
      });
      if (response.ok) id = ((await response.json()) as { id?: string }).id;
    } catch {
      // No dev server: said below.
    }
    if (!id) {
      setPlacing((prev) => prev.filter((p) => p.key !== key));
      notify(labels.imageNotSaved, undefined, true);
      return;
    }
    const saved = id;
    void refreshImages();
    setPlacing((prev) => prev.map((p) => (p.key === key ? { ...p, id: saved } : p)));
    // ⌘/Ctrl + Z takes it off the canvas again. Its file stays in images/.
    remember({ edits: [], removes: [{ kind: "image", id: saved }], adds: [], positions: {} });
  };
  /** Several at once land a step apart, so none hides another. */
  const addImagesRef = useRef<(files: Blob[], centre: { x: number; y: number }) => void>(() => {});
  addImagesRef.current = (files, centre) => {
    files.forEach((file, index) => void addImage(file, { x: centre.x + index * 32, y: centre.y + index * 32 }));
  };
  // Paste puts a copied picture at the pointer, or in the middle of the view when the
  // pointer is elsewhere. A file dragged in from the desktop lands where it is dropped.
  // Neither while typing in a field or with focus in a preview, where a paste or a drop
  // belongs to the app being shown, and not in a shared file, which cannot save.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (shared || !viewport) return;
    const pictures = (data: DataTransfer | null) => [...(data?.files ?? [])].filter((file) => file.type.startsWith("image/"));
    const toWorld = (clientX: number, clientY: number) => {
      const rect = viewport.getBoundingClientRect();
      const { x, y, z } = camera.current;
      return { x: (clientX - rect.left - x) / z, y: (clientY - rect.top - y) / z };
    };
    let pointer: { x: number; y: number } | null = null;
    const onMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };
    const onLeave = () => {
      pointer = null;
    };
    const inPreview = (target: EventTarget | null) => target instanceof Element && target.closest(".canvas-preview") !== null;
    const onPaste = (event: ClipboardEvent) => {
      const files = pictures(event.clipboardData);
      const active = document.activeElement;
      if (!files.length || (event.target instanceof Element && typingIn(event.target)) || inPreview(active)) return;
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      addImagesRef.current(files, pointer ? toWorld(pointer.x, pointer.y) : toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2));
    };
    const hasFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes("Files") && !inPreview(event.target);
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = "copy";
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      // Also for a file that is no picture: the browser would leave the canvas to open it.
      event.preventDefault();
      const files = pictures(event.dataTransfer);
      if (files.length) addImagesRef.current(files, toWorld(event.clientX, event.clientY));
    };
    viewport.addEventListener("pointermove", onMove);
    viewport.addEventListener("pointerleave", onLeave);
    window.addEventListener("paste", onPaste);
    viewport.addEventListener("dragover", onDragOver);
    viewport.addEventListener("drop", onDrop);
    return () => {
      viewport.removeEventListener("pointermove", onMove);
      viewport.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("paste", onPaste);
      viewport.removeEventListener("dragover", onDragOver);
      viewport.removeEventListener("drop", onDrop);
    };
  }, []);

  boardImpl.current = {
    move: (event, ref) => {
      if (event.button !== 0 || spaceArmed.current || boardToolRef.current) return;
      if (event.target instanceof Element && event.target.closest("textarea, button, .canvas-resize, .canvas-board-edge")) return;
      const origin = boardOrigin(ref);
      if (!origin) return;
      event.stopPropagation();
      // Stops text selection while dragging.
      event.preventDefault();
      // A link in a note opens on a click; a drag that starts on it still moves the note.
      // The viewport holds the pointer during the press, so the link never gets the click.
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>(".canvas-note-link") : null;
      // In annotate mode a click on a section's title is a note on the whole
      // section, as an item's name is for the item; a drag still moves it. A new
      // section, not in the registry yet, is itself a change waiting to apply.
      const annotated =
        annotatingRef.current && ref.kind === "section"
          ? ref.ghost
            ? marksRef.current.find((m) => m.id === ref.id)?.target
            : ref.id
          : undefined;
      // Shift + click adds it to the selection, or takes it out; it does not start a move.
      const ownKey = stableKey(ref);
      if (event.shiftKey && !annotated) {
        toggleKey(ownKey);
        return;
      }
      // One of several selected: a drag moves them all, and only a click that never travels selects it alone.
      const group = !annotated && multiRef.current.includes(ownKey) ? groupOf(ownKey) : null;
      if (!annotated && !group) select(ref);
      let id = ref.ghost ? ref.id : "";
      // A section carries the items inside it, so the frame never leaves its contents behind.
      const frame = ref.kind === "section" && origin.w && origin.h ? { x: origin.x, y: origin.y, w: origin.w, h: origin.h } : null;
      const carried = frame ? itemsInside(frame) : [];
      const carriedNotes = frame ? notesInside(frame) : [];
      const carriedSections = frame ? sectionsInside(frame, ref) : [];
      const carriedImages = frame ? imagesInsideRef.current(frame) : [];
      // The rest of the selection, without what this section already carries: nothing moves twice.
      const without = <T extends { id: string }>(list: T[], taken: { id: string }[]) => list.filter((entry) => !taken.some((t) => t.id === entry.id));
      const rest = group && {
        items: without(group.items, carried),
        notes: without(group.notes, carriedNotes),
        sections: without(group.sections, carriedSections),
        images: without(group.images, carriedImages),
      };
      // A dragged note outlines the section it will be in, as an item does.
      const noteSize =
        ref.kind === "note"
          ? {
              w: origin.w ?? NOTE_WIDTH,
              h:
                worldRef.current?.querySelector<HTMLElement>(
                  ref.ghost ? `[data-board-ghost="${CSS.escape(ref.id)}"]` : `[data-board-id="${CSS.escape(ref.id)}"]`,
                )?.offsetHeight ?? 80,
            }
          : null;
      dragBoard(
        event,
        () => {
          if (id) return;
          id = ensureMark(ref.kind, ref.id);
          // The selection names it by its registry id, so its new ghost needs no word here.
          if (!group) select({ kind: ref.kind, id, ghost: true });
        },
        (dx, dy) => {
          if (!id) return;
          const x = Math.round(origin.x + dx);
          const y = Math.round(origin.y + dy);
          updateMark(id, { x, y });
          shiftItems(carried, x - origin.x, y - origin.y);
          carryNotes(carriedNotes, x - origin.x, y - origin.y, id);
          carrySections(carriedSections, x - origin.x, y - origin.y);
          shiftImagesRef.current(carriedImages, x - origin.x, y - origin.y);
          if (rest) shiftGroup(rest, x - origin.x, y - origin.y);
          if (noteSize && !rest) dropTargetRef.current({ x, y, ...noteSize });
        },
        () => {
          if (noteSize) dropTargetRef.current(null);
          if (carried.length || rest?.items.length) queueSave();
          pruneUnchanged();
        },
        () => {
          const section = annotated && sections.find((s) => s.id === annotated);
          if (section) {
            startAnnotation(sectionKey(section.id), 0, 0, labels.sectionRef(section.title));
            return;
          }
          if (group) select(ref);
          // Not counted toward a double-click: the new tab has the focus by the second press.
          if (link) {
            window.open(link.href, "_blank", "noopener,noreferrer");
            return;
          }
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
        (dx, dy, e) => {
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
          // A section is a frame with a size worth knowing; a note's size is only room for its text.
          if (ref.kind === "section") sizeTip(e, Math.round(w), Math.round(h), edge);
        },
        () => {
          sizeTip(null);
          pruneUnchanged();
        },
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
      const carriedSections = ref.kind === "section" && origin.w && origin.h ? sectionsInside({ x: origin.x, y: origin.y, w: origin.w, h: origin.h }, ref) : [];
      updateMark(id, { x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) });
      shiftItems(carried, dx, dy);
      carryNotes(carriedNotes, dx, dy, id);
      carrySections(carriedSections, dx, dy);
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
      (dx, dy, e) => {
        // An edge changes one dimension, a corner both.
        const w = Math.round(Math.max(least.w, east ? w0 + dx : west ? w0 - dx : w0));
        const h = Math.round(Math.max(least.h, south ? h0 + dy : north ? h0 - dy : h0));
        sizeTip(e, w, h, edge);
        const raw = itemsRawRef.current.find((entry) => entry.id === item.id);
        if (!raw) return;
        setSizes((prev) => ({ ...prev, [item.id]: { w, h, bw: raw.width, bh: raw.height } }));
        if (west || north) {
          const x = west ? origin.x + w0 - w : origin.x;
          const y = north ? origin.y + h0 - h : origin.y;
          setPositions((prev) => ({ ...prev, [item.id]: { x, y } }));
        }
      },
      () => {
        sizeTip(null);
        queueSave();
      },
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
      ...listedImagesRef.current.map((i) => ({ minX: i.x, minY: i.y, maxX: i.x + i.width, maxY: i.y + i.height })),
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

  /**
   * Moves the camera only as far as needed to show `targets`, keeping the zoom when they fit.
   * With `centre`, the targets go to the middle of the view also when they were in view
   * already: for a link that opens a new tab, where the person's attention moves to the new
   * item as it would to the new tab.
   */
  const reveal = useCallback(
    (targets: CanvasItem[], centre = false) => {
      const viewport = viewportRef.current;
      const bounds = boundsOf(targets);
      if (!viewport || !bounds) return;
      const { x, y, z } = camera.current;
      const w = viewport.clientWidth;
      const h = viewport.clientHeight;
      const m = REVEAL_MARGIN;
      // Revealed items stop above the toolbar, and below the top bars and the notice
      // under them, which would otherwise cover a new version just as it arrives.
      const toolbar = viewport.parentElement?.querySelector(".canvas-toolbar")?.getBoundingClientRect();
      const bottom = toolbar ? Math.max(m, viewport.getBoundingClientRect().bottom - toolbar.top + 16) : m;
      const top = Math.max(m, CHROME_TOP + TOAST_ROW);
      const visible =
        bounds.minX * z + x >= m &&
        bounds.minY * z + y >= top &&
        bounds.maxX * z + x <= w - m &&
        bounds.maxY * z + y <= h - bottom;
      if (visible && !centre) return;
      // Zoom out only as far as the targets need; never zoom in.
      const next = clampZoom(
        Math.min(
          z,
          (w - m * 2) / Math.max(1, bounds.maxX - bounds.minX),
          (h - top - bottom) / Math.max(1, bounds.maxY - bounds.minY),
        ),
      );
      (centre ? flyTo : setCamera)({
        x: w / 2 - ((bounds.minX + bounds.maxX) / 2) * next,
        y: (top + h - bottom) / 2 - ((bounds.minY + bounds.maxY) / 2) * next,
        z: next,
      });
    },
    [boundsOf, flyTo, setCamera],
  );

  /**
   * Gives items a free saved position; other items never move. A new item
   * starts at its source position and an item put back from the trash where it
   * was; when that spot is taken, it goes just right of the items beside it.
   * A new version goes in the row under its original, after the versions
   * already made from it (lineage.ts), clear of notes and of sections it
   * does not belong in.
   */
  const placeFree = useCallback(
    (targets: CanvasItem[], { besideOrigin }: { besideOrigin: boolean }) => {
      const targetIds = new Set(targets.map((item) => item.id));
      const taken = shown.filter((item) => !targetIds.has(item.id)).flatMap((item) => rectOf(item) ?? []);
      const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      const placed: Record<string, Position> = {};
      /** An item's box where it is now, or where this call just put it. */
      const boxOf = (item: CanvasItem) => {
        const r = rectOf(item);
        const p = placed[item.id];
        return r && p ? { ...r, x: p.x, y: p.y - r.lift } : r;
      };
      const frames = sections.filter((s) => !removed.has(`section:${s.id}`));
      const holds = (f: CanvasSection, b: { x: number; y: number; w: number; h: number }) => {
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        return cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height;
      };
      // Notes, as the registry has them; a note still being typed is not in the way yet.
      const noteBoxes = notes
        .filter((n) => !removed.has(`note:${n.id}`))
        .map((n) => ({ x: n.x, y: n.y, w: n.width ?? NOTE_WIDTH, h: n.height ?? 120 }));
      for (const item of targets) {
        const r = rectOf(item);
        if (!r) continue;
        const origin = besideOrigin && item.from ? shown.find((other) => other.id === item.from) : undefined;
        const o = origin && boxOf(origin);
        let box: { x: number; y: number } | undefined;
        if (origin && o) {
          // The round so far: versions already made from the same item, wherever the
          // person has them, except the ones a pick set aside.
          const siblings = shown.flatMap((other) => {
            if (other.id === item.id || other.from !== origin.id || (targetIds.has(other.id) && !placed[other.id])) return [];
            const b = boxOf(other);
            return b && !frames.some((f) => isSetAside(f) && holds(f, b)) ? [b] : [];
          });
          // A section is in the way unless it holds the original; its title tab sits above its frame.
          const walls = frames
            .filter((f) => isSetAside(f) || !holds(f, o))
            .map((f) => ({ x: f.x, y: f.y - SECTION_TAB, w: f.width, h: f.height + SECTION_TAB }));
          box = versionSpot(o, siblings, r, [...taken, ...noteBoxes, ...walls], ADD_GAP);
        } else {
          const spot = { x: r.x, y: r.y };
          if (!taken.some((other) => overlaps({ ...r, ...spot }, other))) box = spot;
          else {
            const row = taken.filter((other) => other.y < spot.y + r.h && spot.y < other.y + other.h);
            const right = Math.max(...(row.length ? row : taken).map((other) => other.x + other.w));
            box = { x: right + ADD_GAP, y: spot.y };
          }
        }
        const next = sanitizePosition({ x: box.x, y: box.y + r.lift });
        placed[item.id] = next;
        taken.push({ ...r, x: next.x, y: next.y - r.lift });
      }
      positionsRef.current = { ...positionsRef.current, ...placed };
      setPositions(positionsRef.current);
      queueSave();
    },
    [notes, queueSave, rectOf, removed, sections, shown],
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
          // The view stays where the person is (they may be busy elsewhere while
          // the agent works); each new item says it is new until it has been seen.
          setFresh((prev) => ({ ...prev, ...Object.fromEntries(added.map((item) => [item.id, "new" as const])) }));
        }),
      ),
    );
  }, [items, placeFree, shown]);

  /** A note open on an item closes as the item goes to the trash. */
  const closeNoteOn = useCallback(
    (item: CanvasItem) => {
      const open = openRef.current && annotationsRef.current.find((a) => a.id === openRef.current?.id);
      if (open && open.itemId === item.id) closeAnnotation();
    },
    [closeAnnotation],
  );
  const {
    trashedItems,
    times: trashedAt,
    open: trashOpen,
    setOpen: setTrashOpen,
    buttonRef: trashButtonRef,
    close: closeTrash,
    putBack,
    takeOut,
    moveToTrash,
  } = useTrash(trashList, {
    items,
    itemsRef,
    saved: saved.trash,
    queueSave,
    placeFree,
    reveal,
    setFrontId,
    notify,
    beforeTrash: closeNoteOn,
    viewportRef,
  });

  // Each pin stays on the element it is about when the layout moves (pin-anchors.ts).
  usePinAnchors({ annotations, annotationsRef, setAnnotations, items, worldRef });

  // The agent's answer to a note (scripts/reply.sh) lands on that note. Questions
  // are asked on the canvas, at the thing they are about, so that is where the
  // answer belongs; the same goes for "I did not do this, because…", which in the
  // chat is far from the pin it explains. One notice says answers came, with a way
  // to them, since a pin can be anywhere on the canvas.
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  const heard = useRef<{ ids: string[]; timer: number }>({ ids: [], timer: 0 });
  useAgentReplies((reply, live) => {
    const note = annotationsRef.current.find((a) => a.id === reply.id);
    if (!note) {
      // The note is gone (deleted, or cleared when its item changed before the answer came): the words are still said, once.
      if (live) notify(labels.agentReplyLoose(reply.text), undefined, true);
      return;
    }
    // Heard already, or an answer to an earlier wording of a note that was edited and sent again.
    if (note.reply === reply.text || !note.sent || (note.sentAt !== undefined && reply.at && reply.at < note.sentAt)) return;
    annotationsRef.current = annotationsRef.current.map((a) => (a.id === reply.id ? { ...a, reply: reply.text, seen: undefined } : a));
    setAnnotations(annotationsRef.current);
    // Answers that come together are one notice.
    heard.current.ids.push(reply.id);
    window.clearTimeout(heard.current.timer);
    heard.current.timer = window.setTimeout(() => {
      const ids = [...new Set(heard.current.ids)];
      heard.current.ids = [];
      const first = annotationsRef.current.find((a) => ids.includes(a.id) && sectionOf(a) === null);
      const item = first && itemsRef.current.find((entry) => entry.id === first.itemId);
      notify(labels.agentReplied(ids.length), item ? { label: labels.showReply, run: () => revealRef.current([item]) } : undefined, true);
    }, 150);
  });

  // A planned card's own buttons (Planned.tsx). Drop is the ordinary trash, Undo
  // included. Build is a note on the whole card, changed in place (the card
  // becomes the built version, so there is no original to keep), and it goes out
  // at once with anything else waiting: the button says "Build", so a second
  // press on Apply would be a step the person did not expect.
  useEffect(() => {
    if (shared) return;
    const onPlan = (event: Event) => {
      const action = (event as CustomEvent<{ action?: unknown } | null>).detail?.action;
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-canvas-item]") : null;
      const item = element ? itemsRef.current.find((entry) => entry.id === element.dataset.canvasItem) : undefined;
      if (!element || !item) return;
      if (action === "drop") {
        moveToTrash(item);
        return;
      }
      if (action !== "build") return;
      // Asked already (a card remounts with its buttons back): send what waits, add nothing.
      if (!annotationsRef.current.some((a) => a.itemId === item.id && a.text === labels.buildPlanned)) {
        const preview = element.querySelector<HTMLElement>("[data-canvas-preview]");
        const annotation: Annotation = {
          id: newAnnotationId(),
          itemId: item.id,
          x: 0,
          y: 0,
          w: preview?.offsetWidth ?? item.width,
          h: preview?.offsetHeight ?? item.height,
          ref: item.name,
          text: labels.buildPlanned,
          version: false,
        };
        // The send below reads the ref, and the state has not rendered yet.
        annotationsRef.current = [...annotationsRef.current, annotation];
        setAnnotations(annotationsRef.current);
      }
      void sendRef.current();
    };
    window.addEventListener(PLAN_EVENT, onPlan);
    return () => window.removeEventListener(PLAN_EVENT, onPlan);
  }, [moveToTrash]);

  // Picking a version (the check beside an item's name) says "this is the answer".
  // It only marks the item: versions already sit in rows by the item they came from
  // (lineage.ts), so nothing needs to move, and the path from the original to the
  // pick (LineagePaths.tsx) shows how the exploration got there. A pick takes the mark
  // off an earlier pick among the versions it was compared with (pick.ts), in the
  // same write, so one ⌘/Ctrl + Z takes all of it back. Nothing is announced: the
  // ring, the tag, and the path are the answer. The agent reads `picked` afterwards.
  const boardNow = useRef({ notes, sections, removed });
  boardNow.current = { notes, sections, removed };
  const picksRef = useRef(picks);
  picksRef.current = picks;
  /** Items inside a set-aside section: out of the running, so they are not offered a pick. */
  const setAsideIds = useMemo(() => {
    const frames = sections.filter((s) => isSetAside(s) && !removed.has(`section:${s.id}`));
    if (!frames.length) return new Set<string>();
    return new Set(
      shown
        .filter((item) => {
          const p = positions[item.id] ?? item;
          const cx = p.x + item.width / 2;
          const cy = p.y + (ITEM_HEAD + item.height) / 2;
          return frames.some((f) => cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height);
        })
        .map((item) => item.id),
    );
  }, [positions, removed, sections, shown]);
  /** Writes picks (`true`) and unpicks (`false`) as one change with one undo; shows them at once. */
  const savePicks = useCallback(
    async (marks: Record<string, boolean>) => {
      const ids = Object.keys(marks);
      const edits: DirectEdit[] = ids.map((id) => ({ kind: "item", id, set: { picked: marks[id]! } }));
      const inverse: DirectEdit[] = ids.map((id) => ({ kind: "item", id, set: { picked: !marks[id] } }));
      setPicks((prev) => ({ ...prev, ...marks }));
      // Tracked like any other save, so an undo pressed while the write is still on
      // its way waits for it, and finds this pick in the history (see undoSaved).
      const save = (async () => {
        const result = await postRegistry({ edits });
        const lost = new Set(result?.missing ?? []);
        if (!result || lost.size || result.rejected?.length) {
          // Nothing half done: whatever was written is taken back, and the marks show as before.
          if (result) await postRegistry({ edits: inverse.filter((edit) => !lost.has(edit.id)) });
          setPicks((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !ids.includes(id))));
          notify(labels.pickFailed, undefined, true);
          return;
        }
        // Straight into the history, not through remember(): that one stays quiet for two
        // seconds after an undo, so that the undo's own saves are not history. A pick is
        // the person's act, and one made right after an undo must be undoable too.
        savedHistory.current = [...savedHistory.current, { edits: inverse, removes: [], adds: [], positions: {} }].slice(-HISTORY_LIMIT);
      })();
      savesInFlight.current.add(save);
      void save.finally(() => savesInFlight.current.delete(save));
      await save;
    },
    [notify],
  );
  /** The paths from the original to each picked version, drawn behind the items. */
  const lineageSteps = useMemo(() => pickedPaths(shown, (item) => picks[item.id] ?? !!item.picked), [picks, shown]);
  /**
   * The first view of a canvas with no saved view, such as a shared file opened for the
   * first time: the picked versions and the paths to them, so a reader starts at the
   * answer and how it was reached. With nothing picked, everything.
   */
  const fitFirst = useCallback(() => {
    const viewport = viewportRef.current;
    const ids = new Set(lineageSteps.flatMap((step) => [step.from.id, step.to.id]));
    for (const item of shown) if (picks[item.id] ?? item.picked) ids.add(item.id);
    const bounds = ids.size ? boundsOf(shown.filter((item) => ids.has(item.id))) : null;
    if (viewport && bounds) setCamera(fitBounds(bounds, viewport.clientWidth, viewport.clientHeight, FIT_PADDING));
    else fitAllRef.current();
  }, [boundsOf, lineageSteps, picks, setCamera, shown]);
  const fitFirstRef = useRef(fitFirst);
  fitFirstRef.current = fitFirst;
  const pickVersion = useCallback(
    async (item: CanvasItem) => {
      if (shared) return;
      const isPicked = (entry: CanvasItem) => picksRef.current[entry.id] ?? !!entry.picked;
      const earlier = comparedWith(item, { ...boardNow.current, items: itemsRef.current, trash: trashRef.current, positions: positionsRef.current }).filter(isPicked);
      await savePicks({ [item.id]: true, ...Object.fromEntries(earlier.map((entry) => [entry.id, false])) });
    },
    [savePicks],
  );

  // Set aside, from an item opened in the trash: out of the trash into the "Set aside" frame a
  // pick fills, instead of back where it was (pick.ts planAside). The trash stays open on the
  // next item. Its place goes into the registry with the frame in one write, marked as on its
  // way like a pick's moves; the trash write is the trash's own (Trash.tsx takeOut).
  const setAsideFromTrash = useCallback(
    async (item: CanvasItem) => {
      if (shared) return;
      const { place, edits, adds } = planAside(item, {
        ...boardNow.current,
        items: itemsRef.current,
        trash: trashRef.current,
        positions: positionsRef.current,
      });
      takeOut(item);
      const saving = { [item.id]: { ...place, state: "saving" as const } };
      moveStatesRef.current = { ...moveStatesRef.current, ...saving };
      setMoveStates((prev) => ({ ...prev, ...saving }));
      positionsRef.current = { ...positionsRef.current, [item.id]: place };
      setPositions(positionsRef.current);
      queueSave();
      const save = (async () => {
        const result = await postRegistry({ edits, adds });
        if (result && !result.rejected?.length && !result.missing?.includes(item.id)) return;
        // Not written: the item stays out of the trash at that place, and its move is saved the usual way.
        const { [item.id]: _, ...rest } = moveStatesRef.current;
        moveStatesRef.current = rest;
        setMoveStates(rest);
        setTrashOpen(false);
        notify(labels.setAsideFailed, undefined, true);
      })();
      savesInFlight.current.add(save);
      void save.finally(() => savesInFlight.current.delete(save));
      await save;
    },
    [notify, queueSave, setTrashOpen, takeOut],
  );

  // Unpick, on the Picked tag: the mark and the path go. ⌘/Ctrl + Z, or picking it again, brings them back.
  const unpickVersion = useCallback(
    async (item: CanvasItem) => {
      if (shared) return;
      await savePicks({ [item.id]: false });
    },
    [savePicks],
  );

  // Links and router calls inside items (links.ts).
  const { routes, setRoutes, restartRoute, steps, followLink } = useLinks({ shown, setFrontId, frontIdRef, positionsRef, worldRef, reveal, notify });
  /** How a note about one screen of an item (its index), or about its whole flow (null), is named. */
  const flowRefOf = useCallback((item: CanvasItem, index: number | null, state?: string) => {
    const screens = screensOf(item);
    const named = (path: string) => path || labels.firstScreen;
    return index === null ? labels.flowRef(item.name, screens.map((s) => named(s.path))) : labels.screenRef(item.name, named(screens[index]?.path ?? ""), state);
  }, []);
  /**
   * Ask agent from the flow view, about one screen or the whole flow. The note opens there, on
   * the screen asked about: the view stays, and the item behind it does not change screen, so
   * nothing moves while the person writes. The note belongs to the item, so it waits and goes
   * to the agent like any other, and shows on the item once the view closes. A note about the
   * same screen that still waits opens again.
   */
  const askFlow = useCallback(
    (item: CanvasItem, index: number | null, state?: string) => {
      const ref = flowRefOf(item, index, state);
      const waiting = annotationsRef.current.find((a) => a.itemId === item.id && a.ref === ref && !a.sent && !a.queued);
      if (waiting) return openExisting(waiting.id);
      const preview = worldRef.current?.querySelector<HTMLElement>(`[data-canvas-preview="${CSS.escape(item.id)}"]`);
      if (preview) startAnnotation(item.id, 0, 0, ref, { w: preview.offsetWidth, h: preview.offsetHeight });
    },
    [flowRefOf, openExisting, startAnnotation],
  );
  /**
   * Ask agent from the flow view about an element of one screen. The note opens on the element,
   * there, and is named by the screen and the element: `Name › screen /checkout › button “Pay”`.
   * On the canvas its pin keeps that point on the item, whichever screen the item shows.
   */
  const askFlowElement = useCallback(
    (item: CanvasItem, index: number, described: string, x: number, y: number, state?: string) => {
      const ref = `${flowRefOf(item, index, state)} › ${described}`;
      const waiting = annotationsRef.current.find((a) => a.itemId === item.id && a.ref === ref && !a.sent && !a.queued);
      if (waiting) return openExisting(waiting.id);
      startAnnotation(item.id, x, y, ref);
    },
    [flowRefOf, openExisting, startAnnotation],
  );
  /**
   * The notes about one screen, or the whole flow, drawn in the flow view as pins: a screen's
   * own in its corner, and those on its elements at their point, at the screen's size there.
   */
  const flowPins = useCallback(
    (item: CanvasItem, index: number | null, scale: number, state?: string) => {
      const ref = flowRefOf(item, index, state);
      const mine = visibleAnnotations.filter((a) => a.itemId === item.id);
      const whole = mine.filter((a) => a.ref === ref);
      const onElements = index === null ? [] : mine.filter((a) => a.ref.startsWith(`${ref} › `));
      const pin = (annotation: Annotation, at?: { x: number; y: number }) => {
        // Without its area: the outline is the item's size on the canvas, not the screen's here.
        const { w: _w, h: _h, ...rest } = annotation;
        return (
          <AnnotationPin
            key={annotation.id}
            annotation={at ? { ...rest, ...at } : rest}
            number={annotation.sent || annotation.queued ? undefined : pending.indexOf(annotation) + 1}
            open={openAnnotation?.id === annotation.id}
            handlers={annotationHandlers}
          />
        );
      };
      return (
        <>
          {whole.length > 0 && <div className="canvas-pins canvas-flow-pins">{whole.map((a) => pin(a))}</div>}
          {onElements.length > 0 && (
            <div className="canvas-pins canvas-flow-pins" data-at="point">
              {onElements.map((a) => pin(a, { x: a.x * scale, y: a.y * scale }))}
            </div>
          )}
        </>
      );
    },
    [annotationHandlers, flowRefOf, openAnnotation, pending, visibleAnnotations],
  );
  const flowItem = flowId ? shown.find((item) => item.id === flowId) : undefined;
  /** From the flow view: the item, on the canvas, at the screen pressed. */
  const openScreen = useCallback(
    (index: number) => {
      const item = flowItem;
      setFlowId(null);
      if (!item) return;
      const path = screensOf(item)[index]?.path ?? "";
      setRoutes((was) => ({ ...was, [item.id]: index === 0 ? [] : [path] }));
      if (item.viewport && path) {
        const frame = worldRef.current?.querySelector<HTMLIFrameElement>(`iframe[data-canvas-frame="${CSS.escape(item.id)}"]`);
        if (frame?.contentWindow) postToFrame(frame.contentWindow, { type: "screen", path });
      }
      setFrontId(item.id);
      reveal([item], true);
    },
    [flowItem, reveal],
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
      // Several selected, or an item or an image: the view fits them all.
      if (viewport && multiRef.current.length) {
        const view = viewport.getBoundingClientRect();
        const { x, y, z } = camera.current;
        const rects = multiRef.current.flatMap((entry) => {
          const id = CSS.escape(entry.slice(entry.indexOf(":") + 1));
          const ref = entry.startsWith("item:") || entry.startsWith("image:") ? undefined : boardOfKey(entry);
          const element = entry.startsWith("item:")
            ? elements.current.get(entry.slice(5))
            : entry.startsWith("image:")
              ? worldRef.current?.querySelector<HTMLElement>(`[data-canvas-image="${id}"]`)
              : ref && worldRef.current?.querySelector<HTMLElement>(`[${ref.ghost ? "data-board-ghost" : "data-board-id"}="${CSS.escape(ref.id)}"]`);
          return element ? [entry.startsWith("item:") ? itemScreenRect(element) : element.getBoundingClientRect()] : [];
        });
        if (!rects.length) return;
        setCamera(
          fitBounds(
            {
              minX: (Math.min(...rects.map((r) => r.left)) - view.left - x) / z,
              minY: (Math.min(...rects.map((r) => r.top)) - view.top - y) / z,
              maxX: (Math.max(...rects.map((r) => r.right)) - view.left - x) / z,
              maxY: (Math.max(...rects.map((r) => r.bottom)) - view.top - y) / z,
            },
            viewport.clientWidth,
            viewport.clientHeight,
            FIT_PADDING,
            ZOOM_MAX,
          ),
        );
        return;
      }
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

  // First paint: apply the saved camera, or fit the first view (fitFirst) once layout
  // settles and the viewport has a real size. A tab opened in the background can
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
      fitFirstRef.current();
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
    // Leaving annotate mode drops a text edit in progress (frames drop theirs on the message below).
    if (!annotating) textEditRef.current?.finish(false);
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
  // The Hand tool turns the Space state on and off with the tool itself.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (handTool) {
      spaceArmed.current = true;
      viewport.setAttribute("data-space", "true");
    } else {
      spaceArmed.current = false;
      viewport.removeAttribute("data-space");
    }
  }, [handTool]);
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
      dropTargetRef.current(null);
      guidesRef.current(null);
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
  // A drag on empty canvas with the default tool selects what the box touches, as it is
  // drawn; with Shift it adds to what was selected. A press that never travels is the click
  // on empty canvas it always was. Not in a shared file (nothing there can move), and not
  // with Ask agent or Inspect chosen, where empty canvas still pans.
  const marqueeRef = useRef<(event: PointerEvent) => boolean>(() => false);
  marqueeRef.current = (event) => {
    const viewport = viewportRef.current;
    const box = drawRef.current;
    if (!viewport || !box || shared || annotatingRef.current || inspectToolRef.current || boardToolRef.current) return false;
    const start = { x: event.clientX, y: event.clientY };
    const base = event.shiftKey ? selection.current.selectionKeys() : [];
    let moved = false;
    let last = "";
    try {
      viewport.setPointerCapture(event.pointerId);
    } catch {
      // The pointer may already be gone.
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= DRAG_THRESHOLD) return;
      moved = true;
      viewport.setAttribute("data-gesture", "select");
      const r = { left: Math.min(start.x, e.clientX), top: Math.min(start.y, e.clientY), right: Math.max(start.x, e.clientX), bottom: Math.max(start.y, e.clientY) };
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
      box.hidden = false;
      const keys = [...new Set([...base, ...selection.current.keysIn(r)])];
      // Only a change is set: the canvas draws again for each one.
      if (keys.join("|") === last) return;
      last = keys.join("|");
      selection.current.chooseKeys(keys);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerup", end);
      viewport.removeEventListener("pointercancel", end);
      viewport.removeAttribute("data-gesture");
      box.hidden = true;
      if (moved) suppressNextClick();
      else if (e.type === "pointerup" && !event.shiftKey) tapSurfaceRef.current(e.clientX, e.clientY);
    };
    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("pointerup", end);
    viewport.addEventListener("pointercancel", end);
    return true;
  };
  // The tool turns previews and notes inert and the cursor into a crosshair (canvas.css).
  useEffect(() => {
    // Its value is the tool: a note and a section have different pointers.
    if (boardTool) viewportRef.current?.setAttribute("data-board-tool", boardTool);
    else viewportRef.current?.removeAttribute("data-board-tool");
  }, [boardTool]);
  // Several selected: each shows its outline, and none its resize grips (canvas.css).
  useEffect(() => {
    viewportRef.current?.toggleAttribute("data-multi", multi.length > 1);
  }, [multi]);
  // While a drag on empty canvas would select, the pointer there is the plain arrow, not the hand (canvas.css).
  useEffect(() => {
    viewportRef.current?.toggleAttribute("data-select", !shared && !annotating && !boardTool && !handTool && !inspectTool);
  }, [annotating, boardTool, handTool, inspectTool]);

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
      // The Hand tool keeps the canvas in its Space state after the key is let go.
      if (handToolRef.current) return;
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
      // With the default tool, a drag on empty canvas draws a selection box. Space, the middle
      // button, the wheel, and the Hand tool pan (touch too: one finger has nothing else to pan with).
      if (surface && !middle && !spacePan && marqueeRef.current(event)) return;
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
    /** With the Inspect tool, what a press on `target` would select: a whole component, or the element itself. */
    let lastTarget: { target: EventTarget | null; found: ReturnType<typeof findInspectTarget> } | null = null;
    // A move over the same element as the last one has the same answer: the outline follows the pointer cheaply.
    const inspectTarget = (target: EventTarget | null) => {
      if (lastTarget?.target !== target || !(lastTarget.found?.element.isConnected ?? true)) lastTarget = { target, found: findInspectTarget(target) };
      return lastTarget.found;
    };
    const findInspectTarget = (target: EventTarget | null) => {
      if (!designSystem || !(target instanceof Element) || target instanceof HTMLIFrameElement) return null;
      const preview = target.closest<HTMLElement>("[data-canvas-preview]");
      if (!preview || preview === target || !world.contains(preview)) return null;
      const item = items.find((entry) => entry.id === preview.dataset.canvasPreview);
      if (!item) return null;
      return { element: selectable(target, preview, designSystem, item.component), preview, item };
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
      if (!(target instanceof Element) || target.closest(".canvas-item-actions")) return null;
      const element = target.closest(".canvas-item-head")?.closest<HTMLElement>(".canvas-item");
      const item = element && items.find((entry) => entry.id === element.dataset.canvasItem);
      const preview = element?.querySelector<HTMLElement>("[data-canvas-preview]");
      return item && preview && world.contains(element) ? { item, preview } : null;
    };
    /** The section whose title is under the pointer, when a click there would annotate it. */
    const headSection = (target: EventTarget | null) => {
      const element = target instanceof Element ? target.closest(".canvas-section-tab")?.closest<HTMLElement>(".canvas-section") : null;
      if (!element) return null;
      const ghost = element.dataset.boardGhost;
      return !ghost || marksRef.current.some((m) => m.id === ghost && m.target) ? element : null;
    };

    // In annotate mode a double-click on a text edits its words in place (dom.ts
    // editText), and the edit becomes an annotation with its card open. An item
    // frame edits its own texts and sends the edit here (frameEdit is that frame).
    let frameEdit: Window | null = null;
    const inTextEdit = (target: EventTarget | null) =>
      !!textEditRef.current && target instanceof Node && textEditRef.current.element.contains(target);
    /** A press anywhere else ends a text edit and keeps it, like a click away from a field. */
    const endTextEdit = (event: Event) => {
      if (frameEdit) {
        postToFrame(frameEdit, { type: "text-edit-end" });
        frameEdit = null;
      }
      if (textEditRef.current && !inTextEdit(event.target)) textEditRef.current.finish(true);
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
      if (inTextEdit(event.target)) return hidePick();
      if (moveDraw(event)) return;
      if (inspectToolRef.current) {
        // Over the panel, its breadcrumb owns the box (inspectHighlight); anywhere else there,
        // the person is working on the selection, and the box would cover the edges they judge.
        if (event.target instanceof Element && event.target.closest(".canvas-inspect, .canvas-inspect-popover")) {
          if (!event.target.closest(".canvas-inspect-path")) hidePick();
          return;
        }
        const target = gesture.current ? null : inspectTarget(event.target);
        if (target) placeBox(pickRef.current, target.element.getBoundingClientRect());
        else hidePick();
        return;
      }
      if ((event.altKey || annotatingRef.current) && !gesture.current) {
        const head = annotatingRef.current && !event.altKey ? headItem(event.target) : null;
        const section = annotatingRef.current && !event.altKey && !head ? headSection(event.target) : null;
        if (head) placeBox(pickRef.current, head.preview.getBoundingClientRect());
        else if (section) placeBox(pickRef.current, section.getBoundingClientRect());
        else showPick(event.target);
      } else hidePick();
    };
    // In annotate mode previews stop reacting to presses, except the ones that
    // pan (Space held, middle button).
    const blockPick = (event: MouseEvent) => {
      // Presses in the text being edited place the caret or select, and reach nothing else.
      if (inTextEdit(event.target)) {
        event.stopPropagation();
        return;
      }
      // A press with Z held zooms (onPointerDown), so it must reach the canvas.
      if (zoomArmed.current) return;
      // Inspecting, a press selects (onPickClick) and the preview does not react to it.
      if (inspectToolRef.current && event.button === 0 && !spaceArmed.current && inspectTarget(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
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
      // Inside the text being edited a click follows no link and presses no button.
      if (inTextEdit(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (inspectToolRef.current && !event.altKey) {
        const target = inspectTarget(event.target);
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        // The second click of a double-click goes inside the component (onPickDoubleClick).
        if (event.detail < 2) setInspected({ element: target.element, preview: target.preview, itemId: target.item.id });
        return;
      }
      // A double-click's second click: the double-click edits the text instead (onPickDoubleClick).
      if (annotatingRef.current && !event.altKey && event.detail > 1 && pickTarget(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
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
    const onPickDoubleClick = (event: MouseEvent) => {
      // Inspecting, a double-click selects exactly what is under the pointer, inside a component too.
      if (inspectToolRef.current && !event.altKey) {
        const target = inspectTarget(event.target);
        if (!target || !(event.target instanceof Element)) return;
        event.preventDefault();
        event.stopPropagation();
        setInspected({ element: event.target, preview: target.preview, itemId: target.item.id });
        return;
      }
      // Inside the text being edited, a double-click selects a word and stays there.
      if (inTextEdit(event.target)) {
        event.stopPropagation();
        return;
      }
      if (!annotatingRef.current || event.altKey || !(event.target instanceof Element)) return;
      const pick = pickTarget(event.target);
      if (!pick) return;
      event.preventDefault();
      event.stopPropagation();
      const element = textTarget(event.target, pick.preview);
      if (!element) return;
      // The first click opened an empty note here; the edit replaces it.
      closeAnnotation();
      hidePick();
      const rect = pick.preview.getBoundingClientRect();
      const scale = rect.width / Math.max(1, pick.preview.offsetWidth);
      const x = (event.clientX - rect.left) / scale;
      const y = (event.clientY - rect.top) / scale;
      // Named before the edit, by the words as they were.
      const ref = `${pick.item.name} › ${describeElement(pick.element, pick.preview)}`;
      // New words already on show: the edit starts from them, and changes their annotation.
      const pending = pendingOf(element);
      if (pending) clearPending(pending.id);
      const id = pending?.id ?? newAnnotationId();
      textEditRef.current = editText(
        element,
        (before, after) => {
          textEditRef.current = null;
          if (after === null || (after === before && !pending) || !annotatingRef.current) {
            // Cancelled, or nothing changed: the text shows what it showed before.
            if (pending) showPending(pending.id, element, pending.words);
            return;
          }
          if (after !== before) showPending(id, element, after);
          textEdited(pick.item.id, id, x, y, ref, before, after, pending?.words);
        },
        pending?.words,
      );
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
      // Previews keep their own keys; the canvas, its toolbar, and pins take these. Not a field,
      // even one in a toolbar (a note can open under a toolbar's button), and not while the
      // flow view is open over the canvas: it has keys of its own (FlowView.tsx).
      const canvasFocus =
        !(event.target instanceof Element && typingIn(event.target)) &&
        !viewport.parentElement?.querySelector(".canvas-flow") &&
        (event.target === viewport ||
        event.target === document.body ||
        (event.target instanceof Element && event.target.closest(".canvas-toolbar, .canvas-pin-bubble") !== null) ||
        // A focused note or section itself, not the field inside a ghost.
        (event.target instanceof Element && event.target.matches(".canvas-note-card, .canvas-section-tab")));
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
      const toolKey =
        !plain || !canvasFocus || event.repeat
          ? undefined
          : { v: "interact", h: "hand", i: inspectable ? "inspect" : undefined, n: "note", s: "section" }[event.key.toLowerCase()];
      if (toolKey && (!shared || toolKey === "interact" || toolKey === "hand")) {
        event.preventDefault();
        chooseTool(toolKey as "interact" | "hand" | "inspect" | BoardKind);
        return;
      }
      // Delete or Backspace removes the selected note or section, unless a field has the keys.
      if (
        !shared &&
        plain &&
        canvasFocus &&
        (event.key === "Delete" || event.key === "Backspace") &&
        (selectedRef.current || multiRef.current.length) &&
        !openMarkRef.current &&
        !(event.target instanceof Element && typingIn(event.target))
      ) {
        event.preventDefault();
        deleteBoardRef.current();
        return;
      }
      // Inspecting: Escape lets go of the element first, then puts the tool down. Arrow Up selects the
      // element around the selection, Arrow Down the first one inside it, a component's own parts included.
      if (inspectToolRef.current && canvasFocus && !(event.target instanceof Element && typingIn(event.target))) {
        const current = inspectedRef.current;
        if (event.key === "Escape") {
          if (current) setInspected(null);
          else setInspectTool(false);
          return;
        }
        if (current && plain && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault();
          const parent = current.element.parentElement;
          const next =
            event.key === "ArrowDown"
              ? current.element.firstElementChild
              : parent && parent !== current.preview && current.preview.contains(parent)
                ? selectable(parent, current.preview, designSystem!, itemsRef.current.find((i) => i.id === current.itemId)?.component)
                : null;
          if (next) setInspected({ ...current, element: next });
          return;
        }
      }
      if (event.key === "Escape" && handToolRef.current && canvasFocus) {
        setHandTool(false);
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
      if (event.key === "Escape" && (selectedRef.current || multiRef.current.length) && !openMarkRef.current && canvasFocus) {
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
      } else if (message.type === "text-edit") {
        // A double-click in the frame: its first click's empty note goes.
        if (message.on) closeAnnotation();
        frameEdit = message.on ? frameElement.contentWindow : null;
      } else if (message.type === "annotate-text") {
        frameEdit = null;
        if (annotatingRef.current) {
          const ref = `${item.name} › ${message.label}`;
          textEdited(item.id, message.id, message.x, message.y, ref, message.before, message.after, message.was);
        } else if (frameElement.contentWindow) postToFrame(frameElement.contentWindow, { type: "text-revert", id: message.id });
      } else if (message.type === "escape") {
        if (annotatingRef.current) setAnnotateMode(false);
      } else if (message.type === "link") {
        followLink(message.href, item.id, message.blank);
      } else {
        notify(labels.formBlocked);
      }
    };

    // Previews and their portals never navigate the canvas away. Their own
    // click handlers still run; only the browser's navigation is cancelled.
    const onLinkClick = (event: MouseEvent) => {
      // A click that placed an annotation, or selected an element to inspect, was already
      // cancelled by the pick handler: it follows no link.
      if ((annotatingRef.current || inspectToolRef.current) && event.defaultPrevented) return;
      const anchor = previewLink(event);
      if (!anchor) return;
      event.preventDefault();
      if (!clickSuppressed.current)
        followLink(anchor.getAttribute("href") ?? "", anchor.closest<HTMLElement>("[data-canvas-item]")?.dataset.canvasItem, opensNewTab(anchor));
    };
    // Router mocks report programmatic navigation the same way.
    const onNavigate = (event: Event) => {
      const href = (event as CustomEvent<unknown>).detail;
      if (typeof href === "string") followLink(href);
    };
    // A router's back(): the item last touched goes to the screen it showed before.
    const onBack = () => {
      const id = frontIdRef.current;
      if (id) setRoutes((was) => (was[id]?.length ? { ...was, [id]: was[id]!.slice(0, -1) } : was));
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
    window.addEventListener("pointerdown", endTextEdit, { capture: true });
    window.addEventListener("pointerdown", blockPick, { capture: true });
    window.addEventListener("mousedown", blockPick, { capture: true });
    window.addEventListener("click", onPickClick, { capture: true });
    window.addEventListener("dblclick", onPickDoubleClick, { capture: true });
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
    window.addEventListener(BACK_EVENT, onBack);
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
      window.removeEventListener("pointerdown", endTextEdit, { capture: true });
      window.removeEventListener("pointerdown", blockPick, { capture: true });
      window.removeEventListener("mousedown", blockPick, { capture: true });
      window.removeEventListener("click", onPickClick, { capture: true });
      window.removeEventListener("dblclick", onPickDoubleClick, { capture: true });
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
      window.removeEventListener(BACK_EVENT, onBack);
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
    closeAnnotation,
    select,
    startAnnotation,
    suppressNextClick,
    textEdited,
    zoomStep,
    designSystem,
    inspectable,
  ]);

  // The grip and the name both move an item. A press that never travels past
  // the drag threshold stays a click, so clicking the name still copies it.
  const onTitlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, item: CanvasItem) => {
      const target = event.target as Element;
      if (event.button !== 0 || gesture.current || target.closest(".canvas-item-actions, .canvas-item-tag, input")) return;
      // Stops text selection while dragging; the click still fires.
      event.preventDefault();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const origin = positionsRef.current[item.id] ?? { x: item.x, y: item.y };
      const element = elements.current.get(item.id);
      // The selection: a click on the name selects the item, Shift + click adds it or takes it
      // out, and a drag of one of several selected moves them all (`group`). Not while asking
      // the agent, where a click on the name is a note on the item, or in a shared file.
      const selects = !shared && !annotatingRef.current;
      const ownKey = `item:${item.id}`;
      const shift = event.shiftKey;
      let group: ReturnType<typeof selection.current.groupOf> | null = null;
      // Alignment snapping (see snap.ts). The other previews are measured once,
      // when the drag starts: nothing else moves during it. `mine` is this item's
      // preview relative to the item's own position, which is what the drag sets.
      let others: Box[] = [];
      let mine: Box | null = null;
      const measure = () => {
        const world = worldRef.current;
        if (!world) return;
        const z = camera.current.z;
        const base = world.getBoundingClientRect();
        const boxOf = (id: string): Box | null => {
          const r = elements.current.get(id)?.querySelector("[data-canvas-preview]")?.getBoundingClientRect();
          return r ? { x: (r.left - base.left) / z, y: (r.top - base.top) / z, w: r.width / z, h: r.height / z } : null;
        };
        const own = boxOf(item.id);
        mine = own && { ...own, x: own.x - origin.x, y: own.y - origin.y };
        // What moves along is nothing to line up with.
        const along = new Set(group?.items.map((entry) => entry.id));
        others = [...elements.current.keys()].flatMap((id) => (id === item.id || along.has(id) ? [] : (boxOf(id) ?? [])));
      };
      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId || !element) return;
        let current = gesture.current;
        if (!current) {
          if (Math.hypot(move.clientX - startX, move.clientY - startY) <= DRAG_THRESHOLD) return;
          current = { kind: "move", pointerId, id: item.id, startX, startY, origin, moved: 0 };
          gesture.current = current;
          viewportRef.current?.setAttribute("data-gesture", "move");
          if (selects) {
            // Dragging an item that is not selected selects it alone, as a click on it would.
            if (multiRef.current.includes(ownKey)) group = selection.current.groupOf(ownKey);
            else selection.current.chooseKeys([ownKey]);
            // Nothing is saved until the drag ends (see `dragging`): the group moves in state on every step.
            if (group) dragging.current = true;
          }
          measure();
        }
        if (current.kind !== "move" || current.pointerId !== pointerId) return;
        const z = camera.current.z;
        current.moved = Math.abs(move.clientX - startX) + Math.abs(move.clientY - startY);
        let dx = (move.clientX - startX) / z;
        let dy = (move.clientY - startY) / z;
        // Shift keeps the drag on the axis it has travelled furthest along, as in
        // design tools; the locked axis then does not snap either.
        const free = { x: !move.shiftKey || Math.abs(dx) >= Math.abs(dy), y: !move.shiftKey || Math.abs(dy) > Math.abs(dx) };
        if (!free.x) dx = 0;
        if (!free.y) dy = 0;
        const snap = mine
          ? snapBox({ ...mine, x: origin.x + dx + mine.x, y: origin.y + dy + mine.y }, others, SNAP_DISTANCE / z, free)
          : null;
        const next = sanitizePosition({ x: origin.x + dx + (snap?.dx ?? 0), y: origin.y + dy + (snap?.dy ?? 0) });
        guidesRef.current(snap);
        element.style.transform = `translate(${next.x}px, ${next.y}px)`;
        if (group) selection.current.shiftGroup(group, next.x - origin.x, next.y - origin.y);
        else dropTargetRef.current({ ...next, w: element.offsetWidth, h: element.offsetHeight });
      };
      const onEnd = (end: PointerEvent) => {
        if (end.pointerId !== pointerId) return;
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onEnd, true);
        window.removeEventListener("pointercancel", onEnd, true);
        const current = gesture.current;
        if (current?.kind === "move" && current.pointerId === pointerId) {
          endGesture();
          if (group) {
            dragging.current = false;
            setDragEnds((n) => n + 1);
            selection.current.pruneUnchanged();
          }
        } else if (selects && end.type === "pointerup") {
          // A click that never travelled.
          if (shift) selection.current.toggleKey(ownKey);
          else selection.current.chooseKeys([ownKey]);
        }
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

  // At least one: the note being written counts as soon as it is sent from, even before the bar has counted it.
  const sendWords = useMemo(() => {
    const n = Math.max(1, unsentCount);
    return {
      // Only a listening agent's notes show these; without one a note says Done.
      label: labels.sendShort(n),
      name: labels.sendAnnotations(n),
      agentOn,
    };
  }, [agentOn, unsentCount]);
  return (
    <SendContext.Provider value={sendWords}>
    <div className="canvas-root" data-background={background === "default" ? undefined : background}>
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
          {/* Sections first, so items draw above their frame; notes and ghosts last, above everything.
              Larger sections first, so a section inside another draws above it whatever the
              registry order: a pick moves sections into "Set aside", which is added last. */}
          {sectionsByArea.map((section) => (
            <SectionView
              key={section.id}
              section={section}
              hidden={removed.has(`section:${section.id}`) || marks.some((m) => m.kind === "section" && m.target === section.id)}
              interactive={boardInteractive}
              selected={selected === `e:section:${section.id}` || multi.includes(`section:${section.id}`)}
              working={working.has(sectionKey(section.id))}
              handlers={boardHandlers}
            />
          ))}
          {images.map((image) => {
            const box = imageBoxes[image.id] ?? { x: image.x, y: image.y, w: image.width, h: image.height };
            const chosen = multi.includes(`image:${image.id}`);
            return (
              <div
                key={image.id}
                className="canvas-image"
                data-canvas-image={image.id}
                data-selected={chosen || undefined}
                data-interactive={boardInteractive || undefined}
                style={{ transform: `translate(${box.x}px, ${box.y}px)`, inlineSize: box.w, blockSize: box.h }}
                onPointerDown={(event) => boardInteractive && moveImage(event, image)}
              >
                {imageUrls[image.file] && <img src={imageUrls[image.file]} alt={labels.imageLabel} draggable={false} />}
                {boardInteractive &&
                  chosen &&
                  multi.length === 1 &&
                  IMAGE_CORNERS.map((corner) => (
                    <span key={corner} className="canvas-resize" data-corner={corner} aria-hidden="true" onPointerDown={(event) => resizeImage(event, image, corner)} />
                  ))}
              </div>
            );
          })}
          {placing.map((p) => (
            <div key={p.key} className="canvas-image" data-placing style={{ transform: `translate(${p.box.x}px, ${p.box.y}px)`, inlineSize: p.box.w, blockSize: p.box.h }}>
              <img src={p.url} alt={labels.imageLabel} draggable={false} />
            </div>
          ))}
          <LineagePaths steps={lineageSteps} world={worldRef} />
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
              pins={visibleAnnotations.flatMap((annotation) =>
                annotation.itemId === item.id
                  ? [{ annotation, number: annotation.sent || annotation.queued ? undefined : pending.indexOf(annotation) + 1 }]
                  : [],
              )}
              // While the flow view shows this item, its open note is drawn there, not twice.
              openAnnotation={flowId === item.id ? null : (openAnnotation?.id ?? null)}
              annotationHandlers={annotationHandlers}
              onTrash={shared ? undefined : moveToTrash}
              onCopyName={shared ? undefined : copyReference}
              onAsk={shared ? undefined : askItem}
              onStartHere={shared ? undefined : startHere}
              route={routes[item.id]?.[routes[item.id]!.length - 1]}
              onRestart={restartRoute}
              onFlow={openFlow}
              onPickVersion={!shared && !annotating && !setAsideIds.has(item.id) ? pickVersion : undefined}
              onUnpick={!shared && !annotating ? unpickVersion : undefined}
              picked={picks[item.id] ?? !!item.picked}
              move={(() => {
                const moved = movedItems.find((m) => m.id === item.id);
                return moved ? moveStateOf(moved) : undefined;
              })()}
              onUndoMove={undoMove}
              caption={captions[item.id] ?? item.note}
              editable={!shared}
              onCaption={saveCaption}
              working={working.has(item.id)}
              agentWorking={agentHandling}
              fresh={fresh[item.id]}
              selected={multi.includes(`item:${item.id}`)}
            />
          ))}
          {notes.map((note) => (
            <NoteView
              key={note.id}
              note={note}
              hidden={removed.has(`note:${note.id}`) || marks.some((m) => m.kind === "note" && m.target === note.id)}
              interactive={boardInteractive}
              selected={selected === `e:note:${note.id}` || multi.includes(`note:${note.id}`)}
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
              selected={selected === `g:${mark.kind}:${mark.id}` || multi.includes(mark.target ? `${mark.kind}:${mark.target}` : `mark:${mark.id}`)}
              agentWorking={agentHandling}
              handlers={boardHandlers}
              onText={markHandlers.onText}
              onClose={markHandlers.onClose}
              onDelete={markHandlers.onDelete}
            />
          ))}
          {/* Notes on whole sections, above items and notes so the open one is never covered, at the section's top-left corner (its ghost's while it moves). */}
          {visibleAnnotations.map((annotation) => {
            const id = sectionOf(annotation);
            const section = id !== null && !removed.has(`section:${id}`) ? sections.find((s) => s.id === id) : undefined;
            if (!section) return null;
            const mark = marks.find((m) => m.kind === "section" && m.target === section.id);
            return (
              <div
                key={annotation.id}
                className="canvas-section-pins"
                data-section={section.id}
                style={{ transform: `translate(${mark?.x ?? section.x}px, ${mark?.y ?? section.y}px)` }}
              >
                <AnnotationPin
                  annotation={annotation}
                  number={annotation.sent || annotation.queued ? undefined : pending.indexOf(annotation) + 1}
                  open={openAnnotation?.id === annotation.id}
                  handlers={annotationHandlers}
                />
              </div>
            );
          })}
          <div ref={guideVRef} className="canvas-guide" data-guide="vertical" hidden aria-hidden="true" />
          <div ref={guideHRef} className="canvas-guide" data-guide="horizontal" hidden aria-hidden="true" />
        </div>
      </div>
      <div ref={pickRef} className="canvas-pick" hidden aria-hidden="true" />
      <div ref={drawRef} className="canvas-draw" hidden aria-hidden="true" />
      <div ref={sizeTipRef} className="canvas-size-tip" hidden aria-hidden="true" />
      {/* Controls in two places, where designers expect them (as in FigJam): the tools at the bottom
          centre, and everything else in one bar at the top right. What the canvas tells the person is at
          the top centre (see canvas-messages below). The tools bar comes first: item reveals measure the
          first bar for the bottom margin. */}
      <div className="canvas-toolbar" data-place="tools" role="toolbar" aria-label={labels.toolsBar}>
          {/* One tool at a time. Interact is the default; Escape or V returns to it. */}
          <button
            type="button"
            className="canvas-button canvas-icon-button"
            aria-pressed={!annotating && !boardTool && !handTool && !inspectTool}
            aria-label={labels.interactTool}
            data-tip={labels.interactToolHint}
            onClick={() => chooseTool("interact")}
          >
            <SelectIcon />
          </button>
          <button
            type="button"
            className="canvas-button canvas-icon-button"
            aria-pressed={handTool}
            aria-label={labels.handTool}
            data-tip={labels.handToolHint}
            onClick={() => chooseTool("hand")}
          >
            <HandIcon />
          </button>
          {inspectable && (
            <button
              type="button"
              className="canvas-button canvas-icon-button"
              aria-pressed={inspectTool}
              aria-label={labels.inspectTool}
              data-tip={labels.inspectToolHint}
              onClick={() => chooseTool("inspect")}
            >
              <InspectIcon />
            </button>
          )}
          {!shared && (<>
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
          </>)}
      </div>
      {/* Everything but the tools, in one bar at the top right: the view (zoom), the app's themes, the
          trash while it holds something, the settings and controls, and Share last, at the corner, the
          one control that is about other people. The trash comes and goes at its group's left end, so
          Share and the gear never move. */}
      <div className="canvas-toolbar" data-place="top" role="toolbar" aria-label={labels.canvasBar}>
        <ZoomMenu
          level="100%"
          levelRef={zoomLabelRef}
          onZoomIn={() => zoomStep(1)}
          onZoomOut={() => zoomStep(-1)}
          onFit={fitAll}
          onActual={resetCamera}
        />
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
        {!shared && trashedItems.length > 0 && (
          <TrashButton
            buttonRef={trashButtonRef}
            count={trashedItems.length}
            open={trashOpen}
            onClick={() => {
              // One of the trash, the share panel, and a notice at a time: they open in the same corner.
              setToast(null);
              setShareOpen(false);
              setTrashOpen((open) => !open);
            }}
          />
        )}
        <CanvasMenu background={background} onBackground={setBackground} />
        {!shared && (
          <>
            <span className="canvas-separator" aria-hidden="true" />
            <ShareButton
              buttonRef={shareButtonRef}
              busy={sharing}
              open={shareOpen}
              onClick={() => {
                // One of the share panel, the trash, and a notice at a time: they open in the same corner.
                if (!shareOpen) {
                  window.clearTimeout(toastTimer.current);
                  setToast(null);
                  setTrashOpen(false);
                }
                setShareOpen((open) => !open);
              }}
            />
          </>
        )}
      </div>
      {/* The one place the canvas tells the person something: the changes waiting for the agent, and
          under them a notice for a few seconds. A notice never hides the bar: it often points at it
          ("1 isn't sent yet"), and "Copied" then shows right under the button that copied. */}
      <div className="canvas-messages">
        {/* Only while something is still to apply: the one place to apply or drop every change, so it is hard to miss.
            What the agent is working on says so with a tag on each object instead. */}
        {!shared && unsentCount > 0 && (
          <div className="canvas-toolbar" data-place="pending" role="group" aria-label={labels.changesBar}>
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
            <button
              type="button"
              className="canvas-button canvas-button-primary"
              data-tip={agentOn ? undefined : labels.copyTip}
              onClick={() => void sendAnnotations()}
            >
              {agentOn ? <SendIcon /> : <CopyIcon />}
              {agentOn ? labels.sendAnnotations(unsentCount) : labels.copyAnnotations(unsentCount)}
            </button>
          </div>
        )}
        {toast && <ToastView toast={toast} onClose={() => setToast(null)} />}
      </div>
      {shareOpen && (
        <SharePanel
          scopes={shareScopes}
          whole={shareContents(null).items}
          busy={sharing}
          onDownload={(section) => void share(section)}
          onClose={closeSharePanel}
        />
      )}
      {flowItem && (
        <FlowView
          item={flowItem}
          current={Math.max(0, screenIndex(flowItem, routes[flowItem.id]?.[routes[flowItem.id]!.length - 1] ?? flowItem.start ?? ""))}
          learned={steps[flowItem.id] ?? NO_STEPS}
          onOpen={openScreen}
          onAsk={shared ? undefined : (index, state) => askFlow(flowItem, index, state)}
          onAskElement={shared ? undefined : (index, described, x, y, state) => askFlowElement(flowItem, index, described, x, y, state)}
          pinsFor={(index, scale, state) => flowPins(flowItem, index, scale, state)}
          noteOpen={!!openAnnotation && openAnnotation.original.itemId === flowItem.id}
          onCloseNote={annotationHandlers.onSave}
          onClose={closeFlow}
        />
      )}
      {inspectTool && designSystem && (
        <InspectPanel
          system={designSystem}
          selection={inspected}
          stop={items.find((item) => item.id === inspected?.itemId)?.component}
          changed={inspectChanged}
          onSelect={(element: Element) => setInspected((current) => (current ? { ...current, element } : current))}
          onEdit={inspectEdit}
          onPreview={inspectPreview}
          onHighlight={inspectHighlight}
          onResetAll={inspectResetAll}
        />
      )}
      {!shared && trashOpen && (
        <TrashDialog
          items={trashedItems}
          times={trashedAt.current}
          onClose={closeTrash}
          onSetAside={(item) => void setAsideFromTrash(item)}
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
    </SendContext.Provider>
  );
}
