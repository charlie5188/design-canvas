---
name: design-canvas
description: Build or update a local design canvas of live, real product components to explore, compare, and iterate on UI options side by side in a React app. Installs a ready-made, tested canvas shell instead of building one, so each project only needs its items. Use when the user asks for a canvas, wants several versions or directions of a screen or component next to each other, says "create canvas" or "design canvas", wants to share a canvas as a file, get comments on it through a link, or put it in Figma, or pastes a canvas reference such as "Name › button “Send”".
---

# Design canvas

A freeform canvas of live previews: the app's real components, synthetic data, no backend. People pan, zoom, drag items by their name or grip, drag an item's border to resize it like an OS window (the new width and height are saved into `registry.tsx`), restart an item they have used, ask for an item to start at the moment they brought it to, see every screen of a flow side by side, open an item alone in a new tab, move items to the trash and put them back, pick the version they choose (which sets the versions beside it aside), switch the app's themes, Alt/Option-click any element to copy a reference for the conversation, send you requests and questions straight from the canvas and read your answers beside their pins, add notes and sections that explain the canvas to whoever you share it with, select several things with a box or Shift + click and move or delete them together, paste or drop reference images onto the canvas, and download the canvas as one HTML file to share. You change content in source files. The canvas shell is already built and tested, so never rebuild it.

Rules adapted from `create-canvas` in ibelick/ui-skills (MIT).

## 1. Find or install the canvas

- Look for an existing canvas first: a folder with `canvas/Canvas.tsx` and `registry.tsx`, usually under `design-canvas/` in the app. Continue that one for follow-up requests. Before your first change to it in a conversation, bring it up to date with this skill: `bash ~/.agents/skills/design-canvas/scripts/update.sh <canvas-folder>`. It replaces only `canvas/` and lists what changed. If anything changed, tell the user in one line that the canvas was updated. It also says what a canvas installed earlier still needs from the kit's newer setup, since kit files belong to the canvas and are never replaced: old copies in `mocks/` the shell now covers, a line in `providers.tsx` for React Router, the canvas's own `exclude` in its `tsconfig.json`, or the app's own type check and lint leaving the canvas out. Do each; ask the user first where it changes the app. If `update.sh` or `install.sh` says a newer version of this skill is out, tell the person in one line with the command it prints, and continue with this copy; after they update, read this file again. If it says the canvas cannot send annotations to the agent, add `agentChannel()` to the plugins in the canvas's vite config, imported from `./canvas/agent-channel.ts`, and `allowImportingTsExtensions` and `noEmit` to its tsconfig, as `kits/react-vite/` does. If the canvas's `registry.tsx` does not export `notes` and `sections`, add them above `registry` (empty arrays, typed `CanvasNote[]` and `CanvasSection[]` from `./canvas/types`), and pass them in `main.tsx`: `<Canvas items={registry} notes={notes} sections={sections} … />`, as `kits/react-vite/` does. Keep `registry` as the last array in the file.
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
short list of what arrived. The canvas tags what they are about "Agent working" until you say you
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

While it waits, the button in the bar at the top centre reads "Send N to agent" instead of "Copy N for agent", so people send without switching to the chat. After they send, each item, section, and change in the message shows an "Agent working" tag until you listen again, which tells them you finished. When it exits, act on what it printed:

- Annotations: the person wrote them on the canvas, so they are the person's request. Handle them like pasted annotations (see "References from the user"). The chat does not show them, so start your reply with a short list of what you got. Then listen again.
- Nothing sent for a while: listen again, unless the person has moved on to other work.
- Another session took over: stop, and tell the person in one line that this canvas's notes now go to that session. Never listen from two sessions at once.
- Not running, or cannot send: say so in one line. People copy and paste instead.

While you work on one message, people can send the next. The canvas holds it and sends it when you listen again. If you can't run background commands, skip this section: the button copies, and people paste.

### The view is the person's

The canvas tab is where the person looks, pans, and annotates. Leave its pan, zoom, size, and page as they set them. Do your own checks, such as `frame.html` pages, other widths, and screenshots, in a separate tab, and close it when you finish. New items never move the person's view: each shows a green "New" tag until it has been on screen for a moment, and an item changed after a note shows "Updated" the same way.

## 2. Fit the kit to the app

Before adding items, make one real app component render. Work through `references/making-a-kit.md`: global styles, import aliases, providers, environment variables, framework-only modules, themes, and, when the app uses a design system (a package such as MUI or Chakra UI, or components copied into the app such as shadcn/ui), `design-system.ts` for the Inspect tool. Keep fixes in the canvas folder; ask before changing the app. When the installer says the app's own type check or lint covers the canvas folder (a Next.js app's `tsconfig.json` includes every file), ask the user to leave it out as the installer says: otherwise the app's own build and lint fail on the canvas's files.

## 3. Add content

Edit `registry.tsx` and `items/`. Leave `canvas/` as installed; shell fixes belong in the skill (see "Changing the shell").

Each registry entry has a stable `id`, a unique readable `name` such as `Pricing card · compact`, an optional one-line `note`, `component`, `x`, `y`, `width`, `height`, and optional `viewport`, `from`, `path`, `screens`, `states`, `steps`, and `start`. The canvas itself writes two more, `trashed` and `picked`, when the person trashes or picks an item.

Write each entry out by hand, in `registry`, `notes`, and `sections` alike. Its `id`, `x`, `y`, `width`, and `height` must be plain literals (`id: "pricing-compact"`, `x: 440`), not built by a loop, `map`, template string, variable, or arithmetic. A spread of shared values, such as `...SIZE`, is fine: a saved size or position is written after it, so it takes effect. The canvas saves moves and resizes by finding the entry's literal `id` in `registry.tsx` and replacing those numbers in place; anything computed cannot be found, so the change is not saved and waits for the agent ("no plain id, or a computed value"). When several items are alike, write each one out instead of generating them.

- Build each version from the app's components, in this order:
  1. An existing component with different props, such as `<PricingCard variant="compact" />`. The canvas renders product code, so a chosen version moves into the product as it is.
  2. When props are not enough, existing components composed in `items/`.
  3. When neither can express the version, for example a new direction, a new component in `items/`. It is a copy: it does not follow changes to the product component and can miss accessibility attributes or edge cases, so a chosen one must be rebuilt in the real component. Say so in your reply (see "Report"), not in its `note`: most new directions are new components, so on the canvas the label repeats on nearly every item and tells the person nothing.
- Use production components through their public APIs. Do not change their source, exports, hooks, or styles for the canvas. Experiments stay in `items/`; move them into product code only when asked (see "Move a version into the product").
- Use synthetic data, mock services, and safe providers. No personal data, credentials, real requests, or writes. If a preview cannot be isolated safely, leave it out and say why. Screenshots of the canvas get shared, so:
  - Invent names, emails, and numbers. Never copy records from a database, logs, or production exports; use fixtures or seeds only when they are clearly made up.
  - Never copy `.env` files into the canvas, and never read or run a secret manager such as 1Password CLI, Infisical, Doppler, or Vault for it, even when the project is set up for one. If a preview needs a secret, pass its data as props instead, or ask.
  - Leave analytics, tag managers, chat widgets, and error reporting out of `providers.tsx`, or stub them, so previews send nothing.
- "Try another version": keep the original and add an item with a new id, `from: "<original id>"`, and a name that says what changed, such as `Pricing card · full-width button`, not `Pricing card · 2`. The canvas places it beside the original and shows both. "Change this version": edit that item in place. Removal: remove only that entry and keep shared code.
- People can move items to the canvas trash and put them back. The trash only hides an item; its code stays in the registry. The canvas writes `trashed: true` on a trashed item's registry entry and removes it when the item is put back, so the shared file and the next session start with the same trash. Never remove an item's code because it is trashed unless the user asks. To trash an item or put one back when asked, add or remove its `trashed`; an open canvas follows.
- When the person asks for a new round of directions for a whole screen or flow, use the `design-directions` skill when it is installed. A round takes several minutes, research included, so do not use it for another version of an item, a change to one, or alternatives for a single component. When a request could mean either, make one improved version and offer a round in one line. Whenever you add alternatives, with or without that skill, at least: make directions differ in structure (hierarchy, layout, interaction, density), not only in color or theme; keep one close to the current product; and if two look like siblings, rework the weaker one. Put each version's bet and what it gives up in its `note`, in the person's language, as everything you write on the canvas.
- Say in an item's `note` where to start trying it, when what makes it different shows only after the person does something: opens a menu, presses a button, types, or goes on to a later screen. With many items on a canvas, people forget which control each version is about, and a version that looks the same as its neighbors at first is judged on what it shows at first. End the note with the word for "Try" in the person's language, the one control to use, named by the words on it, and what to look at: `Try: press “Upgrade”, then look at the plan summary`. Keep it to that one clause: a note is read at a glance, and a long one pushes the name far above the preview. Leave it out when the difference shows without touching the item, also when `start` opens the item there (see "Start here"). Change it when you change what it names, and do not rewrite the rest of the note to add it.
- When comparing one feature, keep data, content, size, and theme the same across items. For broader alternatives, name the layout differences. No full variant matrix unless asked.
- Build only what the request needs. A new version or direction starts as the one screen that shows its idea, with no other screens, states, phone width, or languages: people judge the idea first, and most versions are dropped before those details matter. Add them when the person asks: the item's Ask has a quick request for each (Flow, Phone, States, Languages). "Flow" asks for the item's other screens: add them to its `screens` as "Flows and paths" says, and when the screen leads to no other screen, say so on the note and add none. A version made from an existing item keeps that item's screens and states, and changes only what the request is about.
- When the person asks for states, such as empty, long content, an error, or loading, add them to the screen they belong to, in the item's `states`, not as items of their own: they are part of that solution, not other solutions. The canvas shows each item in its first state; the item's screen and state count by its name opens the flow view, where each screen's states switch in place.
  ```tsx
  { id: "checkout-a", name: "Checkout · one page", component: Checkout, path: "/checkout",
    states: { "/checkout": { Empty: CheckoutEmpty, "Card error": CheckoutError } }, x: 0, y: 0, width: 420, height: 560 },
  ```
  The key is the screen's path; for an item that names no path, `""`. Name each state in a word or two, in the person's language. Make a state an item of its own only when the person asks to see it beside other items.
- Other languages only when asked, for example with the "Languages" quick request. Then add one item per language the app ships, with `from` set to the original and the language in the name (`Pricing card · 日本語`), so text length and line breaks can be compared side by side. Use the app's own message files for that language; never translate or machine-translate text yourself. Dates, numbers, and prices that the item passes in follow the language too, formatted as the app formats them there. Set `lang` on the item's outer element. If the app has one language, or a string has no translation, say so in your reply instead of making one up.
- Give a new item a source position in empty space near related ones. If that spot overlaps the user's saved layout, the canvas moves only the new item to free space beside its row; existing items never move. That move is a change to apply too, so a new item whose source position overlaps shows a "Not applied yet" tag until you set its position in the registry: choose a free spot.
- Previews never navigate the canvas away. A link or a mocked router call to one of the item's own screens shows that screen in place (see "Flows and paths"); any other, and a native form submit, is cancelled with a short notice, while the component's own handlers still run. A link to `#<item-id>` reveals that item.

### Match the current product first

Versions start from the item that shows the product as it is today. If that item looks different from the real app, every version has the same differences, and people judge the versions against a wrong base. So before you add versions, check each item that shows the current product:

- Render the screen's own component, with synthetic data through its props or the canvas providers. Compose it from smaller components only when it cannot render alone, and then say so in its `note`.
- Open that screen in the running app, and the item alone at `frame.html?item=<id>`, at the same width and theme. Compare screenshots of the two side by side: type, color, spacing, sizes, borders, icons, and layout. Differences that come only from the synthetic data do not count.
- If the screen does not open without a sign-in, a backend, or secrets, do not work around that. Ask the person for a screenshot of the screen as it ships, and compare with it.
- Fix each difference where it comes from: the kit (styles, fonts, providers, themes; see `references/making-a-kit.md`), `viewport`, or the item's props and data. Do not add styles to the item to copy the screenshot: that hides the cause, and the next item has the same difference.
- Write each difference you cannot fix in the item's `note`, starting with `Differs from the app:`, for example `Differs from the app: system font, not Inter`. The note shows under the item's name, so nobody takes the difference for a design choice.
- Check again after you change the kit, and when the person says an item looks different from the app.

### Flows and paths

A product's screens point at each other by path: `<Link href="/checkout">`, `router.push("/done")`. Keep those links as they are in the real code. Do not rewrite them into state, and do not change them to `#<item-id>`. Tell the canvas which paths an item shows instead:

```tsx
// One frame holds the whole flow: a link inside it to one of its screens shows that screen in place.
{ id: "upgrade-a", name: "Upgrade · stacked", component: Plans, path: "/plans",
  screens: { "/checkout": Checkout, "/orders/[id]": Order, "/done": Done }, x: 0, y: 0, width: 420, height: 560 },

// A screen of its own. Only a link that opens a new tab in the product (target="_blank") brings the view here.
{ id: "help", name: "Help", component: Help, path: "/help", x: 520, y: 0, width: 420, height: 560 },
```

- An item stands for a browser tab. `path` is the path of the item's own `component`. `screens` adds more screens to the same item, by path. `[id]` or `:id` stands for any one segment.
- When a screen leads to another by code, not by a link (a router call in a click or submit handler), name that step in the item's `steps`: by the screen's path, then the words on the control, to the path it goes to, `steps: { "/upload": { "Start review": "/contracts/1" } }`. The flow view reads links from the screens by itself, but cannot see where a handler goes until someone presses it: without the step, the flow is drawn without that arrow, and a screen it leads to can look like a branch until the person has tried it.
- A link or a router call stays in the item it is in, as a click in the product stays in its tab: a path that is one of the item's screens shows in place, and any other path shows a notice that the item has no screen for it. It never moves the view to another item.
- Add to `screens` only the screens that the interaction being tried passes through: its main path, and a branch (an error, a declined card) only when the request is about it. Leave every other link as it is in the code, without a screen: the page's navigation, header, footer, and links to settings, help, or other features. A click on one shows the notice, which tells the person it is outside this prototype. This holds for "the whole flow" too: the flow is the job from where it starts to where it ends, not every page a link can reach. When the request is about part of one screen, such as a dialog, a filter, or a form, the item usually needs no other screen. Each extra screen costs build time and adds a step to the flow view that nobody asked to judge. Add a screen when the person asks for it.
- Only a link that opens a new tab in the product (`target="_blank"`) leaves the item: the view jumps to the nearest other item that shows that path and centres it, and the first item stays as it is. Place such an item beside the flow it belongs to.
- One item is one solution: when a solution has a flow, keep all its screens in one item, and put the versions side by side, so the person tries each as a user would. An item with more than one screen shows how many beside its name, and a press there opens every screen side by side, with arrows for the links between them. List `screens` in the order a person goes through them, main path first, then each branch (an error, a declined card) after it: the main path is laid out in that order, and a screen that its previous one does not lead to goes in a row under the screen that does. From there the person can ask about one screen, which reaches you as `Name › screen /checkout`, about an element on it, as `Name › screen /checkout › button “Pay”`, or about the whole flow, as `Name › the whole flow (/plans → /checkout → /done)`: change that screen's component, or the flow's screens and their order. Add a screen as an item of its own only when the person asks to compare or comment on one step beside other items.
- The person returns a flow to its start with Restart, beside the item's name. Nothing about the screen shown is saved: a reload starts every item at its start, its first screen or its `start` (see "Start here").
- A router's `back()` returns to the screen before. `usePathname()` gives the path of the screen shown, `useSearchParams()` its query, and `useParams()` the values its `[param]` parts matched (`{ id: "msa-acme" }` on `/contracts/[id]`). So a filter kept in the URL (`router.push("/contracts?status=signed")`) works: the path decides the screen, and the item keeps the query, also through Back. `next/navigation` and React Router (6 or later) have stand-ins in the built-in kit, so a page component that uses `<Link>`, `NavLink`, `useNavigate`, `useParams`, or `useSearchParams` works as an item as it is. For another router (TanStack Router, for one), make its stand-in dispatch `NAVIGATE_EVENT` and `BACK_EVENT` from `canvas/bridge` and read `RouteContext` and `LocationContext` from `canvas/routes`, as `canvas/stand-ins/next-navigation.ts` does; set it per screen through `ScreenRouter` when its components need a router around them, as `canvas/stand-ins/react-router.tsx` does.
- Not handled: hashes, `window.open`, and a path only the server knows, such as a redirect.

### Start here

Every item opens at its first screen, so versions can be compared from the same point. When they differ only in a later step, such as one screen of a flow, an open dialog, or a filled form, that point hides the difference, and the person clicks back to it after each Restart or reload. So once an item has left its start, its More menu has **Start here**. It opens a note on the whole item, which the person can change before sending:

```text
1. Upgrade · stacked
   Start here: make this item, and the versions it is compared with, start where it is now.
   Screen: /checkout?plan=pro
   After:
   1. Pressed “Upgrade”
   2. Typed “Acme” in “Company”
   3. Pressed “Continue”
```

`Screen` is the screen the item showed, and `After` lists what the person did since the item's start: presses and keys that changed something, and the last value typed or chosen in each field. Make the item open exactly there, in code, so Restart, a reload, the item's own page, and the shared file all open there:

- A later screen: set `start` on the item to that screen's path, with its query if it has one: `start: "/checkout?plan=pro"`. Keep `component`, `path`, and `screens` as they are: the flow view still lays out every screen from the first, and a link back to an earlier screen still works.
- Something open or filled in on that screen: give it to the screen as data, through props the component already has (`defaultOpen`, `defaultValue`, a selected tab) or the item's synthetic data and providers. Wrap the screen in `items/` to pass them, and use the wrapper as that screen: `component`, or its entry in `screens`.
- Only when no prop or data can do it: a few of the listed steps run once when the screen mounts, in that wrapper. Say so in the item's `note` (`Starts by pressing “Upgrade”`), because a change to the component can break them.
- Do not add a prop to a product component only for a start without saying so. When it needs one, reply which component and prop, and leave that item as it was until the person agrees.
- The versions it is compared with: the items linked to it by `from` (the item it was made from, the items made from it, and the other items made from the same one), and the items in the same section. Start each of them at the same point, with its own components: its steps can have other words. A version that has no such point, such as one that never opens that dialog, stays as it is.
- Reply on the note with the items that now start there and any that do not, and why, in one or two sentences, also when everything went as asked. The item can look as it did when the person sent the note, so the pin does not clear by itself.
- To take a start back, when the person asks, remove `start` and the wrapper.

### Planned directions

Show new directions on the canvas as a plan before you build them: one card each, with a rough sketch of its screen. Cards are fast, so a round can show five to seven directions at once, and the person builds only the ones worth a closer look. Skip the cards for variations of one direction, for small requests, and when the person said to just build. Do not list a plan in the chat and wait there: a chat list scrolls away, and the person should judge each direction where its result will appear.

- Add one item for each direction, named after its bet. Its component is a ready-made card: `component: planned({ bet: "…", givesUp: "…", reference: "…", sketch: … })`, with `planned` and `Block` imported from `./canvas/Planned`. `bet` is what the direction bets on, `givesUp` is what it gives up or how it could fail, and `reference` names the product or pattern it borrows from, or differs from on purpose. Write one sentence for each. Leave `viewport` off until the item is built.
- Always give the card a `sketch`: a grey wireframe of the one screen that shows the bet, made of `Block`s. The sketch is what lets the person see how the directions differ before they read anything, so draw shapes they recognize, not boxes they must read.
  - Boxes lay out the screen. `<Block row>` puts the blocks inside it in a row; otherwise they stack. `size` sets a block's share of its parent (`"40%"`, or a number of px). A box with a `label` is a named region and draws its outline; one without only arranges what is inside it.
  - Inside the boxes, draw the parts with `kind`: `heading`, `text` (with `lines`), `button` (`primary` for the main action), `field`, `choice` (`checked` for the selected one), `toggle` (`options`, `selected`), `list` (`options`, or `rows`), `table` (`options` for the columns, `rows`), and `media` for a picture or chart.
  - Put the screen's own short words in `label` and `options`, such as `Pay $60` or `Team · 8 members`, never between the tags.
  - Mark the part that carries the bet, what differs from the product today, with `emphasis` on its box. It gets a "Key change" tag.

  ```tsx
  sketch: (
    <Block>
      <Block kind="heading" label="Upgrade" />
      <Block row>
        <Block size="45%">
          <Block kind="toggle" options={["Monthly", "Yearly"]} />
          <Block kind="choice" label="Team" checked />
          <Block kind="choice" label="Business" />
        </Block>
        <Block label="Payment" emphasis>
          <Block kind="field" label="Card number" />
          <Block kind="button" primary label="Pay $60" />
        </Block>
      </Block>
    </Block>
  ),
  ```

  Use about fifteen blocks at most. Show structure only: no real components, colors, or icons, and only a few words of data. If two sketches look alike, the directions are not different enough: rework one.
- Give each card the position and size its built version will have. The built version takes the card's place and the items beside it do not move, so a card that is too small gets a built version that covers its neighbor.
- Each card has two buttons. **Drop** moves the card to the trash. **Build this** sends you a note on that card, `Build this planned direction`, with no new-version line. The button sends only while you listen (see "Listen for annotations"); otherwise it copies the note for the person to paste. Tell the person in one or two lines that the directions are on the canvas as cards, that they build or drop each one from the card, and that they can annotate a card or rewrite its text to change it first. Give your source links in the chat: a link inside a preview does not open.
- Build in place. For a `Build this planned direction` note, build that card as a one-screen draft. When the person tells you to go ahead, build every card that is not in the trash. Keep the card's `id`, `x`, `y`, `width`, `height`, and `name`, replace `component` with the real one, set `viewport` if the layout needs it, and put the bet and what it gives up in its `note`. Apply the person's annotations and rewritten text first. If the built version needs another size, change it and tell the person which items it now overlaps: they move those. Leave a trashed card as it is: the person can put it back and build it from its button.

### Real viewport

Set `viewport: true` when an item's layout depends on screen width: mobile or desktop previews, breakpoints, media queries, `window.innerWidth`, or responsive hooks. Those items render in their own frame, so breakpoints see the item's width. Without it, a 375px item on a desktop window still gets the desktop layout and nothing warns you.

Frames load a full page each, so use them only where width matters. Over a frame, wheel, trackpad pinch, Space + drag, Alt-click, and annotations work; middle-button pan and touch pinch do not reach the canvas. Menus and dialogs stay inside their frame.

### References from the user

Alt/Option-click inside a preview copies `Item name › role “label”`, numbered when the item has look-alikes, for example `B · tabs › button “Mark as done” (2/3)`. Treat a pasted reference as that element in that item. If it no longer matches the source, ask. An open menu or dialog that a `viewport` item portals is part of that item and can be referenced; in a plain item it is outside the preview and cannot.

To talk to you about what they see, people use the Ask agent tool (the toolbar's Ask agent button, or A): they click elements, drag across an area, click an item's name for the whole item, or click a section's title for everything in it, write a note on each (a change they want, or a question), and send them all as one message, through `listen.sh` (a note's own Send button, or the bar at the top) or by copy and paste (the bar at the top; a note's Done button only keeps it, and ⌘/Ctrl + Enter in a note copies all). A double-click on a text lets them rewrite it in place; the new words stay on show with a dashed underline (the item's code still renders the old ones, and your change replaces the preview), and the edit becomes a note such as `Change the text from “Save” to “Save changes”` on that element. Change that copy where the item gets it: the item's props or data, or, for words written in a product component, the component itself only when the person asks for an in-place change; otherwise follow the new-version line as usual. Each note has an "Apply to a new version" checkbox, checked by default and shared by all notes on the same item. Checked items are listed on the last line:

```text
Annotations from the design canvas (4):
1. Pricing card · compact › button “Upgrade”
   Make it full width
   (note cm3x9k0a)
2. Pricing card · compact › heading “Pro”
   Make it bigger
   (note cm3x9k0b)
3. Checkout · phone › area 343×120 at 16,200: heading “Summary”, text “Total”
   Why is there so much empty space here?
   (note cm3x9k0c)
4. Pricing card · full-width button
   Try a dark version
   (note cm3x9k0d)

Keep the original and add a new version: Pricing card · compact (1, 2)
```

The last line of each entry is its note id. You use it to answer on that note's pin (see "Answer on the pin").

An entry with only an item name is about the whole item. A section entry, `Section “Title”, with these items in reading order: … ; notes in it: …`, is about those items as a set: usually something new made from screens the person picked and arranged, such as one flow or a new proposal. Use the items in the order listed, and read the notes as the person's comments on them. Add the result as new items (with `from` naming the item each one builds on) and leave the listed items as they are, unless the note asks to change them. An area entry is the rectangle the person drew: its size and top-left corner in px from the item's top-left at its real size, then the controls, headings, and texts entirely inside it. To see the area, open `frame.html?item=<id>` at the item's size.

Handle every entry. An entry that asks for a change is a change to that element, area, or item; an entry that asks a question gets an answer and no change (see "Answer on the pin"). For a change you could not apply, say so on its pin, and why. For each item on the last line, leave the original unchanged and add one new item that applies all of its listed notes, following "Try another version" above. Change the other items in place. Without a last line, change every item in place.

Sent and copied annotations stay on the canvas as sent pins and disappear on their own, so you never need to clear them: in-place ones once their item renders differently after your edit, new-version ones once an item with `from` set to their item appears, section ones once an item is added or removed. A sent pin that stays means its item did not change, or its new version has no `from`.

### Answer on the pin

A note is not always a request. People also ask, at the thing they are looking at: "why is this button secondary?", "what happens with a long name?". Decide from each note's words which it is.

- **A question.** Change nothing for it, and add no new version, also when its item is on the message's last line. Answer on its pin.
- **A change you could not make, or made in another way.** Reply on its pin: what you did, and why, in one or two sentences. The person reads the reason at the thing it is about, not in the chat.
- **A change you made as asked.** Do not reply. Its pin clears by itself when the item changes, and that is the answer. A Start here note is the exception (see "Start here").

Reply with the note's id, from the last line of its entry:

```sh
bash ~/.agents/skills/design-canvas/scripts/reply.sh http://127.0.0.1:<port>/ <note id> "<text>"
```

- Write plain text, in the person's language, in one or two sentences. No Markdown. The first line shows beside the pin, so put the answer first.
- When the answer needs more room, put it in the chat, and say so in the reply, such as "Three options, in the chat."
- Reply before you listen again, so the answers are there when the "Agent working" tag goes.
- The reply stays on the pin until the person deletes the note. A note is a short conversation: the person can answer your reply on the same pin, and that answer comes to you as an entry with the same note id and what was said before:

  ```text
  1. Approve dialog › button “Mark as done”
     Earlier on this note:
     - Person: Why is this button secondary?
     - Agent (you): Approve is the one primary action in this dialog.
     Now: Then make it a text link.
     (note cm3x9k0c)
  ```

  Handle the `Now` line like any other note: it can be a new question, or a change to make. The lines before it are context.
- If `reply.sh` says the canvas cannot take replies or is not running, answer in the chat and name the note by its reference.
- The canvas shows the reply under the name "Agent". Do not sign it.

### Notes and sections

People explain a canvas to the readers of its shared file with notes and sections. The tools bar at the bottom centre has these tools, one on at a time: **Interact** (the default, where the prototypes respond to clicks; Escape or V returns to it), **Move canvas** (H), **Inspect** (I, when `design-system.ts` names a design system), **Ask agent** (A), **Note** (N) and **Section** (S). A note is a sticker: pick Note, click anywhere, type. A note is plain text, and two marks in it are drawn as formatting, for the person's notes and yours alike: `**words**` is bold, and lines that start with `- ` or `1. ` are a list. Use them only where they help a reader scan, such as the options a decision was between; nothing else from Markdown is drawn. A section is a folder: pick Section, drag a frame, type its title on the tab. Both tools put themselves down after one use. In Interact, a note or a section's tab drags to move it; a note or a section resizes from its border like an item, and a click on a note, or on empty space inside a section, selects it. A double-click edits its text or title, and arrow keys nudge the focused one. A section carries the items, the notes, and the images inside it when it moves. A drag on empty canvas draws a selection box, and Shift + click adds to the selection or takes out of it: the selected items, notes, sections, and images move together when one is dragged, and Delete removes them together (items go to the trash), each as one change with one Undo. So with Interact, empty canvas no longer pans by a drag: scroll, hold Space, or use Move canvas. A new note or section left empty stays on the canvas as a draft: it shows a "Write a note" or "Section title" placeholder, is not a change, and is not sent. Typing makes it a change; the tag's discard button removes a draft.

Adding, moving, resizing, or editing a note or section is saved into `registry.tsx` as soon as the person pauses, and a new one gets an id made from its text: nothing shows while it saves unless the save takes more than a few seconds (then a "Saving…" tag), and the agent is not involved. A new note or section left empty is only a draft and is never saved. Only an annotation, or a change the registry refused (for example with no dev server running), is a request, not content: it shows as a dashed "Not applied yet" ghost until you write it into `registry.tsx`, and the bar at the top centre, which shows only while something is still to apply, has **Discard** and the main button (**Send N to agent** while you listen, **Copy N for agent** otherwise) that sends them with any annotations in one message:

```text
Notes and sections from the design canvas (4):
1. Add a note at 566,260, 220×120: “Keep A: clearer hierarchy”
2. Add a section “Set aside” at 100,400, size 900×500. Inside it, at their positions on the canvas now: Pricing · B (120,440); Pricing · C (520,440)
3. Change note “why-b”: text to “B dropped: too dense on mobile”; move to 640,120
4. Change section “set-aside”: resize to 960×520; items inside, at their positions on the canvas now: Pricing · B (120,440)
```

Apply every entry, and say which you could not:

- **Add a note**: a `notes` entry `{ id, text, x, y, width, height }` with a readable kebab-case `id`. `width` and `height` come from the size shown; `height` is a minimum, since a note grows with its text. Keep the person's wording; fix only typos.
- **Reference images**: the person pastes a picture or drops an image file on the canvas to show you or their readers something: a screenshot, a sketch, another product's screen. The canvas writes the file into the canvas's `images/` folder and an entry into `images` in `registry.tsx` (`{ id, file, x, y, width, height }`), and saves its moves and resizes there. When the person points at an image ("like the reference", "the screenshot beside B"), find the entry by its position and read `images/<file>`. Do not delete the files. To add one yourself, put the file in `images/` and add the entry; a registry with no `images` array gets one above `registry`: `export const images: CanvasImage[] = [];`, with `CanvasImage` from `./canvas/types`.
- **Add a section**: a `sections` entry `{ id, title, x, y, width, height }` with those bounds.
- **Change a note or section**: edit that entry, and only the parts the line names: `text` or `title`, `x` and `y` (move), `width` and `height` (resize).
- **Items inside a section**: the positions listed are where the person has the items now, but the registry still holds their old ones, and the shared file uses the registry. Set each listed item's `x` and `y` to the position shown. A section only draws a frame and never moves items by itself. Items the person did not put inside stay where they are.
- An item's caption (its `note`, between the name and the preview) grows upward from the preview, so previews side by side line up whatever their captions say; a caption puts the item's name above its `y`. It is edited on the canvas with a double-click and saved into `registry.tsx`, like a move; so are moves of items, frames included. The registry edits only touch a field that is a plain string or number on an entry with a literal `id`; a computed value (`x: 0 + gap`, `note: "a" + "b"`) is left alone and the change waits for you as "Not applied yet". After `update.sh` the canvas's dev server must be restarted, or its saves find no route and wait for you too (the canvas says so).
- Every change saved this way can be undone with ⌘/Ctrl + Z, newest first (a move, a resize, an edit, a caption, a new note, a deletion), up to 30 per page load. Undo writes the old values back into `registry.tsx`; it is not available after a reload.
- Removing a note or section needs no request: the person selects it and presses Delete or Backspace, and the canvas removes its entry from `registry.tsx` and offers Undo, which puts it back as it was. Deleting a section removes only the frame; the items and notes inside stay.

A ghost leaves on its own once the registry shows it: a new one when the registry holds one more note or section than when it was sent, a change when the entry matches the ghost's text, position, and size. A ghost that stays means the entry is missing or differs.

### Picked versions

A check beside an item's name picks that version. The canvas does the whole step itself, at once, and the person can undo it:

- It writes `picked: true` on the item's entry. The item shows a ring around its preview and a "Picked" tab on the ring, under the card's bottom-right corner, where every state of an item shows. Both show in the shared file too.
- It moves the versions the item was compared with into one section with the id `set-aside`, below everything else, and writes their new `x` and `y`. Those versions are the other items in the item's section, or, for an item in no section, the other items in no section. When sections sit inside a section, the outermost one is the comparison: the sections inside it, except the picked item's own, move into `set-aside` whole, with their items and notes and new `x` and `y`. A section dragged on the canvas also takes the sections inside it along.
- A later pick sets the earlier one aside too, and removes its `picked`.

You do nothing for the move. Read the result from `registry.tsx`:

- `picked: true` is the person's decision. Treat it as a pick in "Decision notes": when they give the reason, write the note below the picked item. Do not ask for a reason.
- Do not move a picked version into the product until the person asks (see "Move a version into the product").
- When the person picks a version in the conversation instead, such as "go with B", set `picked: true` on it and remove `picked` from the other items of its group. You cannot move the others (see "Decision notes"), so tell the person in one line that the check on the canvas also sets the rest aside.
- Items in the `set-aside` section are out of the running. Do not add new versions inside it, and do not build on one of them unless the person asks.

### Decision notes

A canvas is also the record of why one version was chosen. The people who open the shared file were not in this conversation, so write a note on the canvas yourself when a decision is made. Do not wait to be asked.

- Write a note when the person:
  - picks a version, or says which one they will go with;
  - sets a version aside, drops it, or moves it to the trash, and says why;
  - states a constraint that changes the directions, such as "legal must approve every send".
- Write what the person said and decided, in their words and their language, in one or two sentences. Start with the decision: `Picked A: the hierarchy is clearer.` `Dropped C: legal does not allow automatic approval.` Do not add your own opinion, a guess about what they prefer, or a reason they did not give. When they pick a version and give no reason, write only the decision.
- A version the person drops **and gives a reason for** stays on the canvas. It is evidence of what was considered, and its note must sit beside the thing it explains. Do not trash it; set it aside:
  - Draw a section around the item and its note, where the item is now, titled "Set aside" in the person's language. Give it an id that starts with `set-aside-`, such as `set-aside-table-row`: the id `set-aside` alone belongs to the section the canvas makes for a pick. You cannot move an existing item, because its position is kept in the person's browser. The person can drag the section, and it carries the item and the note.
  - Give the section the item's `x - 20` and `y - 80`, the item's `width + 40`, and the item's `height + 320`. That holds the item with its name and a caption of up to three lines, and the note below it. Make it taller for a long note.
  - When a "Set aside" section is already beside the item, make that section larger to take in the item and its note. Do not add a second one next to it.
  - If the person already moved the version to the trash and then gives the reason, put it back (remove `trashed`), set it aside in the same way, and say so.
- A version dropped with no reason goes to the trash, with no note and no section. If the person asks to set a version aside, or to keep it around, and gives no reason, draw the section and write no note.
- One decision, one note. When a decision changes, edit its note; do not add a second one. Do not write a note for each turn, for a small edit, or to summarize the conversation.
- Put the note below the item it is about, in free space, and inside the item's section if it has one. An item's name sits above its preview, so the item ends lower than `y + height`: give the note the item's `x`, and a `y` of at least the item's `y + height + 100`. Add it to `notes` as "Notes and sections" describes.
- The note goes into the shared file. Leave out the names of real people and customers, and anything else from the conversation that is internal. When it matters who said something, say it in general terms, such as "a customer" or "legal".
- Tell the person in one line that you added or changed a note. They can edit or delete it on the canvas.

### Moved items

Where people put items on the canvas is kept in their browser, but the shared file and the next session use the positions in `registry.tsx`. A moved item is written there as soon as the person pauses, with nothing to show for it unless the save takes more than a few seconds (then a "Saving…" tag). Only a write the dev server refuses, or cannot make, becomes a change for the agent: it shows "Not applied yet", counts in the toolbar's Send button, and goes out in the same message:

```text
Items moved on the design canvas (2):
1. Move “Pricing · B” (id pricing-b) to 120,440
2. Move “Pricing · C” (id pricing-c) to 520,440
```

Set each listed item's `x` and `y` in the registry to the position shown. The tag leaves on its own once the registry matches; a person can also put the item back with the tag's ↺ button. Items inside a section that is itself waiting are listed under that section instead, not here.

## 4. Check

- Open the canvas in the browser. Confirm it mounts, every item renders, and the console shows no errors. A hidden browser pane pauses animation frames, so the camera may not repaint; show the pane before judging what you see.
- Typecheck the canvas when the app uses TypeScript, from the app folder: `npx tsc --noEmit -p design-canvas/<name>/tsconfig.json`. App type checks may include the canvas folder too.
- Interact with what you changed, check `viewport` items at their real width, and switch themes when the app has them. Do what each `Try` you wrote says, from the item's start: the control is there with those words, and using it shows the difference.
- Each item that shows the current product matches the app, or its `note` lists what differs (see "Match the current product first").
- The shell is already tested. Retest shell behavior only after changing the shell.
- Only report a check as passed if you ran it.

## 5. Share and keep results

The canvas runs on this machine. To let other people try it, share it as a file.

- **Share as a file.** When the person wants others to try the canvas, or wants it in Figma, run `bash ~/.agents/skills/design-canvas/scripts/share.sh <canvas-folder>`. It builds the canvas into one HTML file, `<canvas-folder>/shared/<name>-<date>.html`, and prints its path and size. Give the person the path; on a Mac, `open -R <file>` shows it in Finder. A second argument writes the file somewhere else. People can also click **Share** in the canvas toolbar and choose the whole canvas or one section: the dev server builds the same file without the rest, and the browser downloads it. Notes for you and the trash never go in.
  - The file opens with a double-click in any browser, with no server, the app, or an agent. Every item, theme, pan and zoom, and Alt-click reference works. It keeps notes, sections, and reference images, since they are in the registry, and leaves out annotations, the unapplied ghosts, and sending to the agent. Each viewer's layout stays in their own browser.
  - In Figma, people drag the file onto a canvas. It becomes a code layer; they press its play button or view it full screen.
  - In Notion, people drag the file into a page. It becomes an embedded web page that works in place.
  - It is a snapshot. Share again after changes, and say which items changed.
  - The file holds the canvas's built code and every item's data, and it leaves this machine. Before sharing, check that the items follow the rules in "Add content": made-up data, no secrets, no analytics.
  - Files the items load from the app's public folder by root path, such as `/logo.svg`, go inside the file too. If it names files it could not include, their paths match no file in the public folder: fix the path or import the file in its item, then share again. A path built at runtime, such as `/avatars/${id}.png`, cannot be found this way, so import those files in the item.
- **Share as a link for comments (Claude only).** When the person asks for a link that others can comment on, and you have a tool that publishes Claude Artifacts, build the shared file with `share.sh` and publish that file as an Artifact, as built, with no edits. Without such a tool, share the file. The same data rules apply: the file leaves this machine.
  - The canvas works there as it does in the file: pan, zoom, themes, `viewport` items, notes, and sections. Checked with a 368K file; an Artifact page can be at most 16MB.
  - The Artifact is private. Tell the person that nobody else can open the link until they share it from the Artifact's Share menu, and that their organization's settings decide who they can share it with.
  - Keep the Artifact's URL for this canvas. After changes, build the file again and publish it to the same URL: pages that people have open reload by themselves.
  - Reviewers comment with the Artifact's own comment mode, and a comment's pin stays on its element when the canvas pans or zooms. A plain comment does not reach you: read the comments when the person asks. A comment that someone sends to Claude from its thread arrives in this session: make the change, publish again, and reply in that thread.
  - Treat a comment like a canvas annotation. It names the canvas and quotes the text of the element it is on, not the item's name, so find the item from that text. If the same text is in more than one item, ask the person which item is meant; do not guess. Change that item in place unless the comment or the person asks for a new version. In a `viewport` item a comment lands on the whole item, not on an element inside it.
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

End with: changed paths and new item names, marking those built on a new component as needing engineering before they ship; checks run and results; for each item that shows the current product, what you compared it with and what still differs; what is not working or not tested; defaults you chose without asking.

## Report a problem with the skill

When you had to work around a gap in the skill itself (its shell, kit, scripts, or these instructions) inside the canvas folder, or wanted to change the skill's own files, offer to report it. A problem in the app's own setup is not one.

- Ask once, at the end of the job, about one issue that covers every such problem. Never stop in the middle of the work for it.
- Write it for the skill's maintainers: what happened, the exact error text, the workaround you used, and the setup: the React version, the framework and router with their versions (Next.js, Vite, React Router), and the design system. Leave out the project's code, component names, paths or names that identify the company, and any data; use generic names instead.
- Show the user the draft first, and send it only after they agree. If `gh auth status` shows a login that can reach `charlie5188/design-canvas`, file it with `gh issue create --repo charlie5188/design-canvas`. Otherwise give the user a link to open themselves, `https://github.com/charlie5188/design-canvas/issues/new` with the title and body URL-encoded as `?title=…&body=…`.

## Changing the shell

The shell lives in `~/.agents/skills/design-canvas/shell/`. Fix bugs there, not in a canvas copy, then run `scripts/update.sh` on the canvases that need the fix. Every error or warning a script prints says what to do next. Raise `VERSION` by one when installed copies should update; `scripts/check-version.sh` compares it with GitHub's main branch. After any shell change, run the full checklist in `shell/TESTING.md` and say which parts you could not test.
