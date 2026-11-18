// A note's text as it is shown. Notes are plain text in the registry, and a few marks in
// that text are drawn as formatting, the ones a short explanation needs most:
//
//   **words**            bold
//   [words](https://…)   a link, and an address typed or pasted as it is
//   `name`               code: a component, prop, or token name
//   - item               a list (also "* item" and "• item")
//   1. item              a numbered list (also "1) item")
//
// Everything else shows as typed, line breaks included. The marks are only drawn here:
// the note is edited as the text it is, and the agent reads and writes that same text.
import type { ReactNode } from "react";

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
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

type Block = { kind: "text"; lines: string[] } | { kind: "list"; ordered: boolean; start: number; items: string[] };

export function NoteText({ text }: { text: string }) {
  const blocks: Block[] = [];
  for (const line of text.split("\n")) {
    const numbered = NUMBERED.exec(line);
    const bullet = numbered ? null : BULLET.exec(line);
    const last = blocks[blocks.length - 1];
    if (numbered || bullet) {
      const ordered = !!numbered;
      const item = (numbered?.[2] ?? bullet?.[1])!;
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: "list", ordered, start: numbered ? Number(numbered[1]) : 1, items: [item] });
    } else if (last?.kind === "text") last.lines.push(line);
    else blocks.push({ kind: "text", lines: [line] });
  }
  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === "text") return <div key={index}>{inline(block.lines.join("\n"))}</div>;
        const items = block.items.map((item, at) => <li key={at}>{inline(item)}</li>);
        return block.ordered ? (
          <ol key={index} start={block.start}>
            {items}
          </ol>
        ) : (
          <ul key={index}>{items}</ul>
        );
      })}
    </>
  );
}
