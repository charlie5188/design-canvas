// Writes a move, resize, text change, or trash change straight into registry.tsx,
// so it lands in the source as soon as the person makes it, without a message to the agent.
// Only the fields listed here are touched, and only inside the named array
// (`notes`, `sections`, or `registry`), so nothing else in the file can change.
//
// It works on the text of the file, not a parser: each entry is found by its
// `id`, its own braces are matched, and a field is replaced at the top level of
// that object. An edit that cannot be placed exactly is reported as missing and
// is not written, so the change falls back to the agent.

export type DirectKind = "note" | "section" | "item";
export type DirectEdit = { kind: DirectKind; id: string; set: Record<string, number | string | boolean> };
export type ApplyResult = { source: string; applied: string[]; missing: string[] };

const ARRAY: Record<DirectKind, string> = { note: "notes", section: "sections", item: "registry" };
// A "flag" is written as `key: true` and removed when false, so an entry that does
// not have it reads as it always did.
const FIELDS: Record<DirectKind, Record<string, "number" | "string" | "flag">> = {
  note: { x: "number", y: "number", width: "number", height: "number", text: "string" },
  section: { x: "number", y: "number", width: "number", height: "number", title: "string" },
  item: { x: "number", y: "number", width: "number", height: "number", note: "string", trashed: "flag" },
};
const COORD_LIMIT = 100_000;
const MAX_TEXT = 1000;
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/i;

/** Checks an edit from the browser before it goes near the file. */
export function validEdit(value: unknown): DirectEdit | undefined {
  const e = value as Partial<DirectEdit> | null;
  if (!e || typeof e !== "object" || !(e.kind === "note" || e.kind === "section" || e.kind === "item")) return undefined;
  if (typeof e.id !== "string" || !ID.test(e.id) || !e.set || typeof e.set !== "object") return undefined;
  const set: Record<string, number | string | boolean> = {};
  for (const [key, raw] of Object.entries(e.set)) {
    const type = FIELDS[e.kind][key];
    if (!type) return undefined;
    if (type === "number" && typeof raw === "number" && Number.isFinite(raw) && Math.abs(raw) <= COORD_LIMIT) set[key] = Math.round(raw);
    else if (type === "string" && typeof raw === "string" && raw.length <= MAX_TEXT) set[key] = raw;
    else if (type === "flag" && typeof raw === "boolean") set[key] = raw;
    else return undefined;
  }
  return Object.keys(set).length ? { kind: e.kind, id: e.id, set } : undefined;
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The index just past a string literal that starts at `start`, or -1. */
function stringEnd(source: string, start: number): number {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === "\\") i++;
    else if (source[i] === quote) return i + 1;
  }
  return -1;
}

/** The text with string contents and nested brackets masked, same length, so top-level keys can be found. */
function mask(text: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") {
      const stop = stringEnd(text, i);
      const segment = text.slice(i, stop < 0 ? text.length : stop);
      out += segment.length >= 2 ? segment[0] + "_".repeat(segment.length - 2) + segment[segment.length - 1] : "_";
      i += segment.length - 1;
    } else if (c === "{" || c === "[" || c === "(") {
      out += depth === 0 ? c : "_";
      depth++;
    } else if (c === "}" || c === "]" || c === ")") {
      depth = Math.max(0, depth - 1);
      out += depth === 0 ? c : "_";
    } else out += depth === 0 ? c : "_";
  }
  return out;
}

/** The braces of the one entry whose `id` is `id`, inside the array it belongs to. */
function entryOf(source: string, kind: DirectKind, id: string): { open: number; close: number } | undefined {
  const start = source.indexOf(`export const ${ARRAY[kind]}`);
  if (start < 0) return undefined;
  const next = source.indexOf("export const ", start + 1);
  const end = next < 0 ? source.length : next;
  const found = [...source.slice(start, end).matchAll(new RegExp(`\\bid\\s*:\\s*(["'])${escapeRe(id)}\\1`, "g"))];
  if (found.length !== 1) return undefined;
  const at = start + found[0]!.index!;
  let depth = 0;
  let open = -1;
  for (let i = at - 1; i >= start; i--) {
    const c = source[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) {
        open = i;
        break;
      }
      depth--;
    }
  }
  if (open < 0) return undefined;
  depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i]!;
    if (c === '"' || c === "'" || c === "`") {
      const stop = stringEnd(source, i);
      if (stop < 0) return undefined;
      i = stop - 1;
    } else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return at < i ? { open, close: i } : undefined;
    }
  }
  return undefined;
}

const literalOf = (value: number | string | boolean, type: "number" | "string" | "flag") =>
  type === "string" ? JSON.stringify(value) : String(value);

/**
 * Where the entry's last top-level spread (`...SIZE`) ends, as an offset in its
 * body: past the spread's comma, or past the spread itself when it is last and
 * has none. A field written before a spread that holds the same key is
 * overwritten by it, so new and moved fields go after this point.
 */
function afterLastSpread(body: string): { at: number; comma: boolean; indent: string } | undefined {
  const masked = mask(body);
  const start = masked.lastIndexOf("...");
  if (start < 0) return undefined;
  const indent = /(?:^|\n)([ \t]*)[^\n]*$/.exec(body.slice(0, start))?.[1] ?? "";
  const comma = masked.indexOf(",", start);
  if (comma >= 0) return { at: comma + 1, comma: true, indent };
  return { at: masked.trimEnd().length, comma: false, indent };
}

/** The source with `key: value` added to the entry: after its last spread when it has one, else after the opening brace. */
function addField(source: string, open: number, close: number, key: string, literal: string): string {
  const body = source.slice(open + 1, close);
  const spread = afterLastSpread(body);
  const multiLine = body.includes("\n");
  if (spread) {
    const at = open + 1 + spread.at;
    const field = multiLine ? `\n${spread.indent}${key}: ${literal},` : ` ${key}: ${literal},`;
    return source.slice(0, at) + (spread.comma ? "" : ",") + field + source.slice(at);
  }
  // Multi-line entries get the field on its own line, at the indentation of their next line; single-line ones keep their layout.
  const line = /^\s*\n([ \t]*)/.exec(source.slice(open + 1));
  const added = line ? `\n${line[1]}${key}: ${literal},` : ` ${key}: ${literal},`;
  return source.slice(0, open + 1) + added + source.slice(open + 1);
}

/**
 * Replaces one field of an entry, or adds it when the entry has none. A field
 * that a later spread would overwrite moves after the spread, so the new value
 * takes effect. Returns undefined when it cannot place it.
 */
function setField(source: string, kind: DirectKind, id: string, key: string, value: number | string | boolean): string | undefined {
  const entry = entryOf(source, kind, id);
  if (!entry) return undefined;
  const type = FIELDS[kind][key]!;
  const body = source.slice(entry.open + 1, entry.close);
  const match = new RegExp(`(^|[^\\w$.])${key}\\s*:\\s*`).exec(mask(body));
  // A flag that is off has no field: there is nothing to add.
  if (!match && type === "flag" && value !== true) return source;
  if (!match) return addField(source, entry.open, entry.close, key, literalOf(value, type));
  const valueStart = entry.open + 1 + match.index + match[0].length;
  let valueEnd: number;
  if (type === "flag") {
    const flag = /^(true|false)\b/.exec(source.slice(valueStart, entry.close));
    if (!flag) return undefined;
    valueEnd = valueStart + flag[0].length;
  } else if (type === "number") {
    const number = /^-?\d+(\.\d+)?/.exec(source.slice(valueStart, entry.close));
    if (!number) return undefined;
    valueEnd = valueStart + number[0].length;
  } else {
    if (source[valueStart] !== '"' && source[valueStart] !== "'" && source[valueStart] !== "`") return undefined;
    valueEnd = stringEnd(source, valueStart);
    if (valueEnd < 0) return undefined;
    // A template with a placeholder is code, not text.
    if (source[valueStart] === "`" && source.slice(valueStart, valueEnd).includes("${")) return undefined;
  }
  // The value must be the whole value: `x: 0 + gap` or `"a" + "b"` is computed, and replacing a part of it would be wrong.
  if (!/^[ \t]*(,|}|\r?\n|\/\/|\/\*|$)/.test(source.slice(valueEnd, valueEnd + 40))) return undefined;
  const keyStart = entry.open + 1 + match.index + match[1]!.length;
  if (type === "flag" && value !== true) return withoutField(source, entry.open, keyStart, valueEnd);
  // Written before a spread, the field may be overwritten by it: take it out and add it after the spread.
  const spread = afterLastSpread(body);
  if (spread && keyStart < entry.open + 1 + spread.at) {
    const without = withoutField(source, entry.open, keyStart, valueEnd);
    const moved = entryOf(without, kind, id);
    return moved && addField(without, moved.open, moved.close, key, literalOf(value, type));
  }
  return source.slice(0, valueStart) + literalOf(value, type) + source.slice(valueEnd);
}

/** The source without the field from `start` (its key) to `end` (past its value), and the comma that went with it. */
function withoutField(source: string, open: number, start: number, end: number): string {
  let after = end;
  while (source[after] === " " || source[after] === "\t") after++;
  if (source[after] === ",") {
    end = after + 1;
    while (source[end] === " " || source[end] === "\t") end++;
  } else {
    // The last field, with no comma of its own: the comma before it goes instead.
    let before = start;
    while (before > open + 1 && /\s/.test(source[before - 1]!)) before--;
    if (source[before - 1] === ",") start = before - 1;
  }
  // A field alone on its line takes the line with it.
  let lineStart = start;
  while (lineStart > 0 && (source[lineStart - 1] === " " || source[lineStart - 1] === "\t")) lineStart--;
  const lineEnd = source.startsWith("\r\n", end) ? end + 2 : source[end] === "\n" ? end + 1 : -1;
  if ((lineStart === 0 || source[lineStart - 1] === "\n") && lineEnd >= 0) return source.slice(0, lineStart) + source.slice(lineEnd);
  return source.slice(0, start) + source.slice(end);
}

/**
 * The ids of items whose position and size can be saved by a move or resize:
 * a literal id, plain number fields, and no `...spread` that could overwrite
 * them. An item that is generated by code (a loop, a computed id or number,
 * `...SIZE`) is not listed, so the page can warn before the first drag fails.
 */
export function placeableItems(source: string): string[] {
  const start = source.indexOf(`export const ${ARRAY.item}`);
  if (start < 0) return [];
  const next = source.indexOf("export const ", start + 1);
  const area = source.slice(start, next < 0 ? source.length : next);
  const ids = [...area.matchAll(/\bid\s*:\s*(["'])([a-z0-9][a-z0-9-]{0,79})\1/gi)].map((m) => m[2]!);
  return ids.filter((id) => {
    const entry = entryOf(source, "item", id);
    if (!entry || /\.\.\./.test(mask(source.slice(entry.open + 1, entry.close)))) return false;
    return (["x", "y", "width", "height"] as const).every((key) => setField(source, "item", id, key, 0) !== undefined);
  });
}

/** Applies the edits in order. Each edit is written only when every field it names can be placed. */
export function applyEdits(source: string, edits: DirectEdit[]): ApplyResult {
  let next = source;
  const applied: string[] = [];
  const missing: string[] = [];
  for (const edit of edits) {
    let working = next;
    let ok = !!entryOf(working, edit.kind, edit.id);
    for (const [key, value] of Object.entries(edit.set)) {
      if (!ok) break;
      const updated = setField(working, edit.kind, edit.id, key, value);
      if (updated === undefined) ok = false;
      else working = updated;
    }
    if (ok) {
      next = working;
      applied.push(edit.id);
    } else missing.push(edit.id);
  }
  return { source: next, applied, missing };
}

// New notes and sections are appended to the end of their array.

/** `id` is for putting a deleted entry back as it was; without it, the id is made from the text. */
export type DirectAdd = { kind: "note" | "section"; text: string; x: number; y: number; width?: number; height?: number; id?: string };
export type DirectRemove = { kind: "note" | "section"; id: string };

/** Checks a new entry from the browser before it goes near the file. */
export function validAdd(value: unknown): DirectAdd | undefined {
  const a = value as Partial<DirectAdd> | null;
  if (!a || typeof a !== "object" || !(a.kind === "note" || a.kind === "section")) return undefined;
  if (typeof a.text !== "string" || !a.text.trim() || a.text.length > MAX_TEXT) return undefined;
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= COORD_LIMIT ? Math.round(n) : undefined);
  const [x, y] = [num(a.x), num(a.y)];
  if (x === undefined || y === undefined) return undefined;
  const width = a.width === undefined ? undefined : num(a.width);
  const height = a.height === undefined ? undefined : num(a.height);
  // A section is a frame, so it needs a size; a note's size is optional.
  if (a.kind === "section" && (!width || !height)) return undefined;
  if (a.id !== undefined && (typeof a.id !== "string" || !ID.test(a.id))) return undefined;
  if ((a.width !== undefined && width === undefined) || (a.height !== undefined && height === undefined)) return undefined;
  return { kind: a.kind, text: a.text, x, y, ...(width ? { width } : {}), ...(height ? { height } : {}), ...(a.id ? { id: a.id } : {}) };
}

/** Checks a removal from the browser. Items are never removed from here. */
export function validRemove(value: unknown): DirectRemove | undefined {
  const r = value as Partial<DirectRemove> | null;
  if (!r || typeof r !== "object" || !(r.kind === "note" || r.kind === "section")) return undefined;
  return typeof r.id === "string" && ID.test(r.id) ? { kind: r.kind, id: r.id } : undefined;
}

/** The source without that entry, or undefined when it cannot be found exactly once. */
export function removeEntry(source: string, kind: DirectRemove["kind"], id: string): string | undefined {
  const entry = entryOf(source, kind, id);
  if (!entry) return undefined;
  let start = entry.open;
  while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
  const ownLine = start === 0 || source[start - 1] === "\n";
  let end = entry.close + 1;
  if (source[end] === ",") end++;
  while (source[end] === " " || source[end] === "\t") end++;
  // An entry alone on its line takes the line with it; one inline keeps its neighbours' layout.
  if (ownLine && source[end] === "\n") end++;
  const without = source.slice(0, start) + source.slice(end);
  // The last entry gone leaves an empty array as it was written before there was one: `[]`.
  return without.replace(new RegExp(`(export const ${ARRAY[kind]}\\b[^=]*=\\s*\\[)\\s+\\]`), "$1]");
}

/** A readable, unique id from the text, such as `keep-a-clearer-hierarchy`. */
function newId(text: string, kind: DirectAdd["kind"], used: Set<string>): string {
  let base = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  // Long text is cut at a word, not in the middle of one.
  if (base.length > 32) {
    base = base.slice(0, 32);
    const cut = base.lastIndexOf("-");
    if (cut > 8) base = base.slice(0, cut);
  }
  base = base.replace(/-+$/, "") || kind;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** The source with the entry added at the end of its array, or undefined when the array cannot be found. */
export function addEntry(source: string, add: DirectAdd): { source: string; id: string } | undefined {
  const array = ARRAY[add.kind];
  const head = new RegExp(`export const ${array}\\b[^=]*=\\s*\\[`).exec(source);
  if (!head) return undefined;
  const open = head.index + head[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i++) {
    const c = source[i]!;
    if (c === '"' || c === "'" || c === "`") {
      const stop = stringEnd(source, i);
      if (stop < 0) return undefined;
      i = stop - 1;
    } else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return undefined;
  const body = source.slice(open + 1, close);
  const used = new Set([...body.matchAll(/\bid\s*:\s*(["'])(.*?)\1/g)].map((m) => m[2]!));
  const id = add.id && !used.has(add.id) ? add.id : newId(add.text, add.kind, used);
  const key = add.kind === "note" ? "text" : "title";
  const size = `${add.width ? `, width: ${add.width}` : ""}${add.height ? `, height: ${add.height}` : ""}`;
  const entry = `{ id: ${JSON.stringify(id)}, ${key}: ${JSON.stringify(add.text)}, x: ${add.x}, y: ${add.y}${size} },`;
  const empty = !body.trim();
  // After the last entry, adding a comma if it has none; into an empty array, on its own line.
  const at = open + 1 + body.trimEnd().length;
  const comma = !empty && !body.trimEnd().endsWith(",") ? "," : "";
  return { source: `${source.slice(0, at)}${comma}\n  ${entry}${empty ? "\n" : ""}${source.slice(at)}`, id };
}
