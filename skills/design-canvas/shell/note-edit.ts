// The keys that write a note's lists, as a notes app has them. A note stays the plain text
// it is (note-text.tsx draws it), so each key only types the marks a person would type:
//
//   Enter          on an item: the next item, with the same mark or the next number.
//                  On an empty item: one level out, and at the top level, out of the list.
//   Tab            nests the item, with the items under it, under the item before it.
//   Shift + Tab    takes it one level out.
//   Backspace      just after an item's mark: the same as Enter on an empty item, so a mark
//                  that Enter added goes in one press.
//
// Shift + Enter breaks the line with no mark. Tab never leaves the field: a note being
// written would close on it. Escape closes the note, and then Tab moves on.
//
// A nested item is indented to where the words of the item above it start (2 spaces under
// "- ", 3 under "1. "), which is how Markdown nests lists, so the agent and any Markdown tool
// read the same structure. After each of these keys the numbered items are counted again,
// so inserting or nesting one never leaves "1. 2. 2." behind.
import type { KeyboardEvent } from "react";
import { type ListLine, listLine } from "./note-text";

export type NoteEdit = { text: string; start: number; end: number };
type Key = "enter" | "indent" | "outdent" | "backspace";
type Pos = { line: number; col: number };

/** The note's lines and the selection in them, changed a line at a time. */
class Lines {
  lines: string[];
  sel: [Pos, Pos];
  constructor(text: string, start: number, end: number) {
    this.lines = text.split("\n");
    this.sel = [this.pos(start), this.pos(end)];
  }
  pos(offset: number): Pos {
    let line = 0;
    let at = 0;
    while (line < this.lines.length - 1 && offset > at + this.lines[line]!.length) {
      at += this.lines[line]!.length + 1;
      line++;
    }
    return { line, col: offset - at };
  }
  offset({ line, col }: Pos): number {
    let at = 0;
    for (let i = 0; i < line; i++) at += this.lines[i]!.length + 1;
    return at + col;
  }
  /** Replaces a line whose change is near its start (the indent or the mark): the caret keeps its place in the words after it. */
  set(index: number, next: string) {
    const old = this.lines[index]!;
    if (old === next) return;
    let same = 0;
    while (same < old.length && same < next.length && old[old.length - 1 - same] === next[next.length - 1 - same]) same++;
    for (const pos of this.sel) {
      if (pos.line !== index) continue;
      pos.col = pos.col >= old.length - same ? pos.col + next.length - old.length : Math.min(pos.col, next.length - same);
    }
    this.lines[index] = next;
  }
  item(index: number): ListLine | null {
    const line = this.lines[index];
    return line === undefined ? null : listLine(line);
  }
  result(): NoteEdit {
    return { text: this.lines.join("\n"), start: this.offset(this.sel[0]), end: this.offset(this.sel[1]) };
  }
}

const reindent = (line: string, item: ListLine, indent: number) => " ".repeat(Math.max(0, indent)) + line.slice(item.lead.length);
const renumber = (line: string, item: ListLine, number: number) =>
  item.lead + number + item.mark.slice(-1) + line.slice(item.lead.length + item.mark.length);

/** The column where an item's words start, which is where an item nested under it is indented to. */
const wordsAt = (item: ListLine) => item.indent + item.head - item.lead.length;

/**
 * Moves the items from `first` to `last`, and the items nested under them, one level in or out.
 * The first item decides how far; the rest keep their places relative to it.
 */
function shift(doc: Lines, first: number, last: number, out: boolean): boolean {
  let head = -1;
  for (let i = first; i <= last && head < 0; i++) if (doc.item(i)) head = i;
  if (head < 0) return false;
  const item = doc.item(head)!;
  let target = 0;
  if (out) {
    if (item.indent === 0) return false;
    // Out to the level of the item it is nested under; with none above, out to the margin.
    for (let i = head - 1; doc.item(i); i--) {
      const above = doc.item(i)!;
      if (above.indent < item.indent) {
        target = above.indent;
        break;
      }
    }
  } else {
    // In under the item before it at the same level. The first item of a list has none.
    let sibling: ListLine | null = null;
    for (let i = head - 1; doc.item(i); i--) {
      const above = doc.item(i)!;
      if (above.indent < item.indent) return false;
      if (above.indent === item.indent) {
        sibling = above;
        break;
      }
    }
    if (!sibling) return false;
    target = wordsAt(sibling);
  }
  const delta = target - item.indent;
  // What is nested under the moved items moves with them.
  let least = Number.POSITIVE_INFINITY;
  for (let i = head; i <= last; i++) least = Math.min(least, doc.item(i)?.indent ?? least);
  let end = last;
  while (doc.item(end + 1) && doc.item(end + 1)!.indent > least) end++;
  for (let i = head; i <= end; i++) {
    const moved = doc.item(i);
    if (moved) doc.set(i, reindent(doc.lines[i]!, moved, moved.indent + delta));
  }
  // A numbered item that becomes the first of a new nested list is its 1.
  const now = doc.item(head)!;
  if (!out && now.ordered) {
    for (let i = head - 1; doc.item(i); i--) {
      const above = doc.item(i)!;
      if (above.indent === now.indent) break;
      if (above.indent < now.indent) {
        doc.set(head, renumber(doc.lines[head]!, now, 1));
        break;
      }
    }
  }
  return true;
}

/** Counts each numbered list again from its first number, at every level. */
function count(doc: Lines) {
  const open: { indent: number; ordered: boolean; next: number }[] = [];
  doc.lines.forEach((line, index) => {
    const item = listLine(line);
    if (!item) {
      open.length = 0;
      return;
    }
    while (open.length && open[open.length - 1]!.indent > item.indent) open.pop();
    const top = open[open.length - 1];
    if (top && top.indent === item.indent && top.ordered === item.ordered) {
      if (item.ordered && item.number !== top.next) doc.set(index, renumber(line, item, top.next));
      top.next++;
      return;
    }
    if (top && top.indent === item.indent) open.pop();
    open.push({ indent: item.indent, ordered: item.ordered, next: item.number + 1 });
  });
}

/** What a key does to a note's text and selection, or null when the key should do what it always does. */
export function listEdit(key: Key, text: string, start: number, end: number): NoteEdit | null {
  const doc = new Lines(text, start, end);
  const [from, to] = doc.sel;
  if (key === "indent" || key === "outdent") {
    // A selection that ends at the very start of a line does not take that line in.
    const last = to.line > from.line && to.col === 0 ? to.line - 1 : to.line;
    if (!shift(doc, from.line, last, key === "outdent")) return null;
    count(doc);
    return doc.result();
  }
  if (from.line !== to.line) return null;
  const index = from.line;
  const item = doc.item(index);
  if (!item) return null;
  const line = doc.lines[index]!;
  if (key === "backspace") {
    if (from.col !== to.col || from.col !== item.head) return null;
  } else if (from.col < item.head) {
    // Enter inside the indent or the mark breaks the line as it always does.
    return null;
  }
  const empty = !item.body.trim();
  if (key === "backspace" || empty) {
    if (item.indent > 0) shift(doc, index, index, true);
    else {
      // Out of the list: the mark goes and the words stay, with the caret before them.
      doc.lines[index] = item.body.replace(/^\s+/, "");
      doc.sel = [
        { line: index, col: 0 },
        { line: index, col: 0 },
      ];
    }
    count(doc);
    return doc.result();
  }
  // The next item: what follows the caret moves into it, after the same mark or the next number.
  const before = line.slice(0, from.col);
  const after = line.slice(to.col).replace(/^\s+/, "");
  const mark = item.ordered ? `${item.number + 1}${item.mark.slice(-1)}` : item.mark;
  const prefix = `${item.lead}${mark} `;
  doc.lines.splice(index, 1, before, prefix + after);
  doc.sel = [
    { line: index + 1, col: prefix.length },
    { line: index + 1, col: prefix.length },
  ];
  count(doc);
  return doc.result();
}

/**
 * Puts an edit into the field as typing would, so the browser's own Undo (⌘/Ctrl + Z) takes it
 * back in one step and the field's onChange sees it. Only the part that changed is replaced.
 */
function apply(field: HTMLTextAreaElement, edit: NoteEdit) {
  const old = field.value;
  const next = edit.text;
  let from = 0;
  while (from < old.length && from < next.length && old[from] === next[from]) from++;
  let oldEnd = old.length;
  let newEnd = next.length;
  while (oldEnd > from && newEnd > from && old[oldEnd - 1] === next[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const insert = next.slice(from, newEnd);
  if (from !== oldEnd || insert) {
    field.setSelectionRange(from, oldEnd);
    const typed = insert ? document.execCommand("insertText", false, insert) : document.execCommand("delete");
    if (!typed || field.value !== next) {
      // A browser without the command: the change still lands, without its own Undo step.
      field.value = next;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  field.setSelectionRange(edit.start, edit.end);
}

/** The note field's keydown: handles a list key and stops it, and lets every other key through. */
export function onNoteKey(event: KeyboardEvent<HTMLTextAreaElement>) {
  // Enter that confirms an IME composition (Chinese, Japanese) is the IME's, not a new item.
  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  let key: Key | null = null;
  if (event.key === "Tab") key = event.shiftKey ? "outdent" : "indent";
  else if (event.key === "Enter" && !event.shiftKey) key = "enter";
  else if (event.key === "Backspace") key = "backspace";
  if (!key) return;
  if (key === "indent" || key === "outdent") event.preventDefault();
  const field = event.currentTarget;
  const edit = listEdit(key, field.value, field.selectionStart, field.selectionEnd);
  if (!edit) return;
  event.preventDefault();
  apply(field, edit);
}
