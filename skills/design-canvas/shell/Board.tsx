// Notes and sections as they appear on the canvas: the real ones from the
// registry, and the ghosts of marks the person has added or changed but the
// agent has not applied yet. Ghosts are dashed and tagged so an unapplied change
// cannot be mistaken for content, and nobody forgets to send it.
//
// Moving, resizing, and editing text are the same gestures for both. They start
// here and run in Canvas.tsx, which owns the camera and the marks.

import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef } from "react";
import { type BoardKind, type BoardMark, NOTE_WIDTH } from "./marks";
import { labels } from "./labels";
import type { CanvasNote, CanvasSection } from "./types";

export type Corner = "nw" | "ne" | "sw" | "se";
/** What a resize pulls: a corner changes both sides it touches, an edge only its own. */
export type BoardEdge = Corner | "n" | "e" | "s" | "w";
/** A real note or section (`ghost` false) or the ghost of a mark. */
export type BoardRef = { kind: BoardKind; id: string; ghost: boolean };
export type BoardHandlers = {
  select: (ref: BoardRef | null) => void;
  move: (event: ReactPointerEvent<HTMLElement>, ref: BoardRef) => void;
  resize: (event: ReactPointerEvent<HTMLElement>, ref: BoardRef, edge: BoardEdge) => void;
  edit: (ref: BoardRef) => void;
  nudge: (ref: BoardRef, dx: number, dy: number) => void;
};

const NUDGE = 8;

/**
 * The button after "Not applied yet" on every pending change: a note, a section,
 * an item's move. One icon and one name, since all of them mean the same thing:
 * drop this change and go back to what the registry has (for a new one, nothing).
 */
export function DiscardButton({ onClick, keepFocus = false }: { onClick: () => void; keepFocus?: boolean }) {
  return (
    <button
      type="button"
      className="canvas-ghost-delete"
      aria-label={labels.discardChange}
      data-tip={labels.discardChange}
      // A ghost's field would blur first and close the mark; the press itself does the same job.
      onPointerDown={keepFocus ? (event) => event.preventDefault() : undefined}
      onClick={onClick}
    >
      <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 3 2.5 5.5 5 8" />
        <path d="M2.5 5.5H8a3.5 3.5 0 0 1 0 7H5" />
      </svg>
    </button>
  );
}
const place = (x: number, y: number) => `translate(${x}px, ${y}px)`;
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];

/** Arrow keys move the focused note or section, Enter edits it, like an item's grip. */
function onKey(event: KeyboardEvent<HTMLElement>, ref: BoardRef, handlers: BoardHandlers) {
  if (event.target !== event.currentTarget) return;
  const step = event.shiftKey ? NUDGE * 8 : NUDGE;
  const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
  if (delta) {
    event.preventDefault();
    event.stopPropagation();
    handlers.nudge(ref, delta[0]!, delta[1]!);
  } else if (event.key === "Enter") {
    event.preventDefault();
    handlers.edit(ref);
  }
}

/** The same grip an item's name has, so a section's tab reads as something to pull. */
function Grip() {
  return (
    <svg className="canvas-section-grip" viewBox="0 0 10 14" width="8" height="12" aria-hidden="true">
      {[2, 8].flatMap((x) => [2, 7, 12].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" fill="currentColor" />))}
    </svg>
  );
}

const BORDER: BoardEdge[] = ["n", "e", "s", "w", ...CORNERS];

/**
 * Notes and sections resize from their border the way items do, like an OS
 * window: invisible grab zones on every edge and corner, where only the cursor
 * changes. No selection is needed first, so one rule covers everything on the
 * canvas. A section's border only resizes it, never moves it: a stray press
 * there changes the frame alone, not the items inside, and ⌘/Ctrl + Z puts it
 * back. Corners come last in the markup, so they win where they meet an edge.
 */
function Border({ refer, handlers }: { refer: BoardRef; handlers: BoardHandlers }) {
  return (
    <>
      {BORDER.map((edge) => (
        <span key={edge} className="canvas-board-edge" data-edge={edge} aria-hidden="true" onPointerDown={(event) => handlers.resize(event, refer, edge)} />
      ))}
    </>
  );
}

/** Four corner grips on the selected note or section: the visible part of a border that resizes it. */
function Handles({ refer, handlers }: { refer: BoardRef; handlers: BoardHandlers }) {
  return (
    <>
      {CORNERS.map((corner) => (
        <span
          key={corner}
          className="canvas-resize"
          data-corner={corner}
          aria-hidden="true"
          data-tip={labels.boardResize}
          onPointerDown={(event) => handlers.resize(event, refer, corner)}
        />
      ))}
    </>
  );
}

/**
 * A section's frame, behind the items, with its title on a raised tab like a
 * folder's. The tab moves it and a double-click edits the title; the border
 * resizes it. A click on empty space inside selects it. The frame itself ignores
 * presses, so a drag inside still pans.
 */
export function SectionView({
  section,
  hidden,
  interactive,
  selected,
  handlers,
}: {
  section: CanvasSection;
  /** A change to this section is shown instead. */
  hidden: boolean;
  interactive: boolean;
  selected: boolean;
  handlers: BoardHandlers;
}) {
  if (hidden) return null;
  const ref: BoardRef = { kind: "section", id: section.id, ghost: false };
  return (
    <div
      className="canvas-section"
      data-board-id={section.id}
      data-selected={selected || undefined}
      data-interactive={interactive || undefined}
      style={{ transform: place(section.x, section.y), inlineSize: section.width, blockSize: section.height }}
    >
      <div className="canvas-section-frame" />
      {interactive && <Border refer={ref} handlers={handlers} />}
      {/* biome-ignore lint/a11y/useSemanticElements: a tab that drags like an item's grip; the keys below move and edit it. */}
      <div
        className="canvas-section-tab"
        role="group"
        aria-label={labels.boardSectionLabel(section.title)}
        tabIndex={interactive ? 0 : undefined}
        data-tip={interactive ? labels.boardEditHint : undefined}
        onPointerDown={(event) => interactive && handlers.move(event, ref)}
        onKeyDown={(event) => interactive && onKey(event, ref, handlers)}
      >
        {interactive && <Grip />}
        {section.title}
      </div>
      {interactive && selected && <Handles refer={ref} handlers={handlers} />}
    </div>
  );
}

/**
 * A note from the registry: a sticker with a folded corner. Its fixed colors
 * ignore the app's themes, so it never reads as product UI.
 */
export function NoteView({
  note,
  hidden,
  interactive,
  selected,
  handlers,
}: {
  note: CanvasNote;
  hidden: boolean;
  interactive: boolean;
  selected: boolean;
  handlers: BoardHandlers;
}) {
  if (hidden) return null;
  const ref: BoardRef = { kind: "note", id: note.id, ghost: false };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a draggable sticker; the keys below move and edit it.
    <div
      className="canvas-note-card"
      role="group"
      aria-label={labels.boardNoteLabel}
      data-board-id={note.id}
      data-selected={selected || undefined}
      data-interactive={interactive || undefined}
      tabIndex={interactive ? 0 : undefined}
      data-tip={interactive ? labels.boardEditHint : undefined}
      style={{ transform: place(note.x, note.y), inlineSize: note.width ?? NOTE_WIDTH, minBlockSize: note.height }}
      onPointerDown={(event) => interactive && handlers.move(event, ref)}
      onKeyDown={(event) => interactive && onKey(event, ref, handlers)}
    >
      <div className="canvas-note-body">{note.text}</div>
      {interactive && <Border refer={ref} handlers={handlers} />}
      {interactive && selected && <Handles refer={ref} handlers={handlers} />}
    </div>
  );
}

/** A mark waiting for the agent: a dashed ghost of a new or changed note or section, with its state on top. */
export function MarkView({
  mark,
  open,
  folded,
  interactive,
  selected,
  handlers,
  onText,
  onClose,
  onDelete,
}: {
  mark: BoardMark;
  open: boolean;
  /** A note moved with its section: the section's change shows it, so it has no tag of its own. */
  folded: boolean;
  interactive: boolean;
  selected: boolean;
  handlers: BoardHandlers;
  onText: (id: string, text: string) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const isNote = mark.kind === "note";
  const ref: BoardRef = { kind: mark.kind, id: mark.id, ghost: true };
  // One frame later, so the press that opened it has finished moving focus.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const field = fieldRef.current;
      if (!field) return;
      field.focus({ preventScroll: true });
      // Editing continues from the end of the text, as in any note app.
      field.setSelectionRange(field.value.length, field.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const sentState = mark.sent !== undefined;
  const state = mark.direct ? labels.boardSaving : sentState ? labels.boardSent : mark.queued ? labels.boardQueued : labels.boardNotApplied;
  const field = (
    <textarea
      ref={fieldRef}
      className="canvas-ghost-field"
      rows={isNote ? 3 : 1}
      value={mark.text}
      placeholder={isNote ? labels.notePlaceholder : labels.sectionPlaceholder}
      aria-label={isNote ? labels.boardNoteLabel : labels.boardSectionLabel(mark.text)}
      onChange={(event) => onText(mark.id, event.currentTarget.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        // Enter ends a section title; a note keeps its lines, and Escape closes either.
        if (event.key === "Escape" || (!isNote && event.key === "Enter")) {
          event.preventDefault();
          onClose();
        }
      }}
      onBlur={onClose}
    />
  );
  const empty = !mark.text.trim();
  const hint = <span className="canvas-ghost-hint">{isNote ? labels.notePlaceholder : labels.sectionPlaceholder}</span>;
  const content = open ? (
    field
  ) : isNote ? (
    <div className="canvas-note-body">{empty ? hint : mark.text}</div>
  ) : empty ? (
    hint
  ) : (
    mark.text
  );
  // An empty new note or section is a draft: it shows its placeholder and is not
  // a change, so it has no state, only a way to discard it.
  const tag = folded ? null : (
    <span className="canvas-ghost-tag">
      {!empty && state}
      {(!mark.direct || empty) && <DiscardButton keepFocus onClick={() => onDelete(mark.id)} />}
    </span>
  );
  const common = {
    "data-board-ghost": mark.id,
    "data-state": sentState ? "sent" : mark.queued ? "queued" : "new",
    "data-selected": selected || undefined,
    "data-interactive": interactive || undefined,
  };
  if (isNote) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: a draggable sticker; the keys below move and edit it.
      <div
        className="canvas-note-card canvas-ghost"
        role="group"
        aria-label={labels.boardNoteLabel}
        tabIndex={interactive ? 0 : undefined}
        style={{ transform: place(mark.x, mark.y), inlineSize: mark.w ?? NOTE_WIDTH, minBlockSize: mark.h }}
        onPointerDown={(event) => interactive && handlers.move(event, ref)}
        onKeyDown={(event) => interactive && onKey(event, ref, handlers)}
        {...common}
      >
        {tag}
        {open ? <div className="canvas-note-body">{field}</div> : content}
        {interactive && <Border refer={ref} handlers={handlers} />}
        {interactive && selected && <Handles refer={ref} handlers={handlers} />}
      </div>
    );
  }
  return (
    <div
      className="canvas-section canvas-ghost"
      style={{ transform: place(mark.x, mark.y), inlineSize: mark.w, blockSize: mark.h }}
      {...common}
    >
      <div className="canvas-section-frame" />
      {interactive && <Border refer={ref} handlers={handlers} />}
      {tag}
      {/* biome-ignore lint/a11y/useSemanticElements: a tab that drags like an item's grip; the keys below move and edit it. */}
      <div
        className="canvas-section-tab"
        role="group"
        aria-label={labels.boardSectionLabel(mark.text)}
        tabIndex={interactive && !open ? 0 : undefined}
        onPointerDown={(event) => interactive && handlers.move(event, ref)}
        onKeyDown={(event) => interactive && onKey(event, ref, handlers)}
      >
        {interactive && !open && <Grip />}
        {content}
      </div>
      {interactive && selected && <Handles refer={ref} handlers={handlers} />}
    </div>
  );
}
