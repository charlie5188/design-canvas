# __CANVAS_TITLE__ · canvas

A local design canvas made with the `design-canvas` skill: the app's real
components with synthetic data and no backend.

From the app folder:

```sh
npx vite --config design-canvas/__CANVAS_NAME__/vite.config.mts
```

Open <http://127.0.0.1:__CANVAS_PORT__/>. The port belongs to this canvas; if Vite
reports it in use, this canvas is probably running already. One item alone: the icon beside its name, or `frame.html?item=<id>`.

- `registry.tsx`: every item on the canvas. The canvas reads nothing else.
- `items/`: the previews and their synthetic data.
- `providers.tsx`: the app stylesheet and the providers previews need.
- `canvas-theme.ts` and `theme.css`: the app's themes and the chrome's tokens.
- `mocks/`: stand-ins for Next.js modules, used only when the app uses Next.
- `canvas/`: the shared canvas shell. Change it in the skill, not here.

Using the canvas: drag empty space to pan. Drag an item's name or grip to move
it, and click the name to copy it. ⌘/Ctrl + scroll or a trackpad pinch zooms;
Space + drag pans anywhere. Hold ⌥/Alt and click any element in a preview to
copy a reference such as `Pricing card · compact › button “Upgrade”`. Links and
form submits never leave the canvas; a link to `#<item-id>` moves the camera
to that item.
