// A note's text as it is shown. Notes are plain text in the registry, and two marks in
// that text are drawn as formatting, the two a short explanation needs most:
//
//   **words**            bold
//   - item               a list (also "* item" and "• item")
//   1. item              a numbered list (also "1) item")
//
// Everything else shows as typed, line breaks included. The marks are only drawn here:
// the note is edited as the text it is, and the agent reads and writes that same text.
import type { ReactNode } from "react";

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
// Bold needs a word right inside each pair of stars, so "2 ** 3 ** 4" stays as typed.
const BOLD = /\*\*(\S(?:[^\n]*?\S)?)\*\*/g;

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(BOLD)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(<strong key={match.index}>{match[1]}</strong>);
    last = match.index + match[0].length;
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
