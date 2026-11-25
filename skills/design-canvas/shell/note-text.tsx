// A note's text as it is shown. Notes are plain text in the registry, and a few marks in
// that text are drawn as formatting, the ones a short explanation needs most:
//
//   **words**            bold
//   [words](https://…)   a link, and an address typed or pasted as it is
//   `name`               code: a component, prop, or token name
//   - item               a list (also "* item" and "• item")
//   1. item              a numbered list (also "1) item")
//     - item             indented under an item: a list inside that item
//
// Everything else shows as typed, line breaks included. The marks are only drawn here:
// the note is edited as the text it is, and the agent reads and writes that same text.
// note-edit.ts gives the field the keys that write these marks (Enter, Tab, Backspace).
import type { ReactNode } from "react";

/** A line that is a list item, read the same way where it is drawn and where it is edited. */
export type ListLine = {
  /** The spaces or tabs before the mark, as typed. */
  lead: string;
  /** How far the mark is indented, a tab counting to the next multiple of 4 as in Markdown. */
  indent: number;
  /** "-", "*", "•", or a number with its "." or ")", as typed. */
  mark: string;
  ordered: boolean;
  number: number;
  /** Where the item's own words start in the line, after the mark and its space. */
  head: number;
  body: string;
};

// A number has at most three digits, so a line that starts "2026. " is a year, not item 2026.
const ITEM = /^(\s*)([-*•]|(\d{1,3})[.)])\s+/;

export function listLine(line: string): ListLine | null {
  const match = ITEM.exec(line);
  if (!match) return null;
  const [whole, lead, mark, digits] = match as unknown as [string, string, string, string | undefined];
  let indent = 0;
  for (const char of lead) indent = char === "\t" ? indent + 4 - (indent % 4) : indent + 1;
  return {
    lead,
    indent,
    mark,
    ordered: digits !== undefined,
    number: digits === undefined ? 0 : Number(digits),
    head: whole.length,
    body: line.slice(whole.length),
  };
}
// One pass, left to right: the mark that starts first wins, so stars or brackets inside
// `code` or inside an address are never read as marks of their own.
const INLINE = new RegExp(
  [
    // 1: code.
    /`([^`\n]+)`/.source,
    // 2, 3: [words](address). The address may hold one level of brackets, as Wikipedia's do.
    /\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/.source,
    // 4: an address as typed. It ends at a space, a quote, or a character that is not ASCII,
    // so "https://example.comを参照" links only the address.
    /(https?:\/\/[^\s"<>`\u0080-￿]+)/.source,
    // 5: bold. It needs a word right inside each pair of stars, so "2 ** 3 ** 4" stays as typed.
    /\*\*(\S(?:[^\n]*?\S)?)\*\*/.source,
  ].join("|"),
  "g",
);

/** Punctuation that ends a sentence, not an address: "see https://a.com." links "https://a.com". */
function trimAddress(address: string): string {
  let end = address.length;
  while (end > 0) {
    const last = address[end - 1]!;
    const kept = address.slice(0, end);
    if (".,;:!?*'".includes(last)) end--;
    // A closing bracket belongs to the address only when the address opened one: "(https://a.com)".
    else if (last === ")" && kept.split(")").length > kept.split("(").length) end--;
    else break;
  }
  return address.slice(0, end);
}

// An address pasted as it is can run to a hundred characters (a Figma or Notion link), and a
// note is narrow, so it shows short. The whole address is still the link, and the browser shows
// it on hover; [words](address) names it instead.
const SHORT = 40;
function shortAddress(address: string): string {
  const bare = address.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  return bare.length > SHORT ? `${bare.slice(0, SHORT - 1)}…` : bare;
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className="canvas-note-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // On the canvas a press on a note may start a drag, so the canvas opens the link itself
      // once the press ends without moving (Canvas.tsx, "move"). A click from Enter on a focused
      // link (detail 0), and any click in a shared file, opens it here as usual.
      onClick={(event) => {
        if (event.detail > 0 && event.currentTarget.closest("[data-interactive]")) event.preventDefault();
      }}
    >
      {children}
    </a>
  );
}

function inline(text: string, inBold = false): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const [whole, code, words, href, address, bold] = match;
    let end = match.index + whole.length;
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (code !== undefined) parts.push(<code key={match.index}>{code}</code>);
    else if (words !== undefined && href !== undefined)
      parts.push(
        <Link key={match.index} href={href}>
          {words}
        </Link>,
      );
    else if (address !== undefined) {
      const trimmed = trimAddress(address);
      end = match.index + trimmed.length;
      // "https://" and nothing after it is not an address.
      if (/^https?:\/\/[^/]/.test(trimmed))
        parts.push(
          <Link key={match.index} href={trimmed}>
            {shortAddress(trimmed)}
          </Link>,
        );
      else parts.push(trimmed);
    } else if (bold !== undefined)
      // Bold may hold a link or code; bold inside bold is only stars.
      parts.push(<strong key={match.index}>{inBold ? bold : inline(bold, true)}</strong>);
    last = end;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

type List = { ordered: boolean; start: number; indent: number; items: { text: string; lists: List[] }[] };
type Block = { kind: "text"; lines: string[] } | { kind: "list"; list: List };

function ListView({ list }: { list: List }) {
  const items = list.items.map((item, at) => (
    <li key={at}>
      {inline(item.text)}
      {item.lists.map((inner, index) => (
        <ListView key={index} list={inner} />
      ))}
    </li>
  ));
  return list.ordered ? <ol start={list.start}>{items}</ol> : <ul>{items}</ul>;
}

export function NoteText({ text }: { text: string }) {
  const blocks: Block[] = [];
  // The lists open at the current line, outermost first. Any line that is not an item ends them all.
  let open: List[] = [];
  for (const line of text.split("\n")) {
    const item = listLine(line);
    const last = blocks[blocks.length - 1];
    if (!item) {
      open = [];
      if (last?.kind === "text") last.lines.push(line);
      else blocks.push({ kind: "text", lines: [line] });
      continue;
    }
    const list = (): List => ({ ordered: item.ordered, start: item.ordered ? item.number : 1, indent: item.indent, items: [] });
    // Back out to the list this item's indent belongs to. The outermost list stays, so a list
    // that starts indented and goes on less indented is still one list.
    while (open.length > 1 && open[open.length - 1]!.indent > item.indent) open.pop();
    const top = open[open.length - 1];
    if (!top) {
      open = [list()];
      blocks.push({ kind: "list", list: open[0]! });
    } else if (item.indent > top.indent) {
      // Indented further than its list: a list inside the item before it.
      const inner = list();
      top.items[top.items.length - 1]!.lists.push(inner);
      open.push(inner);
    } else if (top.ordered !== item.ordered) {
      // Bullets after numbers, or the other way, at the same level: a new list beside the last.
      const next = list();
      open[open.length - 1] = next;
      const parent = open[open.length - 2];
      if (parent) parent.items[parent.items.length - 1]!.lists.push(next);
      else blocks.push({ kind: "list", list: next });
    }
    open[open.length - 1]!.items.push({ text: item.body, lists: [] });
  }
  return (
    <>
      {blocks.map((block, index) =>
        block.kind === "text" ? <div key={index}>{inline(block.lines.join("\n"))}</div> : <ListView key={index} list={block.list} />,
      )}
    </>
  );
}
