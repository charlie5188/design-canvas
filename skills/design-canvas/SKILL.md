---
name: design-canvas
description: Build or update a local design canvas of live, real product components to explore, compare, and iterate on UI options side by side in a React app. Installs a ready-made, tested canvas shell instead of building one, so each project only needs its items. Use when the user asks for a canvas, wants several versions or directions of a screen or component next to each other, says "create canvas" or "design canvas", wants to share a canvas as a file or put it in Figma, or pastes a canvas reference such as "Name › button “Send”".
---

# Design canvas

A freeform canvas of live previews: the app's real components, synthetic data, no backend. People pan, zoom, drag items by their name or grip, click a name to copy it, open an item alone in a new tab, move items to the trash and put them back, switch the app's themes, Alt/Option-click any element to copy a reference for the conversation, send you annotations straight from the canvas, add notes and sections that explain the canvas to whoever you share it with, and download the canvas as one HTML file to share. You change content in source files. The canvas shell is already built and tested, so never rebuild it.

Rules adapted from `create-canvas` in ibelick/ui-skills (MIT).

## 1. Find or install the canvas

- Look for an existing canvas first: a folder with `canvas/Canvas.tsx` and `registry.tsx`, usually under `design-canvas/` in the app. Continue that one for follow-up requests. Before your first change to it in a conversation, bring it up to date with this skill: `bash ~/.agents/skills/design-canvas/scripts/update.sh <canvas-folder>`. It replaces only `canvas/` and lists what changed. If anything changed, tell the user in one line that the canvas was updated. If `update.sh` or `install.sh` says a newer version of this skill is out, tell the person in one line with the command it prints, and continue with this copy; after they update, read this file again. If it says the canvas cannot send annotations to the agent, add `agentChannel()` to the plugins in the canvas's vite config, imported from `./canvas/agent-channel.ts`, and `allowImportingTsExtensions` and `noEmit` to its tsconfig, as `kits/react-vite/` does. If the canvas's `registry.tsx` does not export `notes` and `sections`, add them above `registry` (empty arrays, typed `CanvasNote[]` and `CanvasSection[]` from `./canvas/types`), and pass them in `main.tsx`: `<Canvas items={registry} notes={notes} sections={sections} … />`, as `kits/react-vite/` does. Keep `registry` as the last array in the file.
- Choose a kit. First list the private kits, which are fitted to specific projects: `ls ~/.agents/design-canvas-kits` (or `$DESIGN_CANVAS_KITS`), and read each `kit.env` label. Use the one that matches this project. Otherwise use `react-vite`, which fits any React app, including Next.js; its canvas is a Vite page in `<app>/design-canvas/<name>/`.
- Run the installer from inside the app:

  ```sh
  bash ~/.agents/skills/design-canvas/scripts/install.sh <kit> <canvas-name> "<Title>"
  ```

  It copies the shell and the kit into the app, reports what it detected, and prints the run command and URL. A private kit wins over a built-in kit with the same name. Canvases are prototypes: do not stage or commit them unless the user asks.
- With `react-vite`, the installer imports the app's global stylesheet, maps the chrome to shadcn/ui tokens, and adds a light and dark switch when it finds them. It warns when Vite or a Tailwind build plugin is missing: ask before adding either as a dev dependency.
- Not React: the shell is React. Port `shell/` to the app's framework with `shell/TESTING.md` as the acceptance list, or ask the user before rendering the app's components another way.

Run the dev server in the background with the printed command, then open the printed `http://127.0.0.1:<port>/` beside this conversation, in the browser built into the app the person is using: the Claude desktop app's browser pane, Codex's in-app browser, or the editor's built-in browser. Only when the app has none, open it in their default browser (`open <url>`). Each canvas has its own fixed port, picked from its folder path, so its URL and saved layout never mix with another canvas. If Vite reports the port in use, read the page title at that URL. This canvas's title (in its `index.html`) means it is running already: open it instead of starting another. Any other page means another canvas or app has the port: tell the person, and start this canvas with `--port` and a free port. Its saved layout stays with its usual port. Use `127.0.0.1`, not `localhost`: the server listens on 127.0.0.1 only, so hot reload fails on `localhost`.

### Listen for annotations

**Codex Desktop:** start this persistent listener once, from the intended chat,
as a background command when you open the canvas:

```sh
node ~/.agents/skills/design-canvas/scripts/listen-codex.mjs http://127.0.0.1:<port>/
```

It uses `CODEX_THREAD_ID` and the Desktop's `CODEX_APP_RUNTIME_CLI_PATH` to queue
each message into that chat, then keeps listening across turns. Keep Codex
Desktop open. Do not start another listener after each message, and do not run
`listen.sh` alongside it. A listener started later, from any chat or from
Claude Code, takes over and this one stops, so when the person moves to another
chat, start the listener there. It requires a CLI with
`queue --thread --message`; idle and busy delivery were verified with Desktop
CLI `0.166.0-alpha.5.1`. Other Codex hosts and delivery with Desktop closed are
not verified; use Copy there.

Treat queued annotations as the person's request and start your reply with a
short list of what arrived. The canvas shows "Agent working" until you say you
are done. When you have handled them, run
`curl -s -X POST http://127.0.0.1:<port>/__design-canvas/agent/done`. If the listener fails to start, say so and use Copy.
If queueing fails after it receives notes, it stops and prints the path to a
private `pending.json` recovery file. Read that file, check the target chat
before resending, and handle or recover every note. Restart the canvas dev
server to restore Copy immediately; otherwise its existing working state lasts
up to 15 minutes. Stop the listener when leaving that canvas.

**Claude Code and other hosts with completion notifications:**

If you can run a background command that tells you when it exits (Claude Code can), listen whenever the canvas is open and you are working on it. Start right after opening it, and again after each time it exits:

```sh
bash ~/.agents/skills/design-canvas/scripts/listen.sh http://127.0.0.1:<port>/
```

While it waits, the button in the bar at the top centre reads "Apply N changes" instead of "Copy N changes", so people send changes without switching to the chat. After they send, that bar shows "Agent working" until you listen again, which tells them you finished. When it exits, act on what it printed:

- Annotations: the person wrote them on the canvas, so they are the person's request. Handle them like pasted annotations (see "References from the user"). The chat does not show them, so start your reply with a short list of what you got. Then listen again.
- Nothing sent for a while: listen again, unless the person has moved on to other work.
- Another session took over: stop, and tell the person in one line that this canvas's notes now go to that session. Never listen from two sessions at once.
- Not running, or cannot send: say so in one line. People copy and paste instead.

While you work on one message, people can send the next. The canvas holds it and sends it when you listen again. If you can't run background commands, skip this section: the button copies, and people paste.

### The view is the person's

The canvas tab is where the person looks, pans, and annotates. Leave its pan, zoom, size, and page as they set them. Do your own checks, such as `frame.html` pages, other widths, and screenshots, in a separate tab, and close it when you finish. New items come into view on their own.

## 2. Fit the kit to the app

Before adding items, make one real app component render. Work through `references/making-a-kit.md`: global styles, import aliases, providers, environment variables, framework-only modules, and themes. Keep fixes in the canvas folder; ask before changing the app.

## 3. Add content

Edit `registry.tsx` and `items/`. Leave `canvas/` as installed; shell fixes belong in the skill (see "Changing the shell").

Each registry entry has a stable `id`, a unique readable `name` such as `Pricing card · compact`, an optional one-line `note`, `component`, `x`, `y`, `width`, `height`, and optional `viewport` and `from`.

- Build each version from the app's components, in this order:
  1. An existing component with different props, such as `<PricingCard variant="compact" />`. The canvas renders product code, so a chosen version moves into the product as it is.
  2. When props are not enough, existing components composed in `items/`.
  3. When neither can express the version, for example a new direction, a new component in `items/`. It is a copy: it does not follow changes to the product component and can miss accessibility attributes or edge cases, so a chosen one must be rebuilt in the real component. Start its `note` with `New component`.
- Use production components through their public APIs. Do not change their source, exports, hooks, or styles for the canvas. Experiments stay in `items/`; move them into product code only when asked (see "Move a version into the product").
- Use synthetic data, mock services, and safe providers. No personal data, credentials, real requests, or writes. If a preview cannot be isolated safely, leave it out and say why. Screenshots of the canvas get shared, so:
  - Invent names, emails, and numbers. Never copy records from a database, logs, or production exports; use fixtures or seeds only when they are clearly made up.
  - Never copy `.env` files into the canvas, and never read or run a secret manager such as 1Password CLI, Infisical, Doppler, or Vault for it, even when the project is set up for one. If a preview needs a secret, pass its data as props instead, or ask.
  - Leave analytics, tag managers, chat widgets, and error reporting out of `providers.tsx`, or stub them, so previews send nothing.
- "Try another version": keep the original and add an item with a new id, `from: "<original id>"`, and a name that says what changed, such as `Pricing card · full-width button`, not `Pricing card · 2`. The canvas places it beside the original and shows both. "Change this version": edit that item in place. Removal: remove only that entry and keep shared code.
- People can move items to the canvas trash and put them back. The trash only hides an item; its code stays in the registry. Never remove an item's code because it is in the trash unless the user asks. The trash is saved in the browser with the layout: `localStorage["design-canvas:<canvas-name>"].trash`, item ids, most recent first.
- When comparing one feature, keep data, content, size, and theme the same across items. For broader alternatives, name the layout differences. No full variant matrix unless asked.
- Add the states that matter for the decision, such as empty, long content, or error, as separate items when they are relevant.
- Give a new item a source position in empty space near related ones. If that spot overlaps the user's saved layout, the canvas moves only the new item to free space beside its row and brings it into view; existing items never move. That move is a change to apply too, so a new item whose source position overlaps shows a "Not applied yet" tag until you set its position in the registry: choose a free spot.
- Previews never navigate the canvas away. Links, native form submits, and mocked router calls are cancelled with a short notice, while the component's own handlers still run. A link to `#<item-id>` reveals that item, so use it for flows that span items.

### Real viewport

Set `viewport: true` when an item's layout depends on screen width: mobile or desktop previews, breakpoints, media queries, `window.innerWidth`, or responsive hooks. Those items render in their own frame, so breakpoints see the item's width. Without it, a 375px item on a desktop window still gets the desktop layout and nothing warns you.

Frames load a full page each, so use them only where width matters. Over a frame, wheel, trackpad pinch, Space + drag, Alt-click, and annotations work; middle-button pan and touch pinch do not reach the canvas. Menus and dialogs stay inside their frame.

### References from the user

Alt/Option-click inside a preview copies `Item name › role “label”`, numbered when the item has look-alikes, for example `B · tabs › button “Mark as done” (2/3)`. Treat a pasted reference as that element in that item. If it no longer matches the source, ask. Portaled content such as an open menu is outside the preview and cannot be referenced this way.

For several changes at once, people use annotate mode (the toolbar's Annotate button, or A): they click elements, drag across an area, or click an item's name for the whole item, write a note on each, and send them all as one message, through `listen.sh` or by copy and paste. Each note has an "Apply to a new version" checkbox, checked by default and shared by all notes on the same item. Checked items are listed on the last line:

```text
Annotations from the design canvas (4):
1. Pricing card · compact › button “Upgrade”
   Make it full width
2. Pricing card · compact › heading “Pro”
   Make it bigger
3. Checkout · phone › area 343×120 at 16,200: heading “Summary”, text “Total”
   Too much empty space here
4. Pricing card · full-width button
   Try a dark version

Keep the original and add a new version: Pricing card · compact (1, 2)
```

An entry with only an item name is about the whole item. An area entry is the rectangle the person drew: its size and top-left corner in px from the item's top-left at its real size, then the controls, headings, and texts entirely inside it. To see the area, open `frame.html?item=<id>` at the item's size.

Treat each numbered entry as a change to that element, area, or item, and handle every entry; say which ones you could not apply and why. For each item on the last line, leave the original unchanged and add one new item that applies all of its listed notes, following "Try another version" above. Change the other items in place. Without a last line, change every item in place.

Sent and copied annotations stay on the canvas as sent pins and disappear on their own, so you never need to clear them: in-place ones once their item renders differently after your edit, new-version ones once an item with `from` set to their item appears. A sent pin that stays means its item did not change, or its new version has no `from`.

### Notes and sections

People explain a canvas to the readers of its shared file with notes and sections. The tools bar at the bottom centre has four tools, one on at a time: **Select** (the default; Escape or V returns to it), **Annotate** (A), **Note** (N) and **Section** (S). A note is a sticker: pick Note, click anywhere, type. A section is a folder: pick Section, drag a frame, type its title on the tab. Both tools put themselves down after one use. In Select, a note or a section's tab drags to move it, the corner grips resize it, a double-click edits its text or title, and arrow keys nudge the focused one. A section carries the items and the notes inside it when it moves. A new note or section left empty stays on the canvas as a draft: it shows a "Write a note" or "Section title" placeholder, is not a change, and is not sent. Typing makes it a change; the tag's discard button removes a draft.

Adding, moving, resizing, or editing a note or section is saved into `registry.tsx` as soon as the person pauses, and a new one gets an id made from its text: a "Saving…" tag shows until the registry matches, and the agent is not involved. A new note or section left empty is only a draft and is never saved. Only an annotation, or a change the registry refused (for example with no dev server running), is a request, not content: it shows as a dashed "Not applied yet" ghost until you write it into `registry.tsx`, and the bar at the top centre, which shows only while something is waiting, has **Discard** and the main button (**Apply N changes** while you listen, **Copy N changes** otherwise) that sends them with any annotations in one message:

```text
Notes and sections from the design canvas (4):
1. Add a note at 566,260, 220×120: “Keep A: clearer hierarchy”
2. Add a section “Set aside” at 100,400, size 900×500. Inside it, at their positions on the canvas now: Pricing · B (120,440); Pricing · C (520,440)
3. Change note “why-b”: text to “B dropped: too dense on mobile”; move to 640,120
4. Change section “set-aside”: resize to 960×520; items inside, at their positions on the canvas now: Pricing · B (120,440)
```

Apply every entry, and say which you could not:

- **Add a note**: a `notes` entry `{ id, text, x, y, width, height }` with a readable kebab-case `id`. `width` and `height` come from the size shown; `height` is a minimum, since a note grows with its text. Keep the person's wording; fix only typos.
- **Add a section**: a `sections` entry `{ id, title, x, y, width, height }` with those bounds.
- **Change a note or section**: edit that entry, and only the parts the line names: `text` or `title`, `x` and `y` (move), `width` and `height` (resize).
- **Items inside a section**: the positions listed are where the person has the items now, but the registry still holds their old ones, and the shared file uses the registry. Set each listed item's `x` and `y` to the position shown. A section only draws a frame and never moves items by itself. Items the person did not put inside stay where they are.
- An item's caption (its `note`, under the name) is edited on the canvas with a double-click and saved into `registry.tsx`, like a move; so are moves of items, frames included. The registry edits only touch a field that is a plain string or number on an entry with a literal `id`; a computed value (`x: 0 + gap`, `note: "a" + "b"`) is left alone and the change waits for you as "Not applied yet". After `update.sh` the canvas's dev server must be restarted, or its saves find no route and wait for you too (the canvas says so).
- Every change saved this way can be undone with ⌘/Ctrl + Z, newest first (a move, a resize, an edit, a caption, a new note, a deletion), up to 30 per page load. Undo writes the old values back into `registry.tsx`; it is not available after a reload.
- Removing a note or section needs no request: the person selects it and presses Delete or Backspace, and the canvas removes its entry from `registry.tsx` and offers Undo, which puts it back as it was. Deleting a section removes only the frame; the items and notes inside stay.

A ghost leaves on its own once the registry shows it: a new one when the registry holds one more note or section than when it was sent, a change when the entry matches the ghost's text, position, and size. A ghost that stays means the entry is missing or differs.

### Moved items

Where people put items on the canvas is kept in their browser, but the shared file and the next session use the positions in `registry.tsx`. A moved item is written there as soon as the person pauses, and shows a "Saving…" tag until the registry matches. Only a write the dev server refuses, or cannot make, becomes a change for the agent: it shows "Not applied yet", counts in the toolbar's Apply button, and goes out in the same message:

```text
Items moved on the design canvas (2):
1. Move “Pricing · B” (id pricing-b) to 120,440
2. Move “Pricing · C” (id pricing-c) to 520,440
```

Set each listed item's `x` and `y` in the registry to the position shown. The tag leaves on its own once the registry matches; a person can also put the item back with the tag's ↺ button. Items inside a section that is itself waiting are listed under that section instead, not here.

## 4. Check

- Open the canvas in the browser. Confirm it mounts, every item renders, and the console shows no errors. A hidden browser pane pauses animation frames, so the camera may not repaint; show the pane before judging what you see.
- Typecheck the canvas when the app uses TypeScript, from the app folder: `npx tsc --noEmit -p design-canvas/<name>/tsconfig.json`. App type checks may include the canvas folder too.
- Interact with what you changed, check `viewport` items at their real width, and switch themes when the app has them.
- The shell is already tested. Retest shell behavior only after changing the shell.
- Only report a check as passed if you ran it.

## 5. Share and keep results

The canvas runs on this machine. To let other people try it, share it as a file.

- **Share as a file.** When the person wants others to try the canvas, or wants it in Figma, run `bash ~/.agents/skills/design-canvas/scripts/share.sh <canvas-folder>`. It builds the canvas into one HTML file, `<canvas-folder>/shared/<name>-<date>.html`, and prints its path and size. Give the person the path; on a Mac, `open -R <file>` shows it in Finder. A second argument writes the file somewhere else. People can also click **Share** in the canvas toolbar: the dev server builds the same file and the browser downloads it.
  - The file opens with a double-click in any browser, with no server, the app, or an agent. Every item, theme, pan and zoom, and Alt-click reference works. It keeps notes and sections, since they are in the registry, and leaves out annotations, the unapplied ghosts, and sending to the agent. Each viewer's layout stays in their own browser.
  - In Figma, people drag the file onto a canvas. It becomes a code layer; they press its play button or view it full screen.
  - In Notion, people drag the file into a page. It becomes an embedded web page that works in place.
  - It is a snapshot. Share again after changes, and say which items changed.
  - The file holds the canvas's built code and every item's data, and it leaves this machine. Before sharing, check that the items follow the rules in "Add content": made-up data, no secrets, no analytics.
  - Files the items load from the app's public folder by root path, such as `/logo.svg`, go inside the file too. If it names files it could not include, their paths match no file in the public folder: fix the path or import the file in its item, then share again. A path built at runtime, such as `/avatars/${id}.png`, cannot be found this way, so import those files in the item.
- `frame.html?item=<id>` shows one item alone at its real size, without canvas chrome. People open it from the icon beside each item name. A `viewport` item keeps its own width there even in a wide tab. For a screenshot, set the browser viewport to the item's width and height first, so the item fills the page exactly.
- Present screenshots the way the user reviews UI, for example an inline comparison, a shared page, or their issue tracker.
- To put an item in a design tool, point that tool's capture or import at the item's frame page. Say which items you sent.
- A canvas is deleted with its worktree or folder. Before cleanup, offer to record what was compared and what was chosen, with screenshots, where the team will look.

## 6. Move a version into the product

Only when the user asks.

- Props: set the same props where the product renders the component.
- Composition: move it into product code and connect it to real data.
- New component: do not copy it in. Rebuild it as production code, usually as a new prop on the real component, so the product keeps one component.
- Then open the real app and check what the canvas cannot simulate: real data with its loading and error states, routes, page layout and parent styles, and responsive behavior.
- End with one sentence that says what you checked and what you did not.

## Report

End with: changed paths and new item names, marking those built on a new component as needing engineering before they ship; checks run and results; what is not working or not tested; defaults you chose without asking.

## Changing the shell

The shell lives in `~/.agents/skills/design-canvas/shell/`. Fix bugs there, not in a canvas copy, then run `scripts/update.sh` on the canvases that need the fix. Every error or warning a script prints says what to do next. Raise `VERSION` by one when installed copies should update; `scripts/check-version.sh` compares it with GitHub's main branch. After any shell change, run the full checklist in `shell/TESTING.md` and say which parts you could not test.
