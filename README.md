# design-canvas

An agent skill that puts your React app's real components on a pannable, zoomable canvas, so you can explore and compare UI directions side by side by talking to your coding agent.

<!-- TODO: demo GIF -->

Instead of asking the agent to build a canvas from scratch for every project, the skill installs a ready-made, tested canvas shell and fits it to your app. The agent only writes the items you want to compare.

## What you get

- **Real components, no backend.** Items render your app's own components with synthetic data, styles, and themes.
- **Talk about what you see.** Click an item's name to copy it. Hold ⌥/Alt and click any element to copy a reference such as `Pricing card · compact › button “Upgrade”`, then paste it into the conversation.
- **Real viewports.** Mark an item `viewport: true` and it renders in a frame of its own width, so breakpoints and media queries behave as on a real phone or desktop.
- **Your themes.** Light and dark (or any themes the app has) switch from the toolbar, across every item.
- **Stays on the canvas.** Links, form submits, and router calls inside previews never navigate away; they show where they would have gone.
- **One item alone.** Open any item in its own tab at its real size, ready for a screenshot or a design-tool import.
- **A quiet workspace.** Drag items by their name, pan, zoom, fit all, and reload without losing the layout.

## Requirements

- macOS (the installer uses bash, rsync, and perl).
- A React app. Next.js and Vite apps are detected and fitted automatically, including Tailwind and shadcn/ui.
- Vite in the app, or permission for the agent to add it as a dev dependency. Next.js apps that build Tailwind with Turbopack also need `@tailwindcss/vite`.

## Install

```sh
npx skills add charlie5188/design-canvas
```

Then ask your agent, for example:

- "Make a canvas comparing three layouts for the pricing card."
- "Add a version of the inbox with grouped notifications next to the current one."
- "Show the settings page on a phone and on desktop."

## How it works

- `skills/design-canvas/shell/`: the canvas itself, in React. It is copied into each canvas and never rebuilt by the agent.
- `skills/design-canvas/kits/react-vite/`: a Vite page that sits beside your app, reuses its aliases, styles, environment, and Vite plugins, and swaps Next.js-only modules for stand-ins.
- `skills/design-canvas/scripts/install.sh`: copies the shell and kit into `<app>/design-canvas/<name>/` and detects what it can.
- `skills/design-canvas/references/making-a-kit.md`: the checklist the agent follows to finish fitting your app, and how to save that fit as a private kit in `~/.agents/design-canvas-kits/` so the next install needs none.

Canvases are prototypes. Commit one only when you want to share it.

## Limits

- The shell is React. For other frameworks, the agent ports it using `shell/TESTING.md` as the acceptance list.
- Server components, server actions, and anything that needs a server secret cannot render on the canvas; preview the client component beneath them instead.
- Inside `viewport` frames, middle-button pan and touch pinch do not reach the canvas.

## Credits

The canvas rules are adapted from [`create-canvas`](https://github.com/ibelick/ui-skills) by Julien Thibeaut (MIT).

## License

MIT. See [LICENSE](LICENSE).
