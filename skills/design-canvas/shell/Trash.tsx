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
import { type CSSProperties, type Dispatch, type Ref, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** Room for a thumbnail inside its border. */
const THUMB_WIDTH = 154;
const THUMB_HEIGHT = 98;

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
  /** Changes the list only. The board's save of it is `useTrash`'s work. */
  const set = useCallback((next: string[]) => {
    idsRef.current = next;
    setIds(next);
  }, []);
  return { ids, idsRef, kept, set };
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
  const { ids, idsRef, kept, set } = list;
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

  /** Back on the canvas where it was, or beside its row if that spot was taken meanwhile. */
  const restore = useCallback(
    (item: CanvasItem) => {
      setTrash(idsRef.current.filter((id) => id !== item.id));
      setFrontId(item.id);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          placeFree([item], { besideOrigin: false });
          reveal([item]);
        }),
      );
    },
    [idsRef, placeFree, reveal, setFrontId, setTrash],
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
      beforeTrash(item);
      setTrash([item.id, ...idsRef.current.filter((id) => id !== item.id)]);
      saveTrashed(item, true);
      setFrontId((front) => (front === item.id ? null : front));
      // The button that had focus is gone with its item.
      viewportRef.current?.focus({ preventScroll: true });
      notify(labels.movedToTrash(item.name), { label: labels.undo, run: () => putBack(item) });
    },
    [beforeTrash, idsRef, notify, putBack, saveTrashed, setFrontId, setTrash, viewportRef],
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
    if (into.length) setTrash([...into, ...idsRef.current]);
    for (const item of items) if (!inTrash(item) && idsRef.current.includes(item.id)) restore(item);
  }, [idsRef, items, kept, restore, setTrash, checks]);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  }, []);
  // The trash closes on a press outside it, and when it has nothing left.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".canvas-trash-popover, .canvas-trash-button")) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  useEffect(() => {
    if (!trashedItems.length) setOpen(false);
  }, [trashedItems.length]);

  return { trashedItems, open, setOpen, buttonRef, close, putBack, moveToTrash };
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
export function TrashPopover({
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
