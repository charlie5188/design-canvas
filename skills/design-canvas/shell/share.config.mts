import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadConfigFromFile, mergeConfig, type Plugin, type UserConfig, version as viteVersion } from "vite";

// Builds the canvas into one self-contained HTML file to share. The file opens
// from disk with a double-click, needs no server, and imports into Figma as a
// code layer. scripts/share.sh runs this with DESIGN_CANVAS_SHARE_DIR set to a
// temporary folder, then moves the file to where the person gets it.
//
// It reuses the canvas's own vite config, so the app's styles, aliases, and
// plugins build exactly as on the canvas page, then puts every script,
// stylesheet, image, and font inside the HTML. Files the app serves from its
// public folder by root path, such as "/logo.svg", are not part of the build;
// share.sh names the ones the file refers to.
const canvasDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// One bundle from the canvas page, with nothing split into separate files. Vite 8
// bundles with Rolldown, which names these options differently from Rollup.
const oneBundle = (input: string) =>
  (Number(viteVersion.split(".")[0]) >= 8
    ? { rolldownOptions: { input, output: { codeSplitting: false } } }
    : { rollupOptions: { input, output: { inlineDynamicImports: true } } }) as UserConfig["build"];

/** Moves the built scripts and styles into the page, and marks it as a shared file (see bridge.ts). */
function oneFile(): Plugin {
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
        // Anything the page does not reference stays a separate file, and share.sh reports it.
        if (html !== before) delete bundle[name];
      }
      page.source = html;
    },
  };
}

export default defineConfig(async (env): Promise<UserConfig> => {
  const outDir = process.env.DESIGN_CANVAS_SHARE_DIR;
  if (!outDir) throw new Error("design-canvas: run scripts/share.sh <canvas-folder> to share a canvas");
  const file = ["vite.config.mts", "vite.config.ts", "vite.config.mjs", "vite.config.js"]
    .map((name) => resolve(canvasDir, name))
    .find((path) => existsSync(path));
  if (!file) throw new Error(`design-canvas: no vite config in ${canvasDir}`);
  const config = (await loadConfigFromFile(env, file, canvasDir))?.config ?? {};

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
    publicDir: false,
    logLevel: "warn",
    plugins: [oneFile()],
    build: {
      outDir,
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
