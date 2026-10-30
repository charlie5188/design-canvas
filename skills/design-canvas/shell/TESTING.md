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
- The open icon appears when the title is hovered or the icon has keyboard focus, is always visible on touch devices, and opens `frame.html?item=<id>` in a new tab without changing the canvas.
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

- Zoom out, zoom level, zoom in, show all, reset, and help sit centered at the bottom. The help list opens on hover or keyboard focus and describes the canvas region for screen readers.
- At narrow widths the text labels drop and every control stays.

## Themes

- With a theme store, the toolbar shows one pressed button per theme; without one, it shows none.
- Switching applies the theme to the canvas, its chrome, and every `viewport` frame, and survives reload.
- A frame page opened alone uses the saved theme.

## References

- Holding Alt/Option outlines the element under the pointer in plain items and in frames; releasing hides it.
- Alt/Option-click copies `Item › role “label”`, never activates the control, and numbers look-alikes.
- Alt-click on empty canvas or on chrome does nothing.

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
