// Writes a move, resize, or text change straight into registry.tsx, so it lands
// in the source as soon as the person makes it, without a message to the agent.
// Only the fields listed here are touched, and only inside the named array
// (`notes`, `sections`, or `registry`), so nothing else in the file can change.
//
// It works on the text of the file, not a parser: each entry is found by its
// `id`, its own braces are matched, and a field is replaced at the top level of
// that object. An edit that cannot be placed exactly is reported as missing and
// is not written, so the change falls back to the agent.

export type DirectKind = "note" | "section" | "item";
export type DirectEdit = { kind: DirectKind; id: string; set: Record<string, number | string> };
export type ApplyResult = { source: string; applied: string[]; missing: string[] };

const ARRAY: Record<DirectKind, string> = { note: "notes", section: "sections", item: "registry" };
const FIELDS: Record<DirectKind, Record<string, "number" | "string">> = {
  note: { x: "number", y: "number", width: "number", height: "number", text: "string" },
  section: { x: "number", y: "number", width: "number", height: "number", title: "string" },
  item: { x: "number", y: "number" },
};
const COORD_LIMIT = 100_000;
const MAX_TEXT = 1000;
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/i;

/** Checks an edit from the browser before it goes near the file. */
export function validEdit(value: unknown): DirectEdit | undefined {
  const e = value as Partial<DirectEdit> | null;
  if (!e || typeof e !== "object" || !(e.kind === "note" || e.kind === "section" || e.kind === "item")) return undefined;
  if (typeof e.id !== "string" || !ID.test(e.id) || !e.set || typeof e.set !== "object") return undefined;
  const set: Record<string, number | string> = {};
  for (const [key, raw] of Object.entries(e.set)) {
    const type = FIELDS[e.kind][key];
    if (!type) return undefined;
    if (type === "number" && typeof raw === "number" && Number.isFinite(raw) && Math.abs(raw) <= COORD_LIMIT) set[key] = Math.round(raw);
    else if (type === "string" && typeof raw === "string" && raw.length <= MAX_TEXT) set[key] = raw;
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

const literalOf = (value: number | string, type: "number" | "string") =>
  type === "number" ? String(value) : JSON.stringify(value);

/** Replaces one field of an entry, or adds it after the opening brace when the entry has none. Returns false when it cannot place it. */
function setField(source: string, kind: DirectKind, id: string, key: string, value: number | string): string | undefined {
  const entry = entryOf(source, kind, id);
  if (!entry) return undefined;
  const type = FIELDS[kind][key]!;
  const body = source.slice(entry.open + 1, entry.close);
  const match = new RegExp(`(^|[^\\w$.])${key}\\s*:\\s*`).exec(mask(body));
  if (!match) {
    // Multi-line entries get the field on its own line, at the indentation of their next line; single-line ones keep their layout.
    const line = /^\s*\n([ \t]*)/.exec(source.slice(entry.open + 1));
    const added = line ? `\n${line[1]}${key}: ${literalOf(value, type)},` : ` ${key}: ${literalOf(value, type)},`;
    return source.slice(0, entry.open + 1) + added + source.slice(entry.open + 1);
  }
  const valueStart = entry.open + 1 + match.index + match[0].length;
  let valueEnd: number;
  if (type === "number") {
    const number = /^-?\d+(\.\d+)?/.exec(source.slice(valueStart, entry.close));
    if (!number) return undefined;
    valueEnd = valueStart + number[0].length;
  } else {
    if (source[valueStart] !== '"' && source[valueStart] !== "'" && source[valueStart] !== "`") return undefined;
    valueEnd = stringEnd(source, valueStart);
    if (valueEnd < 0) return undefined;
  }
  return source.slice(0, valueStart) + literalOf(value, type) + source.slice(valueEnd);
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
