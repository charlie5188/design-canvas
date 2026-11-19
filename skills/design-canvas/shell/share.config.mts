import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadConfigFromFile, mergeConfig, type Plugin, type UserConfig, version as viteVersion } from "vite";
import { listImages } from "./registry-edit.ts";

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
const EXTENSIONS = Object.keys(TYPES).join("|");
// A root path to a file, in quotes or url(): "/logo.svg", url(/fonts/a.woff2).
// A path built at runtime, such as `/avatars/${id}.png`, has no whole literal to find.
const ROOT_FILE = new RegExp(`(["'\`(])(/(?!/)[\\w\\-.~@%+/]+\\.(${EXTENSIONS}))(?=["'\`)])`, "gi");
// A root path in CSS text that code holds, such as "background:url(/logo.svg)" or url(\"/logo.svg\").
const CSS_URL = new RegExp(`(url\\(\\s*\\\\?["']?)(/(?!/)[\\w\\-.~@%+/]+\\.(${EXTENSIONS}))(?=\\\\?["']?\\s*\\))`, "gi");

/** A public-folder file as a data URL, by its root path; undefined when no such file exists. */
function publicFile(path: string, extension: string, publicDir: string | undefined) {
  let file: string | undefined;
  try {
    file = publicDir && resolve(publicDir, `.${decodeURIComponent(path)}`);
  } catch {
    // A malformed escape is not a file path.
  }
  if (!file || !publicDir || !file.startsWith(publicDir + sep) || !existsSync(file)) return undefined;
  return `data:${TYPES[extension.toLowerCase()]};base64,${readFileSync(file).toString("base64")}`;
}

/**
 * The public-folder files that markup, stylesheets, and code name by root path. Markup
 * and stylesheets only load a path, so it is swapped for the file in place. Code may also
 * check or change a path before it loads it, such as an app's base-path helper that
 * rejects anything not starting with "/"; given a data URL there, it threw and left the
 * shared file blank. So code keeps its paths, except inside CSS text, and the page swaps
 * each one for its file as it loads it (see ROOT_FILES).
 */
function publicFiles(publicDir: string | undefined) {
  const missing = new Set<string>();
  /** Root paths in code, with each file: for the page to swap. */
  const files: Record<string, string> = {};
  const swap = (pattern: RegExp) => (text: string) =>
    text.replace(pattern, (match, open: string, path: string, extension: string) => {
      const file = publicFile(path, extension, publicDir);
      // JSON and PDF paths in library code are often not files at all; only media is worth a warning.
      if (!file && extension.toLowerCase() in MEDIA) missing.add(path);
      return file ? `${open}${file}` : match;
    });
  const inMarkup = swap(ROOT_FILE);
  const inCss = swap(CSS_URL);
  const inCode = (code: string) => {
    const result = inCss(code);
    for (const [, , path, extension] of result.matchAll(ROOT_FILE)) {
      const file = publicFile(path, extension, publicDir);
      if (file) files[path] = file;
      else if (extension.toLowerCase() in MEDIA) missing.add(path);
    }
    return result;
  };
  return { inMarkup, inCode, files, missing };
}

/**
 * Loads the code's root paths from inside the file. It swaps each path for its file
 * where the page loads it: an element's src, href, srcset, poster, or inline style
 * url(), and fetch(). The code itself still holds and passes the path, as on the
 * canvas page. A file opened from disk has no server to answer a root path, so this
 * is the only place the swap can happen.
 */
const ROOT_FILES = (files: Record<string, string>) => `<script>(function (files) {
  var has = function (path) { return Object.prototype.hasOwnProperty.call(files, path); };
  var one = function (value) { return has(value) ? files[value] : value; };
  var list = function (value) {
    return value.split(",").map(function (part) {
      var found = /^(\\s*)(\\S+)([\\s\\S]*)$/.exec(part);
      return found && has(found[2]) ? found[1] + files[found[2]] + found[3] : part;
    }).join(",");
  };
  var urls = function (value) {
    return value.replace(/url\\(\\s*(["']?)([^"')]+)\\1\\s*\\)/g, function (match, quote, path) {
      return has(path) ? "url(" + quote + files[path] + quote + ")" : match;
    });
  };
  var ways = { src: one, href: one, poster: one, srcset: list, style: urls };
  var fix = function (element) {
    for (var name in ways) {
      var value = element.getAttribute(name);
      var next = value && ways[name](value);
      if (next && next !== value) element.setAttribute(name, next);
    }
  };
  // At once where code sets the attribute, as React does, so the browser never asks for the bare path.
  var set = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    var way = ways[String(name).toLowerCase()];
    return set.call(this, name, way && value != null ? way(String(value)) : value);
  };
  // The rest as it changes: the page's markup, and inline styles that code sets property
  // by property. Chrome has no setter to wrap for those, so a page that reads layout at
  // once can ask for the bare path first and log one failed load; the picture still shows.
  new MutationObserver(function (records) {
    records.forEach(function (record) {
      if (record.type === "attributes") return fix(record.target);
      record.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        fix(node);
        node.querySelectorAll("[src],[href],[poster],[srcset],[style]").forEach(fix);
      });
    });
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: Object.keys(ways) });
  var load = window.fetch;
  if (load) window.fetch = function (input, init) { return load.call(this, typeof input === "string" ? one(input) : input, init); };
})(${JSON.stringify(files).replace(/</g, "\\u003c")})</script>`;

/**
 * The canvas's reference images, each with its picture as a data URL, as the script that
 * leaves them on the page for images.ts. On the canvas page the dev server lists them;
 * a shared file has no server, so they go inside it here.
 */
function builtImages(): string {
  let source = "";
  try {
    source = readFileSync(resolve(canvasDir, "registry.tsx"), "utf8");
  } catch {
    return "";
  }
  const images = listImages(source).flatMap((image) => {
    const file = resolve(canvasDir, "images", image.file);
    const type = MEDIA[image.file.slice(image.file.lastIndexOf(".") + 1).toLowerCase()];
    return type && existsSync(file) ? [{ ...image, url: `data:${type};base64,${readFileSync(file).toString("base64")}` }] : [];
  });
  // "<" written as an escape, so nothing in a file name can end the script tag.
  return images.length ? `<script>window.__designCanvasImages=${JSON.stringify(images).replace(/</g, "\\u003c")}</script>` : "";
}

/** Moves everything the page uses into it, and marks it as a shared file, with when it was built (see bridge.ts). */
function oneFile(publicDir: string | undefined): Plugin {
  return {
    name: "design-canvas:one-file",
    enforce: "post",
    transformIndexHtml: (html) =>
      html
        .replace(/<html\b/i, `<html data-design-canvas="shared" data-design-canvas-built="${Date.now().toString(36)}"`)
        // Before the page's own script, which reads them as it starts.
        .replace(/<head[^>]*>/i, (head) => `${head}${builtImages()}`),
    generateBundle(_options, bundle) {
      const page = bundle["index.html"];
      if (page?.type !== "asset") return;
      const found = publicFiles(publicDir);
      // The page's own markup, before any code or stylesheet goes inside it.
      let html = found.inMarkup(String(page.source));
      // What went inside, by name: Vite 8's bundle can keep listing a deleted
      // file, which made the report name files that are in the page.
      const inside = new Set<string>();
      for (const [name, file] of Object.entries(bundle)) {
        const before = html;
        if (file.type === "chunk") {
          // An inline module script still runs after the page is parsed. "</script"
          // inside the code would end the tag early.
          const code = found.inCode(file.code).replace(/<\/script/gi, "<\\/script");
          const tag = new RegExp(`<script[^>]*src="[^"]*${escapeRegExp(name)}"[^>]*></script>`);
          html = html.replace(tag, () => `<script type="module">${code}</script>`);
        } else if (name.endsWith(".css")) {
          const tag = new RegExp(`<link[^>]*href="[^"]*${escapeRegExp(name)}"[^>]*>`);
          html = html.replace(tag, () => `<style>${found.inMarkup(String(file.source))}</style>`);
        }
        if (html !== before) {
          delete bundle[name];
          inside.add(name);
        }
      }
      // First in the head, so it watches before the page's own script adds anything.
      if (Object.keys(found.files).length)
        html = html.replace(/<head[^>]*>/i, (head) => `${head}${ROOT_FILES(found.files)}`);
      page.source = html;

      const missing = [...found.missing];
      const left = Object.keys(bundle).filter((name) => name !== "index.html" && !inside.has(name));
      this.emitFile({
        type: "asset",
        fileName: SHARE_REPORT,
        source: JSON.stringify({ missing: [...missing, ...left] }),
      });
      if (left.length)
        this.warn(`these built files cannot go inside the shared file, so it will miss them: ${left.join(", ")}`);
      if (missing.length)
        this.warn(
          `these files are not in the app's public folder, so they will not load in the shared file: ${missing.join(", ")}. Check each path, or import the file in its item.`,
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
