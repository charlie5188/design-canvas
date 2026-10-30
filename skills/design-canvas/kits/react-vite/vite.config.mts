import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type Alias,
  defineConfig,
  loadConfigFromFile,
  loadEnv,
  type Plugin,
  searchForWorkspaceRoot,
  type UserConfig,
  version as viteVersion,
} from "vite";

// A standalone Vite page beside the app. It renders the app's own components
// without touching the app's build, routes, or server.
const canvasDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(canvasDir, "__APP_DIR__");

/** JSON with comments and trailing commas, as tsconfig.json allows. */
function readJsonc(file: string): Record<string, any> {
  const text = readFileSync(file, "utf8");
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) break;
      i = end + 1;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The app's import aliases from the first tsconfig/jsconfig with `paths`.
 * Add any that live only in an `extends` base by hand.
 */
function pathAliases(): Alias[] {
  for (const name of ["tsconfig.app.json", "tsconfig.json", "jsconfig.json"]) {
    const file = resolve(appDir, name);
    if (!existsSync(file)) continue;
    const options = readJsonc(file).compilerOptions ?? {};
    if (!options.paths) continue;
    const base = resolve(appDir, options.baseUrl ?? ".");
    return Object.entries<string[]>(options.paths).flatMap(([key, targets]): Alias[] => {
      const target = targets[0];
      if (!target) return [];
      if (!key.endsWith("/*")) return [{ find: new RegExp(`^${escapeRegExp(key)}$`), replacement: resolve(base, target) }];
      return [
        {
          find: new RegExp(`^${escapeRegExp(key.slice(0, -2))}/(.*)$`),
          replacement: `${resolve(base, target.replace(/\*$/, ""))}/$1`,
        },
      ];
    });
  }
  return [];
}

// Next.js modules that only work inside Next are swapped for small stand-ins.
const pkg = readJsonc(resolve(appDir, "package.json"));
const usesNext = Boolean(pkg.dependencies?.next ?? pkg.devDependencies?.next);
const mock = (file: string) => resolve(canvasDir, "mocks", file);
const nextAliases: Alias[] = usesNext
  ? [
      { find: /^next\/link$/, replacement: mock("next-link.tsx") },
      { find: /^next\/image$/, replacement: mock("next-image.tsx") },
      { find: /^next\/navigation$/, replacement: mock("next-navigation.ts") },
    ]
  : [];

// next/font runs in Next's compiler only; on the canvas every font is a no-op.
const nextFont: Plugin = {
  name: "design-canvas:next-font",
  enforce: "pre",
  transform(code, id) {
    if (!usesNext || id.includes("node_modules") || !code.includes("next/font/")) return;
    return code.replace(
      /import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']next\/font\/(?:google|local)["'];?/g,
      (_match, defaultName: string | undefined, named: string | undefined) =>
        [defaultName, ...(named ?? "").split(",").map((part) => part.split(/\s+as\s+/).pop()?.trim())]
          .filter(Boolean)
          .map((name) => `const ${name} = () => ({ className: "", variable: "", style: {} });`)
          .join("\n"),
    );
  },
};

// Vite apps: reuse the app's own React, Tailwind, and SVG plugins. Framework
// plugins (routers, SSR, PWA) stay out; they expect the app's entry and routes.
const REUSED_PLUGINS = [/^vite:react/, /^@tailwindcss\/vite/, /^vite-plugin-svgr/, /^vite-tsconfig-paths/];

async function appPlugins(mode: string): Promise<Plugin[]> {
  const configFile = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"]
    .map((name) => resolve(appDir, name))
    .find((file) => existsSync(file));
  if (!configFile) return [];
  const env = { command: "serve" as const, mode, isSsrBuild: false, isPreview: false };
  const loaded = await loadConfigFromFile(env, configFile, appDir, "silent");
  const plugins: Plugin[] = [];
  const visit = async (option: unknown): Promise<void> => {
    const value = await option;
    if (Array.isArray(value)) for (const item of value) await visit(item);
    else if (value && typeof value === "object" && "name" in value) plugins.push(value as Plugin);
  };
  await visit(loaded?.config.plugins ?? []);
  return plugins.filter((plugin) => REUSED_PLUGINS.some((pattern) => pattern.test(plugin.name)));
}

/** Imports an ESM package from the app's node_modules, or its nearest ancestor's. */
async function importFromApp(name: string): Promise<Record<string, unknown> | undefined> {
  for (let dir = appDir; ; dir = dirname(dir)) {
    const packageDir = resolve(dir, "node_modules", name);
    if (existsSync(resolve(packageDir, "package.json"))) {
      const meta = readJsonc(resolve(packageDir, "package.json"));
      const root = meta.exports?.["."] ?? meta.exports;
      const entry = [root?.import?.default, root?.import, root?.default, root, meta.module, meta.main].find(
        (candidate) => typeof candidate === "string",
      );
      return entry ? import(pathToFileURL(resolve(packageDir, entry)).href) : undefined;
    }
    if (dirname(dir) === dir) return undefined;
  }
}

// Tailwind 4 apps that compile CSS outside PostCSS and Vite, such as Next.js
// with Turbopack, need @tailwindcss/vite on the canvas. install.sh says when
// it is missing; adding it is the user's call.
const postcssConfigured =
  "postcss" in pkg ||
  ["postcss.config.js", "postcss.config.cjs", "postcss.config.mjs", "postcss.config.ts", ".postcssrc", ".postcssrc.json"].some(
    (name) => existsSync(resolve(appDir, name)),
  );

// Tailwind 4 scans from the Vite root, which is the canvas folder. Point the
// app's Tailwind stylesheet at the whole app so its components' classes build.
const tailwindSources: Plugin = {
  name: "design-canvas:tailwind-sources",
  enforce: "pre",
  transform(code, id) {
    const file = id.split("?")[0] ?? id;
    if (!file.endsWith(".css") || !file.startsWith(appDir) || file.includes("node_modules")) return;
    if (!/@import\s+["']tailwindcss["']/.test(code)) return;
    return `${code}\n@source "${relative(dirname(file), appDir) || "."}";\n`;
  },
};

async function tailwindPlugins(reused: Plugin[]): Promise<Plugin[]> {
  if (postcssConfigured || reused.some((plugin) => plugin.name.startsWith("@tailwindcss/vite"))) return [];
  const tailwind = (await importFromApp("@tailwindcss/vite"))?.default;
  if (typeof tailwind !== "function") return [];
  const plugins: unknown = tailwind();
  return (Array.isArray(plugins) ? plugins : [plugins]) as Plugin[];
}

// The automatic JSX runtime, so previews need no React import. Vite 8 compiles
// with Oxc; earlier versions with esbuild.
const automaticJsx = (
  Number(viteVersion.split(".")[0]) >= 8 ? { oxc: { jsx: { runtime: "automatic" } } } : { esbuild: { jsx: "automatic" } }
) as UserConfig;

export default defineConfig(async ({ mode }): Promise<UserConfig> => {
  // Public variables only; server secrets never reach the canvas.
  const env = loadEnv(mode, appDir, ["NEXT_PUBLIC_", "VITE_"]);
  const reused = await appPlugins(mode);
  return {
    root: canvasDir,
    envDir: appDir,
    // Root-relative assets such as "/logo.svg" come from the app's public folder.
    publicDir: existsSync(resolve(appDir, "public")) ? resolve(appDir, "public") : false,
    plugins: [nextFont, tailwindSources, ...reused, ...(await tailwindPlugins(reused))],
    // The app's PostCSS setup, such as Tailwind; Vite would otherwise search from the canvas folder.
    css: { postcss: appDir },
    define: { "process.env": JSON.stringify({ NODE_ENV: "development", ...env }) },
    resolve: { alias: [...nextAliases, ...pathAliases()], dedupe: ["react", "react-dom"] },
    ...automaticJsx,
    // Each canvas has its own port, picked at install from its folder path. Strict:
    // moving to the next free port would let an open tab of one canvas reload
    // into another canvas, and both would share one origin's saved layout.
    server: {
      host: "127.0.0.1",
      port: Number("__CANVAS_PORT__"),
      strictPort: true,
      fs: { allow: [searchForWorkspaceRoot(appDir)] },
    },
  };
});
