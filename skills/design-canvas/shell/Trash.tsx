// The trash: items the person took off the canvas, and how they come back.
//
// The trash hides items on the canvas only; their code stays in the registry,
// so any of them can be put back. Most recently trashed first. On the dev server
// the registry holds it (`trashed`), written only when the person moves an item in
// or out, so a shared file, the next session, and every open tab show the same
// trash, and no tab overwrites another. The browser keeps the order, the items the
// registry could not take, and, from an older shell, a trash it had only here,
// written into the registry once (see SavedTrash). A shared file cannot write, so
// it starts from the registry and keeps what a viewer changes in the browser.
//
// It is two hooks because the board needs the list before it can make what the
// actions use: which items are shown decides where an item that is put back finds
// free space. `useTrashList` is the list; `useTrash` is what the person does with it.
import { type Dispatch, Fragment, type Ref, type SetStateAction, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { frameSource, shared } from "./bridge";
import { EDIT_PATH } from "./channel.ts";
import { Icon } from "./icons";
import { labels } from "./labels";
import type { SavedTrash } from "./layout";
import { Preview } from "./Preview";
import type { DirectEdit } from "./registry-edit.ts";
import type { CanvasItem } from "./types";

/**
 * How long a trash write the registry took may still hide what the registry says.
 * Its own update arrives well within it; after it, a change made in source right
 * after the write (by the agent or another tab) shows instead of staying hidden.
 */
const TRASH_WRITE_GRACE = 3000;

/**
 * Which items are in the trash. `saved` is what this browser kept (layout.ts), and
 * `visited` says it has a saved layout at all, which in a shared file means the
 * viewer's own trash is used instead of the registry's.
 */
export function useTrashList(items: CanvasItem[], saved: SavedTrash, visited: boolean) {
  const [ids, setIds] = useState<string[]>(() => {
    const inRegistry = items.filter((item) => item.trashed).map((item) => item.id);
    if (shared) return visited ? saved.ids : inRegistry;
    const member = new Set([...inRegistry, ...saved.kept, ...(saved.inRegistry ? [] : saved.ids)]);
    return [...new Set([...saved.ids.filter((id) => member.has(id)), ...member])];
  });
  const idsRef = useRef(ids);
  /** Items whose `trashed` the registry could not take, so their place in the trash is kept in this browser. */
  const kept = useRef(new Set(saved.kept));
  /** When this browser saw each item go to the trash (SavedTrash `at`). Saved with the layout. */
  const times = useRef<Record<string, number>>({ ...saved.at });
  /** Changes the list only. The board's save of it is `useTrash`'s work. */
  const set = useCallback((next: string[]) => {
    idsRef.current = next;
    setIds(next);
  }, []);
  return { ids, idsRef, kept, times, set };
}
export type TrashList = ReturnType<typeof useTrashList>;

/** What the trash uses of the board. */
type TrashBoard = {
  items: CanvasItem[];
  itemsRef: { readonly current: CanvasItem[] };
  saved: SavedTrash;
  /** Saves the layout, the trash with it, once the person pauses. */
  queueSave: () => void;
  placeFree: (targets: CanvasItem[], options: { besideOrigin: boolean }) => void;
  reveal: (targets: CanvasItem[]) => void;
  setFrontId: Dispatch<SetStateAction<string | null>>;
  notify: (text: string, action?: { label: string; run: () => void }) => void;
  /** Called as an item goes to the trash, while it is still on the canvas. */
  beforeTrash: (item: CanvasItem) => void;
  viewportRef: { readonly current: HTMLElement | null };
};

/** Moving items into and out of the trash, keeping it the same as the registry, and its list in the top bar. */
export function useTrash(list: TrashList, board: TrashBoard) {
  const { ids, idsRef, kept, times, set } = list;
  const { items, itemsRef, saved, queueSave, placeFree, reveal, setFrontId, notify, beforeTrash, viewportRef } = board;
  const trashedItems = useMemo(() => ids.flatMap((id) => items.find((item) => item.id === id) ?? []), [items, ids]);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const setTrash = useCallback(
    (next: string[]) => {
      set(next);
      queueSave();
    },
    [queueSave, set],
  );

  /**
   * Writes `trashed` into the registry for an item the person moved into or out of
   * the trash. Until the registry has it, the canvas shows it as made; what the
   * registry cannot take stays in this browser instead.
   */
  const pendingWrites = useRef(new Map<string, boolean>());
  const [checks, setChecks] = useState(0);
  const saveTrashed = useCallback(
    (item: CanvasItem, want: boolean) => {
      if (shared) return;
      if (!want && kept.current.delete(item.id)) queueSave();
      const registered = itemsRef.current.find((entry) => entry.id === item.id);
      if (!registered) return;
      // A write the other way may still be on its way, as after a quick Undo: this one must follow it.
      const pending = pendingWrites.current.get(item.id);
      if (pending === want || (pending === undefined && !!registered.trashed === want)) return;
      pendingWrites.current.set(item.id, want);
      const refused = () => {
        // A put back the registry refused stays put back until the page closes.
        if (!want || pendingWrites.current.get(item.id) !== want) return;
        pendingWrites.current.delete(item.id);
        kept.current.add(item.id);
        queueSave();
      };
      const edit: DirectEdit = { kind: "item", id: item.id, set: { trashed: want } };
      fetch(EDIT_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ edits: [edit] }) })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`edit ${response.status}`))))
        .then((result: { missing?: unknown }) => {
          if (Array.isArray(result.missing) && result.missing.includes(item.id)) return refused();
          window.setTimeout(() => {
            if (pendingWrites.current.get(item.id) !== want) return;
            pendingWrites.current.delete(item.id);
            setChecks((n) => n + 1);
          }, TRASH_WRITE_GRACE);
        })
        .catch(refused);
    },
    [itemsRef, kept, queueSave],
  );

  /** Out of the trash list, placed nowhere yet. */
  const leave = useCallback(
    (item: CanvasItem) => {
      delete times.current[item.id];
      setTrash(idsRef.current.filter((id) => id !== item.id));
    },
    [idsRef, setTrash, times],
  );
  /** Back on the canvas where it was, or beside its row if that spot was taken meanwhile. */
  const restore = useCallback(
    (item: CanvasItem) => {
      leave(item);
      setFrontId(item.id);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          placeFree([item], { besideOrigin: false });
          reveal([item]);
        }),
      );
    },
    [leave, placeFree, reveal, setFrontId],
  );
  const putBack = useCallback(
    (item: CanvasItem) => {
      restore(item);
      saveTrashed(item, false);
    },
    [restore, saveTrashed],
  );
  /** Out of the trash, for the board to place: Set aside puts it in the "Set aside" frame (Canvas.tsx). */
  const takeOut = useCallback(
    (item: CanvasItem) => {
      leave(item);
      saveTrashed(item, false);
    },
    [leave, saveTrashed],
  );
  const moveToTrash = useCallback(
    // `quiet`: one of several going at once, which get one notice and one Undo between them (Canvas.tsx, deleteGroup).
    (item: CanvasItem, quiet = false) => {
      beforeTrash(item);
      times.current[item.id] = Date.now();
      setTrash([item.id, ...idsRef.current.filter((id) => id !== item.id)]);
      saveTrashed(item, true);
      setFrontId((front) => (front === item.id ? null : front));
      // The button that had focus is gone with its item.
      viewportRef.current?.focus({ preventScroll: true });
      if (!quiet) notify(labels.movedToTrash(item.name), { label: labels.undo, run: () => putBack(item) });
    },
    [beforeTrash, idsRef, notify, putBack, saveTrashed, setFrontId, setTrash, times, viewportRef],
  );

  // A trash an older shell kept only in this browser goes into the registry, once.
  const movedOldTrash = useRef(false);
  useEffect(() => {
    if (shared || saved.inRegistry || movedOldTrash.current) return;
    movedOldTrash.current = true;
    for (const id of saved.ids) {
      const item = itemsRef.current.find((entry) => entry.id === id);
      if (item) saveTrashed(item, true);
    }
    queueSave();
  }, [itemsRef, queueSave, saveTrashed, saved]);
  // The trash follows the registry: a write landing, or `trashed` changed by the agent or another tab.
  useEffect(() => {
    if (shared) return;
    const inTrash = (item: CanvasItem) => {
      const pending = pendingWrites.current.get(item.id);
      if (pending !== undefined && pending !== !!item.trashed) return pending;
      pendingWrites.current.delete(item.id);
      return !!item.trashed || kept.current.has(item.id);
    };
    const into = items.filter((item) => inTrash(item) && !idsRef.current.includes(item.id)).map((item) => item.id);
    // Trashed in source while the canvas is open: that is when it left the canvas.
    for (const id of into) times.current[id] ??= Date.now();
    if (into.length) setTrash([...into, ...idsRef.current]);
    for (const item of items) if (!inTrash(item) && idsRef.current.includes(item.id)) restore(item);
  }, [idsRef, items, kept, restore, setTrash, times, checks]);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  }, []);
  // The trash closes on a press outside it (on the dimmed canvas), and when it has nothing left.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".canvas-trash-dialog, .canvas-trash-button")) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  useEffect(() => {
    if (!trashedItems.length) setOpen(false);
  }, [trashedItems.length]);

  return { trashedItems, times, open, setOpen, buttonRef, close, putBack, takeOut, moveToTrash };
}

/** In the top bar while the trash holds something: how many items, and a press opens the list. */
export function TrashButton({
  buttonRef,
  count,
  open,
  onClick,
}: {
  buttonRef: Ref<HTMLButtonElement>;
  count: number;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="canvas-button canvas-trash-button"
      aria-label={labels.trash(count)}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? "canvas-trash" : undefined}
      data-tip={labels.trashHeading}
      onClick={onClick}
    >
      <Icon name="trash" />
      {count}
    </button>
  );
}


/**
 * Lets a few previews draw at a time, in the trash's order. Every `viewport` preview boots
 * the whole app in its own frame on the page's one main thread: nine at once all showed
 * after about 2 s in a real canvas, while two at a time showed the first after 0.4 s and
 * the rest one after another, for about the same total. Paused while a card is open
 * large, so that one loads first.
 */
type DrawQueue = {
  request: (order: number, start: () => void) => () => void;
  release: () => void;
  pause: (paused: boolean) => void;
};
function useDrawQueue(limit: number): DrawQueue {
  return useMemo(() => {
    const waiting: { order: number; start: () => void }[] = [];
    let active = 0;
    let paused = false;
    const pump = () => {
      while (!paused && active < limit && waiting.length) {
        active += 1;
        waiting.shift()?.start();
      }
    };
    return {
      request(order, start) {
        const entry = { order, start };
        const at = waiting.findIndex((other) => other.order > order);
        waiting.splice(at === -1 ? waiting.length : at, 0, entry);
        pump();
        return () => {
          const index = waiting.indexOf(entry);
          if (index !== -1) waiting.splice(index, 1);
        };
      },
      release() {
        active = Math.max(0, active - 1);
        pump();
      },
      pause(next) {
        paused = next;
        pump();
      },
    };
  }, [limit]);
}

/** A preview that never says it has loaded still lets the next one start after this long. */
const DRAW_TIMEOUT = 4000;

/**
 * A trashed item drawn live at its real size, scaled down to fit its stage. It mounts only
 * once the stage has a size, and, in the grid, once the stage scrolls into view and the
 * queue gives it a turn.
 *
 * A thumbnail is inert: it is for looking, and takes no focus or clicks. An opened card is
 * `usable`: the person can try it before putting it back. It is then always the item's own
 * page in a frame (in=page), as Open in new tab shows it, so its links and router calls stay
 * in it and nothing it does reaches the canvas behind. The canvas only listens to the frames
 * of items on the board.
 */
function TrashStage({
  item,
  padding,
  lazyRoot,
  queue,
  order = 0,
  usable = false,
}: {
  item: CanvasItem;
  padding: number;
  lazyRoot?: { readonly current: Element | null };
  queue?: DrawQueue;
  order?: number;
  usable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [seen, setSeen] = useState(!lazyRoot);
  const [turn, setTurn] = useState(!queue);
  const framed = usable || !!item.viewport;
  // A frame is blank until its page has loaded; the stage shows its own background meanwhile.
  const [loaded, setLoaded] = useState(!framed);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setSize({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = ref.current;
    if (seen || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { root: lazyRoot?.current, rootMargin: "120px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [lazyRoot, seen]);
  // Waits for a turn once in view; gives it back once drawn, or when it goes.
  useEffect(() => {
    if (!queue || !seen || turn) return;
    return queue.request(order, () => setTurn(true));
  }, [queue, seen, turn, order]);
  // The turn goes back exactly once: when drawn, after DRAW_TIMEOUT, or when the stage goes.
  const holding = useRef(false);
  const giveBack = useRef(() => {});
  giveBack.current = () => {
    if (!holding.current) return;
    holding.current = false;
    queue?.release();
  };
  useEffect(() => {
    if (!queue || !turn) return;
    holding.current = true;
    const timer = window.setTimeout(() => giveBack.current(), DRAW_TIMEOUT);
    return () => window.clearTimeout(timer);
  }, [queue, turn]);
  // A component draws as it mounts; a frame once its page has loaded.
  useEffect(() => {
    if (!turn || !loaded) return;
    const frame = requestAnimationFrame(() => giveBack.current());
    return () => cancelAnimationFrame(frame);
  }, [turn, loaded]);
  useEffect(() => () => giveBack.current(), []);
  // An attribute, not a prop: React 18 and 19 write the `inert` prop differently.
  const inert = useCallback((element: HTMLElement | null) => {
    if (!usable) element?.setAttribute("inert", "");
  }, [usable]);
  const scale = size ? Math.min((size.w - padding * 2) / item.width, (size.h - padding * 2) / item.height, 1) : 0;
  return (
    <div ref={ref} className="canvas-trash-stage" aria-hidden={usable ? undefined : "true"} data-usable={usable ? "" : undefined}>
      {seen && turn && scale > 0 && (
        <div
          className="canvas-trash-scaled"
          data-loading={loaded ? undefined : ""}
          style={{ inlineSize: item.width * scale, blockSize: item.height * scale }}
        >
          <div
            ref={inert}
            className="canvas-trash-real"
            style={{ inlineSize: item.width, blockSize: item.height, transform: `scale(${scale})` }}
          >
            {framed ? (
              <iframe
                className="canvas-frame"
                {...frameSource(item.id, "page")}
                title={item.name}
                width={item.width}
                height={item.height}
                tabIndex={usable ? undefined : -1}
                onLoad={() => setLoaded(true)}
              />
            ) : (
              <Preview component={item.component} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type TrashGroup = { label: string; items: CanvasItem[] };

/**
 * The trash in the order things went in, most recent first, under Today, Yesterday,
 * and Earlier. An item with no time (trashed in another browser, or before the canvas
 * kept times) stays in its place in the order, so it joins the group above it.
 */
function groupByDay(items: CanvasItem[], times: Record<string, number>, now = new Date()): TrashGroup[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const groups: TrashGroup[] = [];
  for (const item of items) {
    const at = times[item.id];
    const label =
      at === undefined
        ? (groups.at(-1)?.label ?? labels.trashEarlier)
        : at >= startOfToday
          ? labels.trashToday
          : at >= startOfYesterday
            ? labels.trashYesterday
            : labels.trashEarlier;
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/** When an item went in, as its row says it: the time today and yesterday, the date before. */
function trashedWhen(at: number | undefined, group: string) {
  if (at === undefined) return "";
  const date = new Date(at);
  return group === labels.trashEarlier
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * The trash, over the dimmed canvas. Names alone, and small pictures alone, often cannot
 * tell versions apart, so the way to choose is to look at them large, one after another.
 * Nothing is put back on a single click: putting one back moves the view to it.
 *
 * - Every item is a card with a live thumbnail, under Today, Yesterday, and Earlier, drawn
 *   a few at a time from the top (useDrawQueue).
 * - A click opens the card large over the grid, with Previous and Next (and the arrow keys)
 *   to go through the others at that size, and Put back.
 * - Back (or Escape) returns to the grid as it was: it stays drawn under the open card, so
 *   it keeps its scroll, and it scrolls to and marks the card last looked at, so the person
 *   knows where they were.
 * - Set aside, beside Put back, takes the item out into the "Set aside" frame a pick fills,
 *   for a person who dropped versions one by one instead of picking. The trash stays open on
 *   the next item, so they can go on through it; Put back closes it and shows the item.
 */
export function TrashDialog({
  items,
  times,
  onPutBack,
  onSetAside,
  onClose,
}: {
  items: CanvasItem[];
  times: Record<string, number>;
  onPutBack: (item: CanvasItem) => void;
  onSetAside: (item: CanvasItem) => void;
  onClose: () => void;
}) {
  const groups = useMemo(() => groupByDay(items, times), [items, times]);
  const [currentId, setCurrentId] = useState(items[0]?.id);
  // The card open or last opened. If it leaves the trash meanwhile (the agent put it back), the first one is.
  const current = items.find((item) => item.id === currentId) ?? items[0];
  const index = current ? items.indexOf(current) : -1;
  const [open, setOpen] = useState(false);
  /** The person has come back from a card, so the grid marks it. */
  const [returned, setReturned] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const queue = useDrawQueue(2);
  // The open card loads first.
  useEffect(() => queue.pause(open), [queue, open]);
  // The grid stays drawn under an open card, so going back is instant and keeps its scroll; it takes no focus meanwhile.
  useEffect(() => {
    gridRef.current?.toggleAttribute("inert", open);
  }, [open]);

  // Focus goes to Put back on an open card, and back to the card the person was on.
  useEffect(() => {
    const root = dialogRef.current;
    if (!root || !current) return;
    const target = open
      ? root.querySelector<HTMLElement>(".canvas-trash-put-back")
      : root.querySelector<HTMLElement>(`.canvas-trash-card[data-trash-id="${CSS.escape(current.id)}"] .canvas-trash-card-name`);
    target?.focus({ preventScroll: true });
    if (!open) target?.closest(".canvas-trash-card")?.scrollIntoView({ block: "nearest" });
    // Only as a card opens or closes: focus never jumps while the person goes through them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const step = (by: number) => {
    const item = items[index + by];
    if (item) setCurrentId(item.id);
  };
  const back = () => {
    setOpen(false);
    setReturned(true);
  };

  return (
    <div className="canvas-trash">
      <div
        ref={dialogRef}
        id="canvas-trash"
        className="canvas-trash-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={labels.trashHeading}
        // A press on its empty space keeps focus in the trash, so Esc still closes it.
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (open) back();
            else onClose();
            return;
          }
          if (open && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            event.preventDefault();
            step(event.key === "ArrowLeft" ? -1 : 1);
            return;
          }
          // Tab stays inside the trash while it is open.
          if (event.key !== "Tab") return;
          const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button") ?? [])].filter(
            (element) => !element.closest("[inert]"),
          );
          const first = focusable[0];
          const last = focusable.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="canvas-trash-head">
          <h2 className="canvas-trash-title">{labels.trashHeading}</h2>
          <span className="canvas-trash-count">{labels.trashCount(items.length)}</span>
          <button type="button" className="canvas-button canvas-icon-button" aria-label={labels.closeTrash} data-tip={labels.closeTrash} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="canvas-trash-body">
          <div ref={gridRef} className="canvas-trash-grid">
            {groups.map((group) => (
              <Fragment key={group.label}>
                <div className="canvas-trash-group-label">{group.label}</div>
                {group.items.map((item) => (
                  <div
                    key={item.id}
                    className="canvas-trash-card"
                    data-trash-id={item.id}
                    data-current={returned && item.id === current?.id ? "" : undefined}
                  >
                    <TrashStage item={item} padding={10} lazyRoot={gridRef} queue={queue} order={items.indexOf(item)} />
                    {/* The name is the button; its hit area covers the whole card. */}
                    <button
                      type="button"
                      className="canvas-trash-card-name"
                      onClick={() => {
                        setCurrentId(item.id);
                        setOpen(true);
                      }}
                    >
                      <span>{item.name}</span>
                      <span className="canvas-trash-time">{trashedWhen(times[item.id], group.label)}</span>
                    </button>
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
          {open && current && (
            <section className="canvas-trash-detail" aria-label={current.name}>
              <div className="canvas-trash-detail-head">
                <button type="button" className="canvas-button canvas-icon-button" aria-label={labels.trashAll} data-tip={labels.trashAll} onClick={back}>
                  <Icon name="arrow-left" />
                </button>
                <span className="canvas-trash-detail-name">{current.name}</span>
                {/* Not a disabled button at the ends: pressing it would drop focus, and Escape with it. */}
                {items.length > 1 && (
                  <div className="canvas-trash-steps" role="group" aria-label={labels.trashPosition(index + 1, items.length)}>
                    <span className="canvas-trash-position" aria-hidden="true">
                      {index + 1} / {items.length}
                    </span>
                    <button
                      type="button"
                      className="canvas-button canvas-icon-button"
                      aria-label={labels.trashPrevious}
                      data-tip={labels.trashPrevious}
                      aria-disabled={index <= 0 || undefined}
                      onClick={() => step(-1)}
                    >
                      <Icon name="chevron-left" />
                    </button>
                    <button
                      type="button"
                      className="canvas-button canvas-icon-button"
                      aria-label={labels.trashNext}
                      data-tip={labels.trashNext}
                      aria-disabled={index >= items.length - 1 || undefined}
                      onClick={() => step(1)}
                    >
                      <Icon name="chevron-right" />
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className="canvas-button"
                  aria-label={labels.setAsideFromTrash(current.name)}
                  data-tip={labels.setAsideFromTrashHint}
                  onClick={() => {
                    // The next item takes its place, or the one before it at the end.
                    const next = items[index + 1] ?? items[index - 1];
                    if (next) setCurrentId(next.id);
                    onSetAside(current);
                  }}
                >
                  {labels.setAside}
                </button>
                <button
                  type="button"
                  className="canvas-button canvas-button-primary canvas-trash-put-back"
                  aria-label={labels.putBack(current.name)}
                  onClick={() => onPutBack(current)}
                >
                  {labels.putBackShort}
                </button>
              </div>
              {/* A new stage for each item: the last one's frame never shows under the next one's name. */}
              <TrashStage key={current.id} item={current} padding={24} usable />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
