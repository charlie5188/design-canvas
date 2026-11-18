// Stand-ins for framework modules that cannot run on the canvas (stand-ins/), and how they are
// wired: a Vite plugin that agent-channel.ts returns with its own, so every canvas's vite config
// already loads it and an update reaches canvases installed before it. They live in the shell,
// not the kit, for that reason: a kit file belongs to its canvas once installed, and update.sh
// leaves it alone.
//
// - Next.js: next/link, next/image, next/navigation, next/dynamic, next/script, next/head,
//   next/cache, next/headers, and server-only are aliased to stand-ins; a "use server" file
//   becomes stand-ins that save nothing; next/font calls return empty fonts.
// - React Router: the stand-in (stand-ins/react-router.tsx) imports "react-router"; an app
//   with react-router-dom alone gets it aliased there.
//
// A canvas installed before this aliased next/link, next/image, and next/navigation to its own
// copies in mocks/. Those aliases are replaced by these, unless the copy exports more than the
// shell's (it was changed on purpose). An alias a canvas points anywhere else is its own, and stays.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Alias, Plugin } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const standIn = (file: string) => join(here, "stand-ins", file);

const NEXT: Alias[] = [
  { find: /^next\/link$/, replacement: standIn("next-link.tsx") },
  { find: /^next\/image$/, replacement: standIn("next-image.tsx") },
  { find: /^next\/navigation$/, replacement: standIn("next-navigation.ts") },
  { find: /^next\/dynamic$/, replacement: standIn("next-dynamic.tsx") },
  { find: /^next\/(script|head)$/, replacement: standIn("next-script.tsx") },
  // Server modules a client component reaches through a server action: no server here.
  { find: /^next\/cache$/, replacement: standIn("next-cache.ts") },
  { find: /^next\/headers$/, replacement: standIn("next-headers.ts") },
  { find: /^server-only$/, replacement: standIn("empty.ts") },
];
/** An alias to a copy the kit used to install in mocks/: replaced by the shell's own. */
const KIT_COPY = /[\\/]mocks[\\/](next-[a-z]+|empty|react-router)\.tsx?$/;

/** A file that starts with "use server" holds server actions. */
const USE_SERVER = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/;
const SOURCE = /\.[cm]?[jt]sx?$/;

function dependencies(appDir: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
    return { ...pkg.devDependencies, ...pkg.dependencies };
  } catch {
    return {};
  }
}
const resolvable = (name: string, appDir: string) => {
  try {
    createRequire(join(appDir, "noop.js")).resolve(`${name}/package.json`);
    return true;
  } catch {
    return existsSync(join(appDir, "node_modules", name, "package.json"));
  }
};

/** The names a module exports, read from its text. */
function exportsOf(file: string): Set<string> | null {
  try {
    const code = readFileSync(file, "utf8");
    const names = [...code.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([\w$]+)/g)].map((m) => m[1]!);
    if (/export\s+default\b/.test(code)) names.push("default");
    return new Set(names);
  } catch {
    return null;
  }
}
/** Whether a canvas's own copy of a stand-in exports more than the shell's (it was made its own). */
function extends_(copy: string) {
  const theirs = exportsOf(copy);
  const ours = exportsOf(standIn(basename(copy)));
  return !theirs || !ours || [...theirs].some((name) => !ours.has(name));
}

export function standIns(): Plugin {
  let usesNext = false;
  return {
    name: "design-canvas:stand-ins",
    // Before the other transforms: a "use server" file must not reach the app's own plugins as it is.
    enforce: "pre",
    config(config) {
      // The kit points envDir at the app; a canvas folder is <app>/design-canvas/<name> otherwise.
      const root = resolve(config.root ?? process.cwd());
      const appDir = config.envDir ? resolve(root, config.envDir) : resolve(root, "../..");
      const deps = dependencies(appDir);
      usesNext = !!deps.next;
      const ours: Alias[] = usesNext ? [...NEXT] : [];
      if (deps["react-router-dom"] && !deps["react-router"] && !resolvable("react-router", appDir)) {
        ours.push({ find: /^react-router$/, replacement: "react-router-dom" });
      }
      if (!ours.length) return;
      const alias = config.resolve?.alias;
      const list: Alias[] = Array.isArray(alias)
        ? alias
        : Object.entries(alias ?? {}).map(([find, replacement]) => ({ find, replacement: String(replacement) }));
      // An old copy that exports something the shell's does not was changed on purpose: it stays.
      const replaced = (entry: Alias) =>
        typeof entry.replacement === "string" && KIT_COPY.test(entry.replacement) && !extends_(entry.replacement);
      const theirs = list.filter((entry) => !replaced(entry));
      const taken = (find: Alias["find"]) => theirs.some((entry) => String(entry.find) === String(find));
      config.resolve ??= {};
      config.resolve.alias = [...ours.filter((entry) => !taken(entry.find)), ...theirs];
    },
    transform(code, id) {
      if (!usesNext || id.includes("node_modules") || !SOURCE.test(id.split("?")[0]!)) return undefined;
      // A server action imported by a client component (a form's action, a button's handler)
      // would bring server code into the page, which fails and leaves the whole canvas blank.
      // Each becomes a stand-in that saves nothing, waits a moment so a pending state shows,
      // and says so in the console.
      if (USE_SERVER.test(code)) {
        const names = new Set<string>();
        for (const match of code.matchAll(/export\s+(?:async\s+)?function\s*\*?\s*([\w$]+)/g)) names.add(match[1]!);
        for (const match of code.matchAll(/export\s+(?:const|let|var)\s+([\w$]+)/g)) names.add(match[1]!);
        for (const match of code.matchAll(/export\s*\{([^}]*)\}/g)) {
          for (const part of match[1]!.split(",")) {
            const name = part.split(/\s+as\s+/).pop()?.trim();
            if (name && name !== "default") names.add(name);
          }
        }
        const lines = [
          "const stub = (name) => async () => {",
          "  console.info(`design-canvas: the server action ${name} does not run on the canvas.`);",
          "  await new Promise((resolve) => setTimeout(resolve, 300));",
          "};",
          ...[...names].map((name) => `export const ${name} = stub(${JSON.stringify(name)});`),
          /export\s+default\b/.test(code) ? `export default stub("default");` : "",
        ];
        return { code: lines.join("\n"), map: null };
      }
      // next/font runs in Next's compiler only; on the canvas every font is a no-op.
      if (code.includes("next/font/")) {
        return code.replace(
          /import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']next\/font\/(?:google|local)["'];?/g,
          (_match, defaultName: string | undefined, named: string | undefined) =>
            [defaultName, ...(named ?? "").split(",").map((part) => part.split(/\s+as\s+/).pop()?.trim())]
              .filter(Boolean)
              .map((name) => `const ${name} = () => ({ className: "", variable: "", style: {} });`)
              .join("\n"),
        );
      }
      return undefined;
    },
  };
}
