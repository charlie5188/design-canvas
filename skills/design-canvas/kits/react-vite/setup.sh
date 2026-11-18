#!/usr/bin/env bash
# Fills in what the React kit can detect after install: the app's global
# stylesheet, shadcn/ui tokens for the canvas chrome, a dark theme, and Vite.
# Runs with APP_DIR and CANVAS_DIR set by install.sh.
set -euo pipefail
note() { echo "design-canvas: $*"; }
rel() { perl -MFile::Spec -e 'print File::Spec->abs2rel($ARGV[0], $ARGV[1])' "$1" "$2"; }

# The app's global stylesheet, imported once for every preview.
css=""
for candidate in app/globals.css src/app/globals.css src/index.css src/styles/globals.css styles/globals.css src/global.css src/styles.css; do
  if [[ -f "$APP_DIR/$candidate" ]]; then css="$candidate"; break; fi
done
if [[ -n "$css" ]]; then
  CSS_IMPORT="$(rel "$APP_DIR/$css" "$CANVAS_DIR")" perl -pi -e 's|^// \@global-css.*$|import "$ENV{CSS_IMPORT}";|' "$CANVAS_DIR/providers.tsx"
  note "imported the app stylesheet $css"
else
  note "no global stylesheet found; import the app's own in providers.tsx"
fi

# shadcn/ui tokens drive the canvas chrome, so it follows the app's themes.
if [[ -f "$APP_DIR/components.json" ]]; then
  tailwind="$(node -e 'const p = require(process.argv[1]); const v = (p.dependencies || {}).tailwindcss || (p.devDependencies || {}).tailwindcss || ""; console.log(v.replace(/[^0-9.]/g, "").split(".")[0])' "$APP_DIR/package.json")"
  # Tailwind 3 setups store bare HSL channels; Tailwind 4 stores whole colors.
  if [[ "$tailwind" == "3" ]]; then open="hsl(var("; close="))"; else open="var("; close=")"; fi
  cat >"$CANVAS_DIR/theme.css" <<EOF
/* Canvas chrome in the app's shadcn/ui tokens, so it follows the app's themes. */
.canvas-root,
.canvas-frame-page,
.canvas-frame-root,
.canvas-frame-missing {
  --canvas-bg: ${open}--muted${close};
  --canvas-surface: ${open}--background${close};
  --canvas-border: ${open}--border${close};
  --canvas-text: ${open}--foreground${close};
  --canvas-text-subtle: ${open}--muted-foreground${close};
  --canvas-focus: ${open}--ring${close};
  --canvas-hover: ${open}--accent${close};
  --canvas-radius: var(--radius, 8px);
}
EOF
  note "mapped the canvas chrome to shadcn/ui tokens"
fi

# next/font defines its CSS variables in the root layout, which the canvas does
# not render, so the app's font stacks would be empty. System fonts stand in.
layout=""
for candidate in app/layout.tsx src/app/layout.tsx app/layout.jsx src/app/layout.jsx; do
  if [[ -f "$APP_DIR/$candidate" ]]; then layout="$candidate"; break; fi
done
if [[ -n "$layout" ]]; then
  fonts="$(perl -ne 'print "$1\n" while /variable:\s*["\x27](--[\w-]+)["\x27]/g' "$APP_DIR/$layout" | sort -u)"
  if [[ -n "$fonts" ]]; then
    {
      printf '\n/* next/font variables from %s. The canvas does not render the root\n   layout, so system fonts stand in; load the real fonts here if type matters. */\n:root {\n' "$layout"
      while read -r var; do
        if [[ "$var" == *mono* ]]; then stack="ui-monospace, SFMono-Regular, Menlo, monospace"; else stack="ui-sans-serif, system-ui, sans-serif"; fi
        printf '  %s: %s;\n' "$var" "$stack"
      done <<<"$fonts"
      printf '}\n'
    } >>"$CANVAS_DIR/theme.css"
    note "gave the next/font variables system font fallbacks"
  fi
fi

# A dark theme the app already defines becomes a toolbar switch.
if [[ -n "$css" ]] && grep -Eq '(^|[ ,])\.dark[ ,{]|@custom-variant dark' "$APP_DIR/$css"; then
  cat >"$CANVAS_DIR/canvas-theme.ts" <<'EOF'
import { classTheme, createThemeStore } from "./canvas/theme";

// The app's light and dark themes, applied the way the app applies them: a
// `dark` class on <html>.
export const theme = createThemeStore({
  options: [
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
  ],
  apply: classTheme({ light: null, dark: "dark" }),
});
EOF
  note "found a .dark theme; added a light and dark switch"
fi

# Type checks extend the app config that holds its compiler options. Vite
# templates keep them in tsconfig.app.json behind project references.
if [[ -f "$APP_DIR/tsconfig.app.json" ]]; then
  perl -pi -e 's|/tsconfig\.json"|/tsconfig.app.json"|' "$CANVAS_DIR/tsconfig.json"
elif [[ ! -f "$APP_DIR/tsconfig.json" ]]; then
  rm -f "$CANVAS_DIR/tsconfig.json"
fi

if [[ ! -f "$APP_DIR/node_modules/vite/package.json" ]]; then
  note "Vite is not installed in this app. npx fetches it for each run; ask the user before adding it with: npm i -D vite"
fi

# Tailwind 4 compiled outside PostCSS and Vite (for example Next.js with
# Turbopack) needs @tailwindcss/vite on the canvas, or utilities never build.
tailwind_version="$(node -e 'const p = require(process.argv[1]); const v = (p.dependencies || {}).tailwindcss || (p.devDependencies || {}).tailwindcss || ""; console.log(v)' "$APP_DIR/package.json")"
if [[ "$tailwind_version" =~ ^[^0-9]*4 ]] &&
  ! ls "$APP_DIR"/postcss.config.* "$APP_DIR"/.postcssrc* >/dev/null 2>&1 &&
  ! grep -qs "@tailwindcss/vite" "$APP_DIR"/vite.config.*; then
  installed="$(node -p 'require(process.argv[1] + "/node_modules/tailwindcss/package.json").version' "$APP_DIR" 2>/dev/null || true)"
  if [[ ! -f "$APP_DIR/node_modules/@tailwindcss/vite/package.json" ]]; then
    note "Tailwind 4 builds outside PostCSS here. Ask the user before adding the canvas build plugin with: npm i -D @tailwindcss/vite@${installed:-4}"
  fi
fi

# The app's own checks must leave the canvas out. Next.js type-checks every file its
# tsconfig.json includes during `next build`, and most lint configs cover every file; the
# canvas's files follow the canvas's settings, not the app's, so the app's build and lint
# would fail on them. Changing the app's config is the user's call: say what to add.
parent="$(rel "$(dirname "$CANVAS_DIR")" "$APP_DIR")"
APP_DIR="$APP_DIR" PARENT="${parent%%/*}" node <<'NODE' | while IFS= read -r line; do if [[ -n "$line" ]]; then note "$line"; fi; done
const fs = require("fs");
const path = require("path");
const app = process.env.APP_DIR;
const parent = process.env.PARENT;
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
NODE

# React Router (6 or later): its <Link> and hooks need a router around each screen. The kit's
# stand-in drives one per item from the canvas (mocks/react-router.tsx); providers.tsx sets it.
router_pkg="$(node -e 'const p = require(process.argv[1]); const d = { ...p.devDependencies, ...p.dependencies }; for (const name of ["react-router", "react-router-dom"]) { const v = String(d[name] || "").replace(/[^0-9.]/g, ""); if (v && Number(v.split(".")[0]) >= 6) { console.log(name); break; } }' "$APP_DIR/package.json")"
if [[ -n "$router_pkg" ]]; then
  if [[ "$router_pkg" == "react-router-dom" && ! -f "$APP_DIR/node_modules/react-router/package.json" ]]; then
    perl -pi -e 's|from "react-router";|from "react-router-dom";|' "$CANVAS_DIR/mocks/react-router.tsx"
  fi
  if grep -q 'return <>{children}</>;' "$CANVAS_DIR/providers.tsx"; then
    perl -0pi -e 's|(import "\./theme\.css";\n)|$1import { ScreenRouter } from "./canvas/routes";\nimport { CanvasRouter } from "./mocks/react-router";\n|; s|return <>\{children\}</>;|// Each item gets its own router, driven by the canvas (mocks/react-router.tsx).\n  return <ScreenRouter.Provider value={CanvasRouter}>{children}</ScreenRouter.Provider>;|' "$CANVAS_DIR/providers.tsx"
    note "found $router_pkg; each item gets a router driven by the canvas (mocks/react-router.tsx)"
  else
    note "found $router_pkg; set ScreenRouter to CanvasRouter in providers.tsx (see mocks/react-router.tsx)"
  fi
else
  # No React Router: the stand-in would only fail the canvas's type check on its import.
  rm -f "$CANVAS_DIR/mocks/react-router.tsx"
fi
