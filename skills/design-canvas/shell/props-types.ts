// Inspect (prototype): the props a design-system component takes and the values
// each one allows, read from the package's own type declarations (.d.ts), so the
// panel can offer `variant: solid | subtle | plain` instead of a free text field.
// Runs in the dev server (agent-channel.ts serves it at PROPS_PATH).
//
// It reads declaration text, not types: TypeScript 7 has no stable JavaScript API,
// and a project may have any version or none. It follows what declaration files of
// component libraries are made of: an `<Name>Options` (or `<Name>Props`) interface,
// string literal unions, indexed access into another interface (`Context["size"]`),
// aliases, imports, and re-exports. Anything else leaves the prop open (offered as
// read-only), never guessed.
// Aegis's `TokenName<"color.foreground">` is read as the tokens under that prefix.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

export type PropType = {
  name: string;
  /** Every value it takes, when the type lists them. */
  options: string[];
  boolean?: boolean;
  number?: boolean;
  /** Values outside `options` are possible too (a string, or a type this reader cannot list). */
  open?: boolean;
  default?: string;
};

// Each file's code with its comments swapped for markers (`@@3@@`), since a comment's
// apostrophe ("Button's") would read as a quote. The doc comments are kept by number.
const files = new Map<string, { code: string; docs: string[] }>();
function source(file: string) {
  let entry = files.get(file);
  if (!entry) {
    const raw = existsSync(file) ? readFileSync(file, "utf8") : "";
    const docs: string[] = [];
    const code = raw
      .replace(/\/\*([\s\S]*?)\*\//g, (_, doc: string) => ` @@${docs.push(doc) - 1}@@ `)
      .replace(/^\s*\/\/.*$/gm, "");
    entry = { code, docs };
    files.set(file, entry);
  }
  return entry;
}
const read = (file: string) => source(file).code;

/** The package's folder, found from the canvas folder as Node would find it. */
function packageDir(from: string, name: string) {
  try {
    return dirname(createRequire(join(from, "noop.js")).resolve(`${name}/package.json`));
  } catch {
    // Some packages do not export package.json: look in node_modules on the way up.
    for (let dir = from; ; dir = dirname(dir)) {
      const candidate = join(dir, "node_modules", name);
      if (existsSync(join(candidate, "package.json"))) return candidate;
      if (dirname(dir) === dir) return null;
    }
  }
}

function declarations(dir: string, found: string[] = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) declarations(path, found);
    else if (entry.endsWith(".d.ts")) found.push(path);
  }
  return found;
}

/** A module specifier in a declaration file, as a file path. */
function resolveModule(from: string, spec: string): string | null {
  if (spec.startsWith(".")) {
    const base = resolve(dirname(from), spec);
    for (const path of [`${base}.d.ts`, join(base, "index.d.ts"), base.replace(/\.js$/, ".d.ts")]) if (existsSync(path)) return path;
    return null;
  }
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  const sub = spec.slice(name.length);
  const dir = packageDir(dirname(from), name);
  if (!dir) return null;
  const pkg = JSON.parse((existsSync(join(dir, "package.json")) && readFileSync(join(dir, "package.json"), "utf8")) || "{}");
  const entry = pkg.exports?.[`.${sub}`] ?? (sub ? undefined : pkg.exports?.["."]);
  const types = typeof entry === "object" ? (entry.types ?? entry.import?.types) : undefined;
  if (types) return resolve(dir, types);
  if (!sub && pkg.types) return resolve(dir, pkg.types);
  return resolveModule(join(dir, "index.d.ts"), `.${sub || "/index"}`);
}

type Found = { kind: "interface"; body: string; extends: string[]; file: string } | { kind: "alias"; text: string; file: string };

/** A named interface or type alias, in this file or wherever it was imported from. */
function findType(file: string, name: string, depth = 0): Found | null {
  if (depth > 8 || !file) return null;
  const text = read(file);
  const iface = new RegExp(`interface\\s+${name}\\b(?:<[^>]*>)?\\s*(?:extends\\s+([^{]+))?\\{`).exec(text);
  if (iface) {
    const start = iface.index + iface[0].length;
    return { kind: "interface", body: text.slice(start, matching(text, start - 1)), extends: splitTop(iface[1] ?? "", ","), file };
  }
  const alias = new RegExp(`type\\s+${name}\\b(?:<[^>]*>)?\\s*=`).exec(text);
  if (alias) {
    const start = alias.index + alias[0].length;
    return { kind: "alias", text: text.slice(start, statementEnd(text, start)), file };
  }
  for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    for (const part of match[1]!.split(",")) {
      const [original, local] = part.replace(/\btype\s+/, "").trim().split(/\s+as\s+/);
      if ((local ?? original)?.trim() === name) {
        const next = resolveModule(file, match[2]!);
        if (next) return findType(next, original!.trim(), depth + 1);
      }
    }
  }
  for (const match of text.matchAll(/export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g)) {
    if (match[0].includes("{") && !new RegExp(`\\b${name}\\b`).test(match[0])) continue;
    const next = resolveModule(file, match[1]!);
    const found = next && findType(next, name, depth + 1);
    if (found) return found;
  }
  return null;
}

/** The index of the bracket that closes the one at `open`. */
function matching(text: string, open: number) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") i = text.indexOf(c, i + 1);
    else if (c === "{" || c === "(" || c === "[" || c === "<") depth++;
    else if (c === "}" || c === ")" || c === "]" || (c === ">" && text[i - 1] !== "=")) {
      if (--depth === 0) return i;
    }
  }
  return text.length;
}
function statementEnd(text: string, from: number) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") i = text.indexOf(c, i + 1);
    else if ("{([<".includes(c!)) depth++;
    else if ("})]".includes(c!) || (c === ">" && text[i - 1] !== "=")) depth--;
    else if (c === ";" && depth === 0) return i;
  }
  return text.length;
}
/** Splits at `separator` outside brackets and quotes. */
function splitTop(text: string, separator: string) {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") i = text.indexOf(c, i + 1);
    else if ("{([<".includes(c!)) depth++;
    else if ("})]".includes(c!) || (c === ">" && text[i - 1] !== "=")) depth--;
    else if (c === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

type Members = Map<string, { type: string; file: string; doc: string }>;
/** An interface's members, those of the interfaces it extends first. */
function members(found: Found, depth = 0): Members {
  const out: Members = new Map();
  if (found.kind !== "interface" || depth > 6) return out;
  for (const parent of found.extends) {
    const base = findType(found.file, parent.replace(/<.*$/, "").trim());
    if (base) for (const [name, member] of members(base, depth + 1)) out.set(name, member);
  }
  for (const chunk of splitTop(found.body, ";")) {
    const marker = /@@(\d+)@@/.exec(chunk);
    const doc = marker ? (source(found.file).docs[Number(marker[1])] ?? "") : "";
    const signature = chunk.replace(/@@\d+@@/g, "").trim();
    const member = /^(?:readonly\s+)?["']?([A-Za-z_$][\w$-]*)["']?\??\s*:\s*([\s\S]+)$/.exec(signature);
    if (member) out.set(member[1]!, { type: member[2]!.trim(), file: found.file, doc });
  }
  return out;
}

type Parts = { options: Set<string>; boolean: boolean; number: boolean; open: boolean };
function typeParts(text: string, file: string, parts: Parts, depth = 0) {
  if (depth > 10) {
    parts.open = true;
    return;
  }
  for (let part of splitTop(text.trim(), "|")) {
    part = part.trim();
    while (part.startsWith("(") && matching(part, 0) === part.length - 1) part = part.slice(1, -1).trim();
    const literal = /^["']([^"']*)["']$/.exec(part);
    if (literal) parts.options.add(literal[1]!);
    else if (part === "undefined" || part === "null" || part === "never") continue;
    else if (part === "boolean" || part === "true" || part === "false") parts.boolean = true;
    else if (part === "number" || /^-?\d+(\.\d+)?$/.test(part)) parts.number = true;
    else if (/^TokenName<["'][^"']+["']>$/.test(part)) {
      // Aegis: the token names under a prefix, without it.
      const prefix = /["']([^"']+)["']/.exec(part)![1]!;
      const token = findType(file, "TokenName");
      const all = token && findType(token.file, "Token");
      if (all?.kind === "alias") {
        const names = new Set<string>();
        typeParts(all.text, all.file, { options: names, boolean: false, number: false, open: false }, depth + 1);
        for (const name of names) if (name.startsWith(`${prefix}.`)) parts.options.add(name.slice(prefix.length + 1));
      } else parts.open = true;
    } else {
      const indexed = /^([A-Za-z_$][\w$]*)\[["']([^"']+)["']\]$/.exec(part);
      const named = /^([A-Za-z_$][\w$]*)$/.exec(part);
      if (indexed) {
        const found = findType(file, indexed[1]!);
        const member = found && members(found).get(indexed[2]!);
        if (member) typeParts(member.type, member.file, parts, depth + 1);
        else parts.open = true;
      } else if (named) {
        const found = findType(file, named[1]!);
        if (found?.kind === "alias") typeParts(found.text, found.file, parts, depth + 1);
        else parts.open = true;
      } else parts.open = true;
    }
  }
}

const indexCache = new Map<string, string[]>();
/** The props of `component`, an export of `pkg`, with the values each allows. */
export function componentProps(from: string, pkg: string, component: string): PropType[] | null {
  const dir = packageDir(from, pkg);
  if (!dir || !/^[A-Z][\w]*$/.test(component)) return null;
  let all = indexCache.get(dir);
  if (!all) {
    all = declarations(dir);
    indexCache.set(dir, all);
  }
  const declared = new RegExp(`export\\s+declare\\s+(?:const|function)\\s+${component}\\b`);
  const file = all.find((path) => declared.test(read(path)));
  if (!file) return null;
  const options = findType(file, `${component}Options`) ?? findType(file, `${component}Props`);
  if (!options || options.kind !== "interface") return null;
  const props: PropType[] = [];
  for (const [name, member] of members(options)) {
    if (/@deprecated/.test(member.doc)) continue;
    const parts: Parts = { options: new Set(), boolean: false, number: false, open: false };
    typeParts(member.type, member.file, parts);
    const fallback = /@default\s+["']?([^"'\s*]+)["']?/.exec(member.doc)?.[1];
    props.push({
      name,
      options: [...parts.options],
      ...(parts.boolean ? { boolean: true } : {}),
      ...(parts.number ? { number: true } : {}),
      ...(parts.open ? { open: true } : {}),
      ...(fallback !== undefined ? { default: fallback } : {}),
    });
  }
  return props;
}
