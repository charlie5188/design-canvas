---
name: design-canvas
description: Build or update a local design canvas of live, real product components to explore, compare, and iterate on UI options side by side in a React app. Installs a ready-made, tested canvas shell instead of building one, so each project only needs its items. Use when the user asks for a canvas, wants several versions or directions of a screen or component next to each other, says "create canvas" or "design canvas", or pastes a canvas reference such as "Name › button “Send”".
---

# Design canvas

A freeform canvas of live previews: the app's real components, synthetic data, no backend. People pan, zoom, drag items by their name or grip, click a name to copy it, open an item alone in a new tab, move items to the trash and put them back, switch the app's themes, and Alt/Option-click any element to copy a reference for the conversation. You change content in source files. The canvas shell is already built and tested, so never rebuild it.

Rules adapted from `create-canvas` in ibelick/ui-skills (MIT).

## 1. Find or install the canvas

- Look for an existing canvas first: a folder with `canvas/Canvas.tsx` and `registry.tsx`, usually under `design-canvas/` in the app. Continue that one for follow-up requests. Before your first change to it in a conversation, bring it up to date with this skill: `bash ~/.agents/skills/design-canvas/scripts/update.sh <canvas-folder>`. It replaces only `canvas/` and lists what changed. If anything changed, tell the user in one line that the canvas was updated.
- Choose a kit. First list the private kits, which are fitted to specific projects: `ls ~/.agents/design-canvas-kits` (or `$DESIGN_CANVAS_KITS`), and read each `kit.env` label. Use the one that matches this project. Otherwise use `react-vite`, which fits any React app, including Next.js; its canvas is a Vite page in `<app>/design-canvas/<name>/`.
- Run the installer from inside the app:

  ```sh
  bash ~/.agents/skills/design-canvas/scripts/install.sh <kit> <canvas-name> "<Title>"
  ```

  It copies the shell and the kit into the app, reports what it detected, and prints the run command and URL. A private kit wins over a built-in kit with the same name. Canvases are prototypes: do not stage or commit them unless the user asks.
- With `react-vite`, the installer imports the app's global stylesheet, maps the chrome to shadcn/ui tokens, and adds a light and dark switch when it finds them. It warns when Vite or a Tailwind build plugin is missing: ask before adding either as a dev dependency.
- Not React: the shell is React. Port `shell/` to the app's framework with `shell/TESTING.md` as the acceptance list, or ask the user before rendering the app's components another way.

Run the dev server in the background with the printed command, then open the printed `http://127.0.0.1:<port>/`. Each canvas has its own fixed port, picked from its folder path, so its URL and saved layout never mix with another canvas. If Vite reports the port in use, the canvas is probably running already; open it instead of starting another. Use `127.0.0.1`, not `localhost`: the server listens on 127.0.0.1 only, so hot reload fails on `localhost`.

## 2. Fit the kit to the app

Before adding items, make one real app component render. Work through `references/making-a-kit.md`: global styles, import aliases, providers, environment variables, framework-only modules, and themes. Keep fixes in the canvas folder; ask before changing the app.

## 3. Add content

Edit `registry.tsx` and `items/`. Leave `canvas/` as installed; shell fixes belong in the skill (see "Changing the shell").

Each registry entry has a stable `id`, a unique readable `name` such as `Pricing card · compact`, an optional one-line `note`, `component`, `x`, `y`, `width`, `height`, and optional `viewport` and `from`.

- Reuse production components through their public APIs. Do not change their source, exports, hooks, or styles for the canvas. Experiments stay in `items/`; move them into product code only when asked.
- Use synthetic data, mock services, and safe providers. No personal data, credentials, real requests, or writes. If a preview cannot be isolated safely, leave it out and say why.
- "Try another version": keep the original and add an item with a new id, `from: "<original id>"`, and a name that says what changed, such as `Pricing card · full-width button`, not `Pricing card · 2`. The canvas places it beside the original and shows both. "Change this version": edit that item in place. Removal: remove only that entry and keep shared code.
- People can move items to the canvas trash and put them back. The trash only hides an item; its code stays in the registry. Never remove an item's code because it is in the trash unless the user asks. The trash is saved in the browser with the layout: `localStorage["design-canvas:<canvas-name>"].trash`, item ids, most recent first.
- When comparing one feature, keep data, content, size, and theme the same across items. For broader alternatives, name the layout differences. No full variant matrix unless asked.
- Add the states that matter for the decision, such as empty, long content, or error, as separate items when they are relevant.
- Give a new item a source position in empty space near related ones. If that spot overlaps the user's saved layout, the canvas moves only the new item to free space beside its row and brings it into view; existing items never move.
- Previews never navigate the canvas away. Links, native form submits, and mocked router calls are cancelled with a short notice, while the component's own handlers still run. A link to `#<item-id>` reveals that item, so use it for flows that span items.

### Real viewport

Set `viewport: true` when an item's layout depends on screen width: mobile or desktop previews, breakpoints, media queries, `window.innerWidth`, or responsive hooks. Those items render in their own frame, so breakpoints see the item's width. Without it, a 375px item on a desktop window still gets the desktop layout and nothing warns you.

Frames load a full page each, so use them only where width matters. Over a frame, wheel, trackpad pinch, Space + drag, Alt-click, and annotations work; middle-button pan and touch pinch do not reach the canvas. Menus and dialogs stay inside their frame.

### References from the user

Alt/Option-click inside a preview copies `Item name › role “label”`, numbered when the item has look-alikes, for example `B · tabs › button “Mark as done” (2/3)`. Treat a pasted reference as that element in that item. If it no longer matches the source, ask. Portaled content such as an open menu is outside the preview and cannot be referenced this way.

For several changes at once, people use annotate mode (the toolbar's Annotate button, or A): they click elements, write a note on each, and copy them all as one message. Each note has an "Apply to a new version" checkbox, checked by default and shared by all notes on the same item. Checked items are listed on the last line:

```text
Annotations from the design canvas (3):
1. Pricing card · compact › button “Upgrade”
   Make it full width
2. Pricing card · compact › heading “Pro”
   Make it bigger
3. Checkout · phone › heading “Summary”
   Move it above Payment

Keep the original and add a new version: Pricing card · compact (1, 2)
```

Treat each numbered entry as a change to that element, and handle every entry; say which ones you could not apply and why. For each item on the last line, leave the original unchanged and add one new item that applies all of its listed notes, following "Try another version" above. Change the other items in place. Without a last line, change every item in place.

Copied annotations stay on the canvas as sent pins and disappear on their own, so you never need to clear them: in-place ones once their item renders differently after your edit, new-version ones once an item with `from` set to their item appears. A sent pin that stays means its item did not change, or its new version has no `from`.

## 4. Check

- Open the canvas in the browser. Confirm it mounts, every item renders, and the console shows no errors. A hidden browser pane pauses animation frames, so the camera may not repaint; show the pane before judging what you see.
- Typecheck the canvas when the app uses TypeScript, from the app folder: `npx tsc --noEmit -p design-canvas/<name>/tsconfig.json`. App type checks may include the canvas folder too.
- Interact with what you changed, check `viewport` items at their real width, and switch themes when the app has them.
- The shell is already tested. Retest shell behavior only after changing the shell.
- Only report a check as passed if you ran it.

## 5. Share and keep results

The canvas runs only on this machine.

- `frame.html?item=<id>` shows one item alone at its real size, without canvas chrome. People open it from the icon beside each item name. A `viewport` item keeps its own width there even in a wide tab. For a screenshot, set the browser viewport to the item's width and height first, so the item fills the page exactly.
- Present screenshots the way the user reviews UI, for example an inline comparison, a shared page, or their issue tracker.
- To put an item in a design tool, point that tool's capture or import at the item's frame page. Say which items you sent.
- A canvas is deleted with its worktree or folder. Before cleanup, offer to record what was compared and what was chosen, with screenshots, where the team will look.

## Report

End with: changed paths and new item names; checks run and results; what is not working or not tested; defaults you chose without asking.

## Changing the shell

The shell lives in `~/.agents/skills/design-canvas/shell/`. Fix bugs there, not in a canvas copy, then run `scripts/update.sh` on the canvases that need the fix. After any shell change, run the full checklist in `shell/TESTING.md` and say which parts you could not test.
