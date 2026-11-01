# Shell test checklist

Run this after any change to `shell/`. Use a canvas with at least one plain
item, one `viewport` item, one item with a nested scroll area, and one with a
menu or popover. Only mark a line as passed if you ran it; say which lines need
a device or input you do not have.

## Camera

- Drag empty space pans. Space + drag and middle-button drag pan anywhere, including over previews and `viewport` frames (middle-button over a frame is a known limit).
- ⌘/Ctrl + wheel and trackpad pinch zoom around the pointer, over empty space, previews, and frames, in both directions without jumps or drift.
- A canvas opened in a background or zero-size tab fits all items once it has a real size, never at minimum zoom.
- Toolbar zoom buttons and `+`, `-` zoom around the viewport center. `0` resets the camera only. `1` and "show all" fit every item, including titles and handles.
- Wheel over a nested scroll area scrolls it until its end, then pans. The same inside a frame.
- Horizontal trackpad swipes never trigger browser Back or Forward.
- Arrow keys pan when the canvas has focus. Tabbing to an offscreen control moves the camera to show it.

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

- Zoom out, zoom level, zoom in, show all, reset, annotate, and help sit centered at the bottom; copy (send, while an agent listens) appears only while there are unsent annotations, clear (eraser) while there are any, and trash while it holds items. The help list opens on hover or keyboard focus and describes the canvas region for screen readers.
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

- The Annotate button and A (with the canvas, toolbar, or a pin focused) toggle annotate mode; Escape leaves it. A typed inside a preview or a field reaches that field.
- In annotate mode, hovering outlines elements in plain items and in frames without holding Alt; the outline hides when the camera moves.
- Clicking an element in a plain item or in a frame places a numbered pin at the click, also right after a zoom, and opens a note showing `Item › role “label”`. The control is not activated, and a link shows no notice and leaves the URL unchanged.
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
- A second `listen.sh` replaces the first, which prints that another session is listening and exits.
- Stopping the dev server switches the button back to Copy; `listen.sh` reconnects by itself after a dev server restart.
- Requests to `/__design-canvas/agent/listen` with an `Origin` or `Sec-Fetch-Site` header, and sends to `/__design-canvas/agent/send` from another origin or host, get 403.
- Annotations survive reload and hot reload, including one being typed; annotations on removed items are dropped. Corrupt saved annotations fall back to none without errors.

## Trash

- Moving an item to the trash hides it at once with "Moved <name> to the trash" and Undo, keeps focus on the canvas, and leaves other items in place. Its unsent annotations are hidden, not copied, and not cleared; they return with it.
- The trash button shows the count. It opens above the toolbar with the most recently trashed item first; each entry shows a live, scaled-down preview (a `viewport` item at its own width) and its name, and takes no clicks, focus, or Alt-picks inside the preview.
- Opening the trash focuses its first entry; Escape closes it and returns focus to the button, and pressing outside it closes it. At 375 px it shows two columns inside the window.
- Picking an entry closes the trash and puts the item back where it was, or beside its row if that spot is now taken, then brings it into view and to the front. The trash button goes away when the trash is empty.
- Show all and links to `#<item-id>` ignore trashed items. The trash survives reload; ids no longer in the registry drop out.

## New versions

- A new registry item with `from` set appears right of that item, else below it, else at the nearer end of that item's row or column; no other item moves. The camera shows both, fully above the toolbar and the notice that announces the new version.

## Viewport items

- A responsive component shows its narrow layout in a narrow `viewport` item while the window is wide.
- `frame.html?item=<id>` alone renders the item at its size without chrome, centered in a larger tab and scrollable in a smaller one; an unknown id shows a short message.
- Opened alone in a wide tab, a `viewport` item still shows its narrow layout.

## Layout

- Reload keeps camera and positions; removed ids are ignored.
- A new registry item appears at its source position when that spot is free. When it overlaps the saved layout, it moves to free space beside its row. Either way the camera brings it into view, existing items stay put, and the next reload treats it as known.
- Corrupt or oversized saved data, or blocked storage, falls back to defaults without errors.
- The console shows no errors or warnings from the shell.

## Performance

Before claiming smooth performance, profile a canvas with a realistic number of items during pan, zoom, and move. Record the item count, browser, and device, and look for long tasks, repeated layout, and preview rerenders.
