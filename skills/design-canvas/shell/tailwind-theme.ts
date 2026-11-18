// Inspect (prototype): the Tailwind theme an app builds with, for its lists. Tailwind writes a
// theme value into the page only where a class uses it, so the page alone would offer only
// the colors and sizes already in use. This reads the theme where it is declared instead:
// Tailwind's own defaults (tailwindcss/theme.css) and the app's `@theme` blocks, as Vite loads
// the app's stylesheets. Runs in the dev server (agent-channel.ts serves it at THEME_PATH).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The theme namespaces the panel has rows for: colors, the spacing unit, radii, and type sizes. */
const KEPT = /^--(color|spacing|radius|text)(-[\w.-]*)?$/;

type Theme = { vars: Map<string, string>; resets: string[] };
/** What each stylesheet declares, by file, and whether one imports Tailwind. */
const sheets = new Map<string, Theme>();
let usesTailwind = false;

/** The `--name: value` pairs of every `@theme` block in a stylesheet, and the namespaces it resets (`--color-*: initial`). */
function parse(css: string): Theme {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const vars = new Map<string, string>();
  const resets: string[] = [];
  for (const block of code.matchAll(/@theme\b[^{;]*\{/g)) {
    let depth = 1;
    let end = block.index! + block[0].length;
    for (; end < code.length && depth; end++) {
      if (code[end] === "{") depth++;
      else if (code[end] === "}") depth--;
    }
    const body = code.slice(block.index! + block[0].length, end - 1);
    for (const declaration of body.split(";")) {
      const at = declaration.indexOf(":");
      if (at < 0) continue;
      const name = declaration.slice(0, at).trim();
      const value = declaration.slice(at + 1).trim().replace(/\s+/g, " ");
      if (/^--[\w-]*\*$/.test(name) && value === "initial") resets.push(name.slice(0, -1));
      // `--text-sm--line-height` belongs to `--text-sm`; it is no token of its own.
      else if (KEPT.test(name) && !name.slice(2).includes("--") && !name.startsWith("--text-shadow")) vars.set(name, value);
    }
  }
  return { vars, resets };
}

/** Called for each stylesheet Vite loads for the canvas. */
export function readStylesheet(id: string, css: string) {
  if (/@import\s+["']tailwindcss["']/.test(css)) usesTailwind = true;
  if (css.includes("@theme")) sheets.set(id, parse(css));
}

let defaults: Map<string, string> | null = null;
/** Tailwind's own theme, from the copy the app installed. */
function defaultTheme(root: string) {
  if (defaults) return defaults;
  for (let dir = root; ; dir = dirname(dir)) {
    const file = join(dir, "node_modules", "tailwindcss", "theme.css");
    if (existsSync(file)) return (defaults = parse(readFileSync(file, "utf8")).vars);
    if (dirname(dir) === dir) return (defaults = new Map());
  }
}

/** The theme as the app builds with it: Tailwind's defaults, less what the app resets, then the app's own. */
export function tailwindTheme(root: string): Record<string, string> {
  if (!usesTailwind) return {};
  const app = [...sheets.values()];
  const resets = app.flatMap((sheet) => sheet.resets);
  const theme = new Map<string, string>();
  for (const [name, value] of defaultTheme(root)) {
    if (!resets.some((reset) => reset === "--" || name.startsWith(reset))) theme.set(name, value);
  }
  for (const sheet of app) for (const [name, value] of sheet.vars) theme.set(name, value);
  return Object.fromEntries(theme);
}
