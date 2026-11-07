import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadConfigFromFile, mergeConfig, type Plugin, type UserConfig, version as viteVersion } from "vite";

// Builds the canvas into one self-contained HTML file to share. The file opens
// from disk with a double-click, needs no server, and imports into Figma as a
// code layer. The toolbar's Share button (agent-channel.ts) and scripts/share.sh
// both build with this config.
//
// It reuses the canvas's own vite config, so the app's styles, aliases, and
// plugins build exactly as on the canvas page, then puts every script,
// stylesheet, image, and font inside the HTML, including files the app serves
// from its public folder by root path, such as "/logo.svg". It warns about
// anything that could not go inside.
const canvasDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** What could not go inside the file, beside it in the build. The Share button (agent-channel.ts) reads it by this name. */
const SHARE_REPORT = "design-canvas-share.json";
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// One bundle from the canvas page, with nothing split into separate files. Vite 8
// bundles with Rolldown, which names these options differently from Rollup.
const oneBundle = (input: string) =>
  (Number(viteVersion.split(".")[0]) >= 8
    ? { rolldownOptions: { input, output: { codeSplitting: false } } }
    : { rollupOptions: { input, output: { inlineDynamicImports: true } } }) as UserConfig["build"];

const MEDIA: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
};
const OTHER: Record<string, string> = { json: "application/json", pdf: "application/pdf" };
const TYPES = { ...MEDIA, ...OTHER };
// A root path to a file, in quotes or url(): "/logo.svg", url(/fonts/a.woff2).
// A path built at runtime, such as `/avatars/${id}.png`, has no whole literal to find.
const ROOT_FILE = new RegExp(`(["'\`(])(/(?!/)[\\w\\-.~@%+/]+\\.(${Object.keys(TYPES).join("|")}))(?=["'\`)])`, "gi");

/** Puts the public-folder files the page refers to inside it as data URLs. Returns the media it could not find. */
function inlinePublicFiles(html: string, publicDir: string | undefined) {
  const missing = new Set<string>();
  const result = html.replace(ROOT_FILE, (match, open: string, path: string, extension: string) => {
    const type = extension.toLowerCase();
    let file: string | undefined;
    try {
      file = publicDir && resolve(publicDir, `.${decodeURIComponent(path)}`);
    } catch {
      // A malformed escape is not a file path.
    }
    if (!file || !publicDir || !file.startsWith(publicDir + sep) || !existsSync(file)) {
      // JSON and PDF paths in library code are often not files at all; only media is worth a warning.
      if (type in MEDIA) missing.add(path);
      return match;
    }
    return `${open}data:${TYPES[type]};base64,${readFileSync(file).toString("base64")}`;
  });
  return { html: result, missing: [...missing] };
}

/** Moves everything the page uses into it, and marks it as a shared file (see bridge.ts). */
function oneFile(publicDir: string | undefined): Plugin {
  return {
    name: "design-canvas:one-file",
    enforce: "post",
    transformIndexHtml: (html) => html.replace(/<html\b/i, '<html data-design-canvas="shared"'),
    generateBundle(_options, bundle) {
      const page = bundle["index.html"];
      if (page?.type !== "asset") return;
      let html = String(page.source);
      for (const [name, file] of Object.entries(bundle)) {
        const before = html;
        if (file.type === "chunk") {
          // An inline module script still runs after the page is parsed. "</script"
          // inside the code would end the tag early.
          const code = file.code.replace(/<\/script/gi, "<\\/script");
          const tag = new RegExp(`<script[^>]*src="[^"]*${escapeRegExp(name)}"[^>]*></script>`);
          html = html.replace(tag, () => `<script type="module">${code}</script>`);
        } else if (name.endsWith(".css")) {
          const tag = new RegExp(`<link[^>]*href="[^"]*${escapeRegExp(name)}"[^>]*>`);
          html = html.replace(tag, () => `<style>${String(file.source)}</style>`);
        }
        if (html !== before) delete bundle[name];
      }
      const inlined = inlinePublicFiles(html, publicDir);
      page.source = inlined.html;

      const left = Object.keys(bundle).filter((name) => name !== "index.html");
      this.emitFile({
        type: "asset",
        fileName: SHARE_REPORT,
        source: JSON.stringify({ missing: [...inlined.missing, ...left] }),
      });
      if (left.length)
        this.warn(`these built files cannot go inside the shared file, so it will miss them: ${left.join(", ")}`);
      if (inlined.missing.length)
        this.warn(
          `these files are not in the app's public folder, so they will not load in the shared file: ${inlined.missing.join(", ")}. Check each path, or import the file in its item.`,
        );
    },
  };
}

export default defineConfig(async (env): Promise<UserConfig> => {
  const file = ["vite.config.mts", "vite.config.ts", "vite.config.mjs", "vite.config.js"]
    .map((name) => resolve(canvasDir, name))
    .find((path) => existsSync(path));
  if (!file) throw new Error(`design-canvas: no vite config in ${canvasDir}`);
  const config = (await loadConfigFromFile(env, file, canvasDir))?.config ?? {};
  // Where the canvas serves root paths from: the kit points it at the app's public folder.
  const publicDir =
    config.publicDir === false
      ? undefined
      : resolve(config.root ?? canvasDir, typeof config.publicDir === "string" ? config.publicDir : "public");

  // React's production build: smaller and faster than the development build the
  // canvas page uses. The app's public environment values stay as they are.
  let define = config.define;
  const processEnv = define?.["process.env"];
  if (typeof processEnv === "string") {
    try {
      define = { ...define, "process.env": JSON.stringify({ ...JSON.parse(processEnv), NODE_ENV: "production" }) };
    } catch {
      // Not the JSON the kit writes; keep the canvas's own value.
    }
  }

  return mergeConfig({ ...config, define }, {
    // Relative URLs, so the file works wherever it is opened.
    base: "./",
    // Root-path files go inside the file instead (see inlinePublicFiles).
    publicDir: false,
    logLevel: "warn",
    plugins: [oneFile(publicDir)],
    build: {
      // share.sh moves the file out of a temporary folder; the Share button builds in memory.
      outDir: process.env.DESIGN_CANVAS_SHARE_DIR ?? resolve(canvasDir, "shared", ".build"),
      emptyOutDir: true,
      // Every imported image, font, and icon goes inside the file as a data URL.
      assetsInlineLimit: 1e9,
      cssCodeSplit: false,
      modulePreload: false,
      reportCompressedSize: false,
      // One file is the point, so its size is not worth a warning.
      chunkSizeWarningLimit: 1e6,
      ...oneBundle(resolve(canvasDir, "index.html")),
    },
  } satisfies UserConfig);
});
