#!/usr/bin/env node
// What an app's own checks need so a canvas inside it does not break them. Prints one line per
// change for the user to approve, or nothing. Used by the installer (kits/react-vite/setup.sh)
// and update.sh. Usage: check-app.mjs <app-folder> <canvas-parent-folder-name>
//
// Next.js type-checks every file its tsconfig.json includes during `next build`, and most lint
// configs cover every file; the canvas's files follow the canvas's settings, not the app's, so
// the app's build and lint would fail on them. Changing the app's config is the user's call.
import fs from "node:fs";
import path from "node:path";

const [app, parent] = process.argv.slice(2);
// JSON with comments and trailing commas, as tsconfig.json allows.
const jsonc = (file) => {
  const text = fs.readFileSync(file, "utf8");
  let out = "";
  for (let i = 0, quoted = false; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      out += c;
      if (c === "\\") out += text[++i];
      else if (c === '"') quoted = false;
    } else if (c === '"') {
      quoted = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
};
const tsconfig = path.join(app, "tsconfig.json");
if (fs.existsSync(tsconfig)) {
  try {
    const config = jsonc(tsconfig);
    // No `files` list (a Vite template's tsconfig.json has `files: []`), and an `include` that
    // reaches the canvas folder: none at all, or a pattern from the root such as "**/*.ts".
    const reaches = !config.files && (!config.include || config.include.some((p) => /^(\.\/)?(\*\*?(\/|\.|$)|\*\.)/.test(p) || p.replace(/^\.\//, "").startsWith(parent)));
    const left = (config.exclude ?? []).some((p) => p.replace(/^\.\//, "").split("/")[0] === parent);
    if (reaches && !left) console.log(`The app's tsconfig.json type-checks ${parent}/, so the app's own build (next build) and tsc would fail on the canvas's files. Ask the user, then add "${parent}" to "exclude" in tsconfig.json.`);
  } catch {
    // Not readable as JSON: say nothing rather than guess.
  }
}
const flat = ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts", "eslint.config.mts"].find((f) => fs.existsSync(path.join(app, f)));
const legacy = [".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml"].find((f) => fs.existsSync(path.join(app, f)));
if (flat && !fs.readFileSync(path.join(app, flat), "utf8").includes(parent)) {
  console.log(`The app's lint (${flat}) covers ${parent}/. Ask the user, then add "${parent}/**" to its ignores, for example in globalIgnores([...]).`);
} else if (!flat && legacy) {
  const ignore = path.join(app, ".eslintignore");
  if (!fs.existsSync(ignore) || !fs.readFileSync(ignore, "utf8").includes(parent)) console.log(`The app's lint (${legacy}) covers ${parent}/. Ask the user, then add "${parent}/" to .eslintignore.`);
}
