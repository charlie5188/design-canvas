// An annotation as drawn on its item: the numbered pin, and the open note with its thread.
import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import { type Annotation, sectionOf, type ThreadMessage } from "./annotations";
import { QueuedIcon, ReplyIcon, SendIcon, SentIcon, TrashIcon } from "./icons";
import { labels } from "./labels";

/** Space a note keeps from the viewport edge before it opens on the other side. */
const FLIP_MARGIN = 16;

export type AnnotationHandlers = {
  onOpen: (id: string) => void;
  onText: (id: string, text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  onVersion: (id: string, version: boolean) => void;
  /** The person answers the agent's reply: the same note, with new words to send. */
  onFollowUp: (id: string, text: string) => void;
  /** Sends, queues, or copies everything that waits, this note included. */
  onSend: () => void;
};
/** What sending does right now, for a note's own button: the short word on it, and the bar's full words as its name. */
export const SendContext = createContext<{ label: string; name: string; agentOn: boolean }>({ label: "", name: "", agentOn: false });

/**
 * The open note: the reference it points at, what was said on it so far, the
 * field for what the person says now, and the ways on.
 *
 * A note is a short conversation with the agent, drawn as a comment thread: the
 * first words at the edge, every later turn set in under them with a name, all
 * plain text. While the agent's reply is the last turn, the field is for an
 * answer to it; adding or sending that answer makes it the note's new words, on
 * the same pin, and the turns before it stay above.
 */
export function AnnotationCard({ annotation, handlers, done }: { annotation: Annotation; handlers: AnnotationHandlers; done: () => void }) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const send = useContext(SendContext);
  // The note grows with its conversation instead of scrolling inside itself: a
  // second scrollbar in a small card is harder to use than a tall card. When it
  // then covers what the person wants to see, they drag it aside by its top edge.
  // The card has no title: the pin, or the outline of an area, already shows what
  // the note is on, and its name is still the card's name for a screen reader.
  // The move lasts while the note is open. The pin is counter-scaled against the
  // zoom, so a pixel of pointer travel is a pixel here.
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const grab = useRef<{ pointer: number; x: number; y: number; from: { x: number; y: number } } | null>(null);
  const answered = annotation.reply !== undefined;
  // An answer to the agent is typed here and becomes the note's words only when it is added or sent.
  const [answer, setAnswer] = useState("");
  const value = answered ? answer : annotation.text;
  const turns: ThreadMessage[] = [
    ...(annotation.thread ?? []),
    ...(answered ? [{ who: "me" as const, text: annotation.text }, { who: "agent" as const, text: annotation.reply! }] : []),
  ];
  // The field grows with the note, up to about ten lines (its max-block-size), then
  // scrolls, so a long note, such as a rewritten text, reads whole. It runs before
  // the card picks a side below, so that sees the card at its real height.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    // Measured without a scrollbar, which would narrow the lines and add one.
    field.style.overflowY = "hidden";
    field.style.blockSize = "auto";
    field.style.blockSize = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
    field.style.overflowY = "";
  }, [value]);
  // The note opens on the side of the pin that has room, like a menu, so focusing
  // it never pans the canvas under the person. Then the caret goes to the end.
  useLayoutEffect(() => {
    const card = cardRef.current;
    const field = fieldRef.current;
    if (!card || !field) return;
    const view = card.closest(".canvas-viewport, .canvas-flow")?.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    if (view) {
      card.toggleAttribute("data-flip-x", box.right > view.right - FLIP_MARGIN);
      card.toggleAttribute("data-flip-y", box.top < view.top + FLIP_MARGIN);
    }
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);
  /** Makes what is typed the note's words. False when there is nothing to send. */
  const commit = () => {
    if (!answered) return !!annotation.text.trim();
    if (!answer.trim()) return false;
    handlers.onFollowUp(annotation.id, answer);
    setAnswer("");
    return true;
  };
  // Keeps the note on the canvas and closes it, so the person can go on to the next one.
  const keep = () => {
    commit();
    handlers.onSave();
    done();
  };
  const sendAll = () => {
    if (!commit()) return;
    handlers.onSend();
    done();
  };
  const onSection = sectionOf(annotation) !== null;
  // A whole item's note covers the item and is named by the item alone; an area's name says more.
  const wholeItem = !onSection && !!annotation.w && !annotation.ref.includes(" › ");
  // A note on several items offers what is asked of a set: Combine, then the one-item requests for each.
  const quickAsks = annotation.also?.length ? labels.quickAsksMany : labels.quickAsks;
  return (
    <div
      ref={cardRef}
      className="canvas-annotation-card"
      role="dialog"
      aria-label={labels.annotationField(annotation.ref)}
      style={shift.x || shift.y ? { translate: `${shift.x}px ${shift.y}px` } : undefined}
      onKeyDown={(event) => {
        // Escape from the note or the checkbox undoes this card's changes.
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        handlers.onCancel();
        done();
      }}
    >
      <span
        className="canvas-annotation-handle"
        aria-hidden="true"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          grab.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, from: shift };
        }}
        onPointerMove={(event) => {
          const held = grab.current;
          if (!held || held.pointer !== event.pointerId) return;
          setShift({ x: held.from.x + event.clientX - held.x, y: held.from.y + event.clientY - held.y });
        }}
        onPointerUp={(event) => {
          if (grab.current?.pointer === event.pointerId) grab.current = null;
        }}
        onPointerCancel={() => {
          grab.current = null;
        }}
      />
      {turns.length > 0 && (
        <div className="canvas-thread" role="log" aria-label={labels.threadLabel}>
          {turns.map((turn, index) => (
            <div key={index} className="canvas-thread-turn" data-who={turn.who}>
              <span className="canvas-thread-who">{turn.who === "me" ? labels.threadYou : labels.agentName}</span>
              <span className="canvas-thread-text">{turn.text}</span>
            </div>
          ))}
        </div>
      )}
      {annotation.sent && !answered && (
        <span className="canvas-annotation-sent">
          {onSection ? labels.sentNoteSection : annotation.version ? labels.sentNoteVersion : labels.sentNote}
        </span>
      )}
      {annotation.queued && <span className="canvas-annotation-sent">{labels.queuedNote}</span>}
      {/* A new note about a whole item offers a few requests people make often. A press puts
          the words in the field, to send as they are or to change first. They go once there are words. */}
      {wholeItem && !answered && !turns.length && !annotation.sent && !annotation.queued && !value.trim() && (
        <span className="canvas-quick" role="group" aria-label={labels.quickAsksLabel}>
          {quickAsks.map((quick) => (
            <button
              key={quick.label}
              type="button"
              className="canvas-quick-ask"
              // The field keeps the focus, so the words can be sent or changed at once.
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => handlers.onText(annotation.id, quick.text)}
            >
              {quick.label}
            </button>
          ))}
        </span>
      )}
      <textarea
        ref={fieldRef}
        rows={turns.length ? 2 : 3}
        value={value}
        placeholder={turns.length ? labels.replyPlaceholder : labels.annotationPlaceholder}
        aria-label={labels.annotationField(annotation.ref)}
        onChange={(event) => (answered ? setAnswer(event.currentTarget.value) : handlers.onText(annotation.id, event.currentTarget.value))}
        onKeyDown={(event) => {
          // Enter that confirms an IME composition (Japanese, Chinese) does nothing here.
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          // Enter keeps the note and closes it; with ⌘ or Ctrl it sends. Shift+Enter breaks the line.
          if (event.metaKey || event.ctrlKey) sendAll();
          else keep();
        }}
      />
      {/* Checked: the agent keeps this item and adds a new version beside it. A section has no one original to keep.
          While the agent's reply is the last turn there are no new words yet for the choice to apply to. */}
      {!onSection && !answered && (
        <label className="canvas-annotation-version">
          <input
            type="checkbox"
            checked={!!annotation.version}
            onChange={(event) => handlers.onVersion(annotation.id, event.currentTarget.checked)}
          />
          {labels.newVersion}
        </label>
      )}
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
        {/* With a listening agent, sending is instant, so each note sends (named in full for a
            screen reader, "Send 2 to agent"). Without one, the person writes several notes and
            pastes them once: a Copy on every note read as "copy this one" and hid that it copies
            all. So the note only keeps itself (Done), and the bar at the top, which appears and
            counts up as notes are kept, is the one place to copy. ⌘/Ctrl + Enter still copies all. */}
        {send.agentOn ? (
          <button
            type="button"
            className="canvas-button canvas-button-primary"
            disabled={!value.trim()}
            aria-label={send.name}
            title={labels.sendHint}
            onClick={sendAll}
          >
            <SendIcon />
            {send.label}
          </button>
        ) : (
          <button
            type="button"
            className="canvas-button canvas-button-primary"
            disabled={!value.trim()}
            title={labels.doneHint}
            onClick={keep}
          >
            {labels.doneNote}
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * A numbered pin at the point the annotation was placed. It lives in the item, so
 * it moves with it, and counter-scales so it stays the same size at any zoom.
 */
export function AnnotationPin({
  annotation,
  number,
  open,
  handlers,
  still,
}: {
  annotation: Annotation;
  /** Its place in the next message; absent once sent or queued. */
  number?: number;
  open: boolean;
  handlers: AnnotationHandlers;
  /** Opened by a box drawn with Ask agent, whose outline it replaces: its outline shows with no fade. */
  still?: boolean;
}) {
  const bubbleRef = useRef<HTMLButtonElement>(null);
  // Decided once, when the pin appears: taking the fade off and on would replay it.
  const [instant] = useState(!!still);
  const text = annotation.text || labels.annotationPlaceholder;
  const reply = annotation.reply;
  // An answer the person has not opened yet says its first words beside the pin, so they
  // see that it came and often all of it, without a card opening over the design by itself.
  const unread = reply !== undefined && !annotation.seen;
  // Unread, the pin itself grows to hold those words: one shape, the pin's head and the line it says.
  // It opens to the right, or to the left when the canvas's edge is too near, like the note (FLIP_MARGIN).
  const speaking = unread && !open;
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!bubble) return;
    bubble.removeAttribute("data-flip-x");
    if (!speaking) return;
    const view = bubble.closest(".canvas-viewport, .canvas-flow")?.getBoundingClientRect();
    if (view && bubble.getBoundingClientRect().right > view.right - FLIP_MARGIN) bubble.setAttribute("data-flip-x", "");
  }, [speaking, reply]);
  return (
    <>
      {/* An area or a whole item keeps its outline, so the note shows what it covers. */}
      {annotation.w && annotation.h ? (
        <div
          className="canvas-area"
          style={{ left: annotation.x, top: annotation.y, width: annotation.w, height: annotation.h }}
          data-sent={number === undefined || undefined}
          data-open={open || undefined}
          data-still={instant || undefined}
          aria-hidden="true"
        />
      ) : null}
    <div
      className="canvas-pin"
      style={{ left: annotation.x, top: annotation.y }}
      data-open={open || undefined}
      data-area={(annotation.w && annotation.h) || sectionOf(annotation) !== null ? true : undefined}
      // A new, empty pin sits where the click was, so a double-click's second press passes through to edit the text.
      data-empty={!annotation.text.trim() || undefined}
      data-reply={reply === undefined ? undefined : unread ? "unread" : "read"}
    >
      <button
        ref={bubbleRef}
        type="button"
        className="canvas-pin-bubble"
        data-sent={number === undefined || undefined}
        data-says={speaking || undefined}
        aria-label={
          reply !== undefined
            ? labels.repliedPin(text, reply)
            : number !== undefined
              ? labels.annotationPin(number, text)
              : annotation.queued
                ? labels.queuedPin(text)
                : labels.sentPin(text)
        }
        aria-expanded={open}
        onClick={() => (open ? handlers.onSave() : handlers.onOpen(annotation.id))}
      >
        <span className="canvas-pin-head">{reply !== undefined ? <ReplyIcon /> : (number ?? (annotation.queued ? <QueuedIcon /> : <SentIcon />))}</span>
        {speaking && <span className="canvas-pin-says">{labels.replyPreview(reply.split(/\r?\n/)[0]!)}</span>}
      </button>
      {open && <AnnotationCard annotation={annotation} handlers={handlers} done={() => bubbleRef.current?.focus({ preventScroll: true })} />}
    </div>
    </>
  );
}

/**
 * On each other item a note on several items is about: the outline a whole item's
 * note draws, over all of it, so the person sees every item the note covers. The
 * pin and the note itself stay on the first item.
 */
export function AnnotationLink({ open, sent, still }: { open: boolean; sent: boolean; still?: boolean }) {
  // Whether it appeared under an Ask agent box is decided once: taking the fade off and on would replay it.
  const [instant] = useState(!!still);
  return (
    <div
      className="canvas-area"
      data-linked=""
      data-sent={sent || undefined}
      data-open={open || undefined}
      data-still={instant || undefined}
      aria-hidden="true"
    />
  );
}
