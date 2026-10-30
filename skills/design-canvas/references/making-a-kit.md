# Fitting the canvas to an app

Goal: one real app component renders on the canvas exactly as it does in the app, before you add more items. Work through the list in order and stop at the first thing that is wrong. Keep every fix inside the canvas folder; ask before changing the app or adding a dependency.

## 1. Global styles

The installer imports the first global stylesheet it finds. Apps often have more: a reset, font faces, a theme file. Import each in `providers.tsx`, in the same order as the app's entry or root layout. CSS Modules and component-level imports work as they are.

## 2. Tailwind

- **PostCSS setup** (a `postcss.config.*` file): works as is; the canvas loads the app's PostCSS config.
- **`@tailwindcss/vite` in the app's Vite config**: reused from the app's config.
- **Next.js with `@tailwindcss/turbopack`** (no PostCSS config): the canvas needs `@tailwindcss/vite` at the same version as `tailwindcss`. The installer prints the command; ask the user before running it.
- **Tailwind 4** scans the whole app: the canvas adds an `@source` for the app folder to the app's Tailwind stylesheet at build time.
- **Tailwind 3** builds classes from the `content` globs in its config. Classes used only in canvas items are missing until the canvas folder is in `content`. That is an app change, so ask.

## 3. Import aliases

Aliases come from `paths` in `tsconfig.app.json`, `tsconfig.json`, or `jsconfig.json`. Add the rest to `resolve.alias` in `vite.config.mts`: paths that live only in an `extends` base, and bundler-only aliases from `next.config.*` or a webpack config.

## 4. Providers

Wrap previews in `providers.tsx` with what the components read, using safe, local values:

- Theme and design-system providers, with the app's default props.
- i18n: the app's real message files for one locale, or a small synthetic set.
- Data clients such as React Query: a fresh client with retries off, filled with `setQueryData` or `initialData`. No network.
- Router context, feature flags, and the current user: fixed synthetic values.

Never connect a preview to a real backend. If a component fetches on mount, render the presentational component below it with props, or mock the request in the item.

## 5. Environment variables

Public variables (`NEXT_PUBLIC_*`, `VITE_*`) from the app's `.env` files reach the canvas as `process.env` and `import.meta.env`. Nothing else does. A component that needs a server secret is not a preview candidate; pass its data as props instead.

## 6. Framework-only modules

For Next.js apps, `next/link`, `next/image`, `next/navigation`, and `next/font` are swapped for stand-ins in `mocks/` automatically. Router calls such as `router.push` stay on the canvas with a notice.

These cannot run on the canvas: server components, server actions, `next/headers`, `cookies()`, and route handlers. Render the client component beneath them and pass it props.

Other frameworks (React Router framework mode, Remix, Gatsby, Expo web): alias each framework-only module to a small mock in `mocks/` the same way. To make a mocked navigation stay on the canvas, dispatch `design-canvas:navigate` with the URL as `detail`, as `mocks/next-navigation.ts` does.

## 7. Themes

The installer adds a light and dark switch when the app's stylesheet defines `.dark`. Otherwise edit `canvas-theme.ts`:

- A class on `<html>`: `classTheme({ light: null, dark: "dark" })`.
- An attribute on `<html>`: `attributeTheme("data-theme")`.
- A provider prop: read the id with `useThemeId(theme)` inside `Providers` and pass it to the provider.

Map the `--canvas-*` tokens in `theme.css` to the app's tokens so the canvas chrome follows each theme. If the app has a single theme, leave `theme` undefined; the toolbar then shows no switch.

## 8. Fonts

The canvas does not render the app's root layout, so fonts loaded there are missing. For `next/font`, the installer gives each font variable a system fallback. When typography matters, load the real fonts in `theme.css` from the app's font files or the same web font source.

## 9. Assets

Files in the app's `public/` folder are served from `/`, as in the app. Imported images, SVGs, and fonts work through Vite.

## 10. Check

- Typecheck: `npx tsc --noEmit -p design-canvas/<name>/tsconfig.json`.
- The console shows no errors, and one item matches the app side by side.

## Save the fit as a private kit

When a project will get many canvases, for example one per worktree, save the fitted setup so the next install needs no fitting:

1. Copy the fitted canvas folder, without `canvas/`, `registry.tsx` content, and `items/`, to `~/.agents/design-canvas-kits/<kit>/`.
2. Put `__CANVAS_NAME__`, `__CANVAS_TITLE__`, and `__APP_DIR__` back where the installer replaces them.
3. Add a `kit.env`:
   - `KIT_LABEL`: a short name for the project.
   - `KIT_APP_DIR`: the app folder from the repository root, for monorepos. Leave it out to use the nearest `package.json`.
   - `KIT_PARENT`: where canvases go, relative to the app folder.
   - `KIT_RUN`: the run command from the app folder.
   - `KIT_CHECK` and `KIT_CHECK_HINT`: a file that exists only after dependencies are installed, and what to do when it is missing.
   - `KIT_PREFLIGHT` and `KIT_PREFLIGHT_FIX` (optional): a quick command that fails when dependencies are stale, and its fix.
4. Install it into a fresh checkout and confirm it mounts and typechecks.
