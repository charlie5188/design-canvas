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
