# Shell test checklist

Run this after any change to `shell/`. Use a canvas with at least one plain
item, one `viewport` item, one item with a nested scroll area, and one with a
menu or popover. Only mark a line as passed if you ran it; say which lines need
a device or input you do not have.

## Camera

- Drag empty space pans. Space + drag and middle-button drag pan anywhere, including over previews and `viewport` frames (middle-button over a frame is a known limit).
- ⌘/Ctrl + wheel and trackpad pinch zoom around the pointer, over empty space, previews, and frames, in both directions without jumps or drift.
- A canvas opened in a background or zero-size tab fits all items once it has a real size, never at minimum zoom.
- Toolbar zoom buttons and `+`, `-` step between fixed levels (10, 25, 50, 100, 200, 300%) around the viewport center: from 100% a press goes to 200% or 50%, from a level between two (94% after a fit) to the next one in that direction, and the ends hold. Wheel and pinch stay continuous. `0` resets the camera only. `1` and "show all" fit every item, including titles and handles.
- Wheel over a nested scroll area scrolls it until its end, then pans. The same inside a frame.
- Horizontal trackpad swipes never trigger browser Back or Forward.
- Arrow keys pan when the canvas has focus. Tabbing to an offscreen control moves the camera to show it.

## Cursors

- Empty space and an item's grip and name show an open hand; a pan or an item move shows a closed hand everywhere, including over previews and frames. Holding Space shows the open hand everywhere.
- Previews keep the app's own cursors: a text cursor over text, the app's pointers on controls.
- Holding Alt/Option over a preview or a frame shows the copy cursor.
- In annotate mode previews, frames, and item titles show a crosshair; a pan or Space still shows the hand.

## Items

- Dragging the grip or the name moves an item at every zoom level, with mouse and touch; arrow keys on the focused grip move it, Shift for larger steps. Moving never remounts a preview or clears its input.
- Clicking, Enter, or Space on a name copies the exact name and shows "Copied"; a press that drags never copies. Hover alone never copies. When the clipboard fails, a selectable field appears.
- The open and trash icons appear when the title is hovered or the icon has keyboard focus, and are always visible on touch devices. The open icon opens `frame.html?item=<id>` in a new tab without changing the canvas. Pressing either never starts a move.
- A pan or move that ends over a control does not click it.
- Previews keep clicking, typing, text selection, focus, and their own keyboard shortcuts. Space inside an input types a space.
- Menus, popovers, and dialogs open in the right place at 50%, 100%, and 200% zoom.
- Touching or focusing an item brings it above overlapping items, so a covered handle becomes reachable; only one item is in front.

## Navigation

- A link in a preview, in a portaled menu, or inside a frame leaves the URL unchanged, shows a short notice, and still runs the component's own click handler.
- A link to `#<item-id>` moves the camera to that item and brings it to the front, zooming out only as far as it needs.
- A native form submit is cancelled with a notice; a form that cancels its own submit shows nothing.
- A pan or move that ends on a link shows no notice.

## Toolbar

- Controls sit in four places: tools (Select, Request change, Note, Section) at the bottom centre; zoom out, zoom level, zoom in, show all, and reset view at the bottom right; theme, share, and help at the top right; trash at the bottom left while it holds items. All are icon buttons with tooltips that open away from the screen edge and stay on screen. A bar at the top centre appears only while a change is waiting: Discard and, while any change is unsent, Copy (or Apply, while an agent listens). Nothing shifts under the pointer when it appears or goes. The help list opens on hover or keyboard focus, below the top bar, and describes the canvas region for screen readers.
- Narrow windows (375px): the view bar stacks above the tools bar, the changes bar drops under the top bar, notices clear both, and no bar covers another. Show all and revealed items stop short of the top bars and the bottom bars.
- At narrow widths (375 px) the text labels and separators drop and every control stays on screen, with annotations and trashed items present.

## Themes

- With a theme store, the toolbar shows one pressed button per theme; without one, it shows none.
- Switching applies the theme to the canvas, its chrome, and every `viewport` frame, and survives reload.
- A frame page opened alone uses the saved theme.

## References

- Holding Alt/Option outlines the element under the pointer in plain items and in frames; releasing hides it.
- Alt/Option-click copies `Item › role “label”`, never activates the control, and numbers look-alikes.
- Alt-click on empty canvas or on chrome does nothing.

## Annotations

- The Request change button and A (with the canvas, toolbar, or a pin focused) toggle annotate mode; Escape leaves it. A typed inside a preview or a field reaches that field.
- In annotate mode, hovering outlines elements in plain items and in frames without holding Alt; the outline hides when the camera moves.
- Clicking an element in a plain item or in a frame places a numbered pin at the click, also right after a zoom, and opens a note showing `Item › role “label”`. The control is not activated, and a link shows no notice and leaves the URL unchanged.
- Dragging across a plain item or a frame draws a box, kept inside the item, and on release opens a note showing `Item › area W×H at X,Y: …` with the controls, headings, and texts entirely inside it, in item pixels at any zoom. The area keeps its outline, with its pin at the top-left corner; no element note opens too. A press that barely moves stays a click on one element.
- Clicking an item's name or grip annotates the whole item (`Item`), outlined around the preview, instead of copying the name; dragging them still moves the item. Hovering a title outlines the whole preview.
- Enter saves, Shift+Enter adds a line, and Enter that confirms an IME composition (Japanese, Chinese) does neither. Escape, in the note or on the checkbox, removes a new annotation and restores an edited one. Saving or cancelling returns focus to the pin.
- "Apply to a new version" is checked on an item's first annotation; later ones on that item start with the item's current choice. Changing it changes every unsent annotation on that item, and Escape undoes that too. Changing it on a sent annotation makes it unsent.
- Clicking elsewhere, or another element, keeps the typed text; an empty annotation is removed. Clicking a pin reopens it with the caret at the end; delete removes it.
- A note opened near the right or top edge of the window opens on the other side of its pin, so opening or typing in a note never pans the canvas.
- Space + drag and middle-button drag still pan over previews in annotate mode, and the pan places no annotation.
- Pins move with their item, keep one size from 10% to 300%, and follow the theme.
- Copy N annotations writes one message with the unsent annotations, numbered like their pins, and shows "Copied N annotations". When any are checked, the last line reads "Keep the original and add a new version:" with those items and their numbers; with none checked there is no last line. Those pins turn into sent pins (check mark) and the next copy leaves them out. When the clipboard fails, the whole list appears in a selectable field and nothing is marked sent.
- Editing a sent annotation makes it unsent again; opening and cancelling keeps it sent.
- After a hot update, and after a reload, sent annotations on items that now render differently are removed with "Cleared N sent annotations on updated items" and Undo. Unsent annotations, and sent ones on unchanged items (including other items from the same source file), stay. A theme switch never clears anything.
- A sent new-version annotation stays while its item changes, and is removed with "Cleared N sent annotations: new version added" and Undo once a new item with `from` set to its item appears. Removing such an item clears nothing.
- Clear removes every annotation and offers Undo.
- Alt-click still copies a single reference, in and out of annotate mode, and places no pin.

## Sending to the agent

Run `scripts/listen.sh <canvas-url>` in a terminal as the agent would.

- While it waits, the copy button reads "Send N to agent". Pressing it makes `listen.sh` print the same message Copy writes, plus a line telling the agent to listen again, and exit. The pins turn into sent pins and "Sent N annotations to the agent" shows.
- Without a listener, after a listener is stopped, or on a canvas whose vite config lacks `agentChannel()`, the button reads "Copy N annotations" and copies. `listen.sh` on such a canvas says it cannot send, and on a stopped dev server says it is not running.
- After a delivery, until `listen.sh` runs again, Send queues: the pins show a clock, "Queued N annotations" shows, and the next `listen.sh` receives them at once as one message, numbered from 1. Editing a queued annotation makes it unsent.
- Stopping `listen.sh` or the dev server while annotations are queued turns them back into numbered unsent ones with "The agent stopped listening, so N annotations weren't sent"; so does a reload while no agent listens. 15 minutes without a new listener after a delivery or timeout count as stopped.
- After a delivery, the toolbar shows "Agent working" with a pulsing dot (still under reduced motion) until `listen.sh` runs again; then it goes away and "The agent finished" shows. A quiet timeout and the `listen.sh` that follows show neither. At 375 px it stays on screen.
- A listener with `keep=1` (the Codex listener) keeps "Agent working" across its reconnects. `POST /__design-canvas/agent/done` without `Origin` ends it with "The agent finished"; with an `Origin` header it gets 403. Stopping the listener or 15 minutes without done end it silently.
- A second `listen.sh` replaces the first, which prints that another session is listening and exits.
- Stopping the dev server switches the button back to Copy; `listen.sh` reconnects by itself after a dev server restart.
- Requests to `/__design-canvas/agent/listen` with an `Origin` or `Sec-Fetch-Site` header, and sends to `/__design-canvas/agent/send` from another origin or host, get 403.
- Annotations survive reload and hot reload, including one being typed; annotations on removed items are dropped. Corrupt saved annotations fall back to none without errors.

## Trash

- Moving an item to the trash hides it at once with "Moved <name> to the trash" and Undo, keeps focus on the canvas, and leaves other items in place. Its unsent annotations are hidden, not copied, and not cleared; they return with it.
- The trash button shows the count. It opens above the trash button, at the bottom left, with the most recently trashed item first; each entry shows a live, scaled-down preview (a `viewport` item at its own width) and its name, and takes no clicks, focus, or Alt-picks inside the preview.
- Opening the trash focuses its first entry; Escape closes it and returns focus to the button, and pressing outside it closes it. At 375 px it shows two columns inside the window.
- Picking an entry closes the trash and puts the item back where it was, or beside its row if that spot is now taken, then brings it into view and to the front. The trash button goes away when the trash is empty.
- Show all and links to `#<item-id>` ignore trashed items. The trash survives reload; ids no longer in the registry drop out.
- Moving an item to the trash writes `trashed: true` into its registry entry, and putting it back removes it, leaving the entry as it was. A trash saved only in the browser, by an older shell, is written on the next load.
- Changing `trashed` in source moves that item into or out of the trash on every open canvas. A new item with `trashed: true` starts in the trash.
- Opening the canvas never changes `trashed` in the registry, even in a tab or browser whose saved trash differs: it shows the registry's trash. Only moving an item into or out of the trash writes it.
- An item whose `trashed` cannot be written (its entry is not found exactly once) stays in the trash in this browser, across reloads.

## New versions

- A new registry item with `from` set appears right of that item, else below it, else at the nearer end of that item's row or column; no other item moves. The camera shows both, fully above the toolbar and the notice that announces the new version.

## Viewport items

- A responsive component shows its narrow layout in a narrow `viewport` item while the window is wide.
- `frame.html?item=<id>` alone renders the item at its size without chrome, centered in a larger tab and scrollable in a smaller one; an unknown id shows a short message.
- Opened alone in a wide tab, a `viewport` item still shows its narrow layout.

## Shared file

Run `scripts/share.sh` on a canvas with a `viewport` item, and open the file from disk in Chrome and Safari, and inside another page the way a preview pane or an embed shows it (an iframe whose `src` is a blob of the file, or whose `srcdoc` is the file).

- Every item renders and works, with no console errors. Request change, its A shortcut, its help line, and Share are gone; Alt-click still copies a reference.
- An image an item loads from the app's public folder by root path shows; a root path with no file there is named by share.sh.
- Wheel, pinch, Space-drag, and Alt-click over a `viewport` item reach the canvas, as on the dev server.
- The open-alone icon opens the same file with `?item=<id>`, which shows that item alone. Inside another page the file has no address to open, so the icon is not there.
- Inside another page, every `viewport` frame renders, and wheel over one still pans the canvas.
- Items in the trash on the canvas start in the shared file's trash, not on the canvas.
- Reload keeps the layout. A newer shared file of the same canvas opens as it was shared, not with the layout saved in an older one.
- On the dev server, the Share icon button (tooltip "Share as an HTML file") dims, pulses, and takes no second click while the file builds, then downloads `<canvas-name>-<date>.html` without reloading the page.
- After the download, a panel under the Share button names the file, any file it could not include, and how to open it, send it, or put it in Figma or Notion. Escape, its close button, or a press outside closes it and returns focus to Share; opening the trash closes it too.

## Layout

- Reload keeps camera and positions; removed ids are ignored.
- A new registry item appears at its source position when that spot is free. When it overlaps the saved layout, it moves to free space beside its row. Either way the camera brings it into view, existing items stay put, and the next reload treats it as known.
- Corrupt or oversized saved data, or blocked storage, falls back to defaults without errors.
- The console shows no errors or warnings from the shell.

## Performance

Before claiming smooth performance, profile a canvas with a realistic number of items during pan, zoom, and move. Record the item count, browser, and device, and look for long tasks, repeated layout, and preview rerenders.

## Tools, notes, and sections

- The tools bar has Select, Request change, Note, and Section; exactly one is pressed. Select is the default. Escape or V returns to Select from any of them, A toggles Request change, N and S pick the Note and Section tools, none of these while typing in a field.
- Note and Section work without Request change mode. While one is armed the cursor is a crosshair everywhere and every press, also over items, notes, and sections, goes to the canvas; it puts itself down after one use. Picking Annotate or Select puts it down too.
- Note: one click places a sticker with its field focused, showing the "Write a note" placeholder and no tag; typing works at once. Escape or a press elsewhere keeps the text. An empty note stays as a draft: placeholder, no state, not counted or sent, kept in browser storage; its discard button removes it. Once it has text it is appended to `notes` in `registry.tsx` with an id made from its text, shows "Saving…", and leaves when the registry has one more note.
- Section: a drag draws the outline, then a folder with the "Section title" placeholder focused on the tab; Enter keeps it. Left empty it stays as a draft, like a note; with a title it is appended to `sections` the same way. With no dev server a new note or section stays "Not applied yet" and goes to the agent. A drag under 80×60 canvas units makes nothing and keeps the tool.
- A section looks like a folder: its title is on a raised tab joined to the frame, in tints of the canvas colors in both themes. A note is a sticker with a cut, folded bottom-right corner in fixed colors in both themes.
- In Select, dragging a note, or a section's tab, moves it at every zoom; a press that never travels stays a click and selects it. A selected one shows four corner grips; dragging one resizes it with the opposite edge fixed, to a minimum size. A section carries the items and the notes inside it: dragging the section, or nudging it with arrow keys, moves them by the same amount, and dragging it back restores them with no change left. A registry note carried this way is its own change, listed separately. Arrow keys move the focused one (Shift for larger steps), Enter or a double-click edits it.
- A registry update, from a save or from the agent, never cancels a drag in progress (an annotation area, a move): the `items`, `notes`, and `sections` arrays keep their identity while their entries are equal.
- Delete or Backspace on a selected note or section removes its entry from `registry.tsx`, hides it at once, and shows "Note deleted" or "Section deleted" with Undo, which puts the entry back with its id, text, position, and size. A section's items and notes stay. The keys do nothing while a field has them (a note being edited, an annotation), in a shared file, or with no dev server, where "Couldn't delete it" shows and the entry comes back.
- The caption under an item's name (its `note`) is edited with a double-click: the text becomes a one-line field, Enter or leaving it saves into `registry.tsx` (the new text shows at once), Escape cancels, an empty or unchanged caption saves nothing. The canvas's keys (A, N, S, Delete) stay out of the field. A shared file cannot edit captions.
- When an automatic save cannot go through, a notice says why: "Restart this canvas's dev server" when the server does not answer (or does not know the route), or that the item cannot be changed automatically when its registry entry has no plain id or a computed value. The change then waits for the agent as "Not applied yet".
- ⌘/Ctrl + Z undoes the last saved change from anywhere on the canvas, including with focus on an item's grip, and not inside a text field or a preview: a moved item (and its place in the browser), a resize, an edit, a caption, a new note (removed again), a deleted note or section (put back). Each press undoes one saved change, newest first; "Nothing to undo" shows when there is none, and an undo is not itself saved as new history. It does not survive a reload. The help list mentions it, and in a shared file it is gone.
- A save never reloads the page (a marker set on `window` survives it), also with a frame page open or `viewport` items on the canvas. Moving, resizing, or editing a note or section from the registry saves it into `registry.tsx` after a short pause: its ghost shows "Saving…" with no discard button and leaves once the registry matches. Putting it back where it began removes the ghost. With no dev server the change falls back to "Not applied yet" and the agent message.
- Ghosts are dashed and tagged "Not applied yet", turn "Sent · waiting for the agent" or "Queued" after sending, stay across a reload, and a ghost section stays behind its items. Moving a sent ghost makes it a new request.
- The button in the changes bar counts notes, sections, and annotations together and says "Apply N changes" with a listening agent, "Copy N changes" without. Leaving annotate mode with changes waiting shows "N changes aren't applied yet" with a button that applies or copies them.
- The message lists the changes in words (add, move, resize, text or title) and, for a section, the items inside it with their current positions.
- Adding a note or section to the registry replaces its sent ghost; a change's ghost leaves once the entry matches its text, position, and size.
- Discard changes (the eraser) drops annotations, ghosts, and moved items' new positions in one step, with Undo for all of it; its toast counts what the Apply button counted.
- Registry notes and sections draw in the shared file, sections behind items, with no tools, grips, or ghosts. Fit all includes them.
- A section shows the grip an item's name has on its tab, and its frame lights up under the pointer; pulling the tab or any edge of the frame moves it, and a press inside the frame still pans.

## Moved items

- Dragging an item saves its position to `registry.tsx` after a short pause, with a "Saving…" tag and no ↺ button, which leaves once the registry matches. With no dev server it shows "Not applied yet" and a ↺ button, and the changes bar counts it. A shared file shows neither.
- The message lists "Move “Name” (id x) to x,y". After sending, the tag says "Sent · waiting for the agent" ("Queued" while the agent is busy); moving the item again makes it new again.
- ↺ puts the item back where the registry has it and ends the change. An item whose registry position changes to match loses its tag on its own.
- Items inside a section that is waiting for the agent are one change with it: no tag, not counted twice.
- Notes inside a section that moves are saved with it, in the same write, and show no tag of their own.
- An empty draft note or section is never saved; it moves with its section and is discarded with its ✕ button.
