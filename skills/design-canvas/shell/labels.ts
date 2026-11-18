// Canvas chrome copy. Edit here to change the language of the controls.
export const labels = {
  region: "Design canvas",
  toolbar: "Canvas view",
  toolsBar: "Tools",
  viewBar: "View",
  canvasBar: "Canvas",
  changesBar: "Not sent to the agent yet",
  theme: "Theme",
  background: "Background",
  canvasSettings: "Canvas settings",
  backgrounds: { default: "Default", white: "White", dark: "Dark" },
  help: "Canvas controls",
  /**
   * Canvas controls, in groups. Words between backticks are keys and are drawn as key caps.
   * `local` marks what a shared file leaves out: it has no agent, and saves nothing.
   */
  helpGroups: [
    {
      title: "Move around",
      rows: [
        { what: "Pan", how: "Scroll, or `Space` + drag" },
        { what: "Zoom", how: "`⌘/Ctrl` + scroll" },
        { what: "Zoom to an area", how: "`Z` + drag" },
        { what: "Zoom in at a point", how: "`Z` + click" },
        { what: "Zoom out at a point", how: "`Z` `⌥/Alt` + click" },
        { what: "Fit all", how: "`1`" },
        { what: "Actual size", how: "`Shift` `0`" },
        { what: "Zoom to the selection", how: "`Shift` `2`" },
        { what: "Reset the view", how: "`0`" },
        { what: "Pan and zoom with keys", how: "Arrows, `+` `−`" },
      ],
    },
    {
      title: "Items",
      rows: [
        { what: "Move", how: "Drag the name" },
        { what: "Select several", how: "Drag on empty canvas, or `Shift` + click", local: true },
        { what: "Move or delete the selection", how: "Drag one of them, or `Delete`", local: true },
        { what: "Add a reference image", how: "Paste it, or drop the file", local: true },
        { what: "Keep a move straight", how: "`Shift` + drag" },
        { what: "Resize", how: "Drag the border" },
        { what: "An item's actions", how: "Hover the item" },
        { what: "See every screen of a flow", how: "Click the screen count by its name" },
        { what: "Copy an element's reference", how: "`⌥/Alt` + click" },
        { what: "Undo a saved change", how: "`⌘/Ctrl` `Z`", local: true },
      ],
    },
    {
      title: "Ask the agent",
      local: true,
      rows: [
        { what: "Start asking", how: "`A`" },
        { what: "About an element", how: "Click it" },
        { what: "About an area", how: "Drag across it" },
        { what: "About a whole item", how: "Click its name" },
        { what: "Rewrite a text in place", how: "Double-click it" },
        { what: "Send", how: "`⌘/Ctrl` `Enter`" },
        { what: "Keep a note for later", how: "`Enter`" },
      ],
    },
    {
      title: "Notes and sections",
      local: true,
      rows: [
        { what: "Add a note", how: "`N`, then click" },
        { what: "Add a section", how: "`S`, then drag" },
        { what: "Edit a caption or a note", how: "Double-click it" },
        { what: "Remove the selected one", how: "`Delete`" },
        { what: "Back to Interact", how: "`V` or `Esc`" },
      ],
    },
  ] as { title: string; local?: boolean; rows: { what: string; how: string; local?: boolean }[] }[],
  linkBlocked: (target: string) => `Links stay on the canvas: ${target}`,
  /** A link inside an item that names its screens, to a path that is not one of them. */
  screenMissing: (target: string) => `This item has no screen for ${target}`,
  /** A link that opens a new tab in the product, to a path that no other item shows. */
  newTabBlocked: (target: string) => `Opens in a new tab: ${target}`,
  formBlocked: "Forms don't submit on the canvas",
  zoomIn: "Zoom in",
  zoomGroup: "Zoom",
  zoomOut: "Zoom out",
  fitAll: "Fit all",
  resetCamera: "Reset view (actual size)",
  openAlone: (name: string) => `Open ${name} in a new tab`,
  openAloneHint: "Open in new tab",
  copied: "Copied",
  copiedText: (text: string) => `Copied: ${text}`,
  copyFailed: "Couldn't copy. Select the text and copy it.",
  dismiss: "Dismiss",
  move: (name: string) => `Move ${name}`,
  moveHelp: "Use the arrow keys to move. Hold Shift to move faster.",
  missingItem: (id: string) => `No canvas item “${id}”`,
  pick: (name: string) => `Pick ${name} and set the others aside`,
  pickHint: "Pick this one",
  /** On the item that was picked. Shown in the shared file too. */
  picked: "Picked",
  pickedToast: (name: string, others: number) =>
    others ? `Picked ${name}. Set ${others} other${others === 1 ? "" : "s"} aside.` : `Picked ${name}`,
  unpick: (name: string) => `Unpick ${name}`,
  unpickHint: "Unpick",
  unpicked: (name: string) => `Unpicked ${name}`,
  pickFailed: "Couldn't save the pick. Is the canvas's dev server running?",
  /** The title of the section a pick makes for the versions that were not picked. */
  setAside: "Set aside",
  /** On the Pick button, beside its check: the one action with a word, because it is the decision. */
  pickShort: "Pick",
  askItem: (name: string) => `Ask agent about ${name}`,
  askItemHint: "Ask agent about this item",
  more: (name: string) => `More actions for ${name}`,
  moreHint: "More",
  /** One-press requests in a new note about a whole item. The words go into the note, to send or to change first. */
  quickAsks: [
    // Flow is first: an item's screen count, the way into the flow view, shows only once the item
    // has more than one screen, so this request is how people find that a flow can be asked for.
    { label: "Flow", text: "Add the other screens of its flow." },
    { label: "Phone", text: "Show this at phone width." },
    { label: "States", text: "Add its empty, loading, and error states." },
    { label: "Languages", text: "Show this in the other languages the app has." },
  ],
  quickAsksLabel: "Quick requests",
  // The flow view (FlowView.tsx).
  screens: (n: number) => `${n} screen${n === 1 ? "" : "s"}`,
  showFlow: (name: string, n: number, states = 0) =>
    `Show ${[n > 1 ? `the ${n} screens` : "", states ? `${states} state${states === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ")} of ${name}`,
  states: (n: number) => `${n} state${n === 1 ? "" : "s"}`,
  stateDefault: "Default",
  statesOf: (path: string) => `States of ${path}`,
  flowOf: (name: string) => `Screens of ${name}`,
  openScreen: (path: string) => `Open ${path}`,
  /** The name of an item's own screen when it names no path. */
  firstScreen: "Start",
  askFlow: (name: string) => `Ask agent about the whole flow of ${name}`,
  askScreen: (path: string) => `Ask agent about ${path}`,
  askScreenHint: "Ask agent about this screen",
  askFlowHint: "Ask agent about the whole flow",
  backToCanvas: "Back to the canvas (Esc)",
  /** How a note about one screen, or the whole flow, names what it is about, for the agent. */
  screenRef: (name: string, path: string, state?: string) => `${name} › screen ${path}${state ? ` (${state})` : ""}`,
  flowRef: (name: string, paths: string[]) => `${name} › the whole flow (${paths.join(" → ")})`,
  /** The words on an arrow: what makes that step. */
  flowStep: (words: string) => `click "${words}"`,
  restart: (name: string) => `Restart ${name}`,
  restartHint: "Restart",
  startHere: (name: string) => `Start ${name} here`,
  startHereHint: "Start here",
  /**
   * The note Start here writes (start.ts): the request, the screen the item shows, and what the
   * person did since its start. The agent reads "Start here" as SKILL.md, "Start here", says.
   */
  startHereNote: (screen: string | undefined, steps: string[], earlier: number) =>
    [
      "Start here: make this item, and the versions it is compared with, start where it is now.",
      ...(screen ? [`Screen: ${screen}`] : []),
      ...(steps.length ? ["After:", ...(earlier ? [`(${earlier} earlier step${earlier === 1 ? "" : "s"} not listed)`] : []), ...steps.map((step, index) => `${index + 1}. ${step}`)] : []),
    ].join("\n"),
  stepPress: (words: string) => `Pressed “${words}”`,
  stepClick: (words: string) => `Clicked “${words}”`,
  stepType: (value: string, field: string) => (value ? `Typed “${value}” in “${field}”` : `Cleared “${field}”`),
  stepTypeHidden: (field: string) => `Typed in “${field}”`,
  stepChoose: (value: string, field: string) => `Chose “${value}” in “${field}”`,
  stepCheck: (checked: boolean, field: string) => `${checked ? "Checked" : "Unchecked"} “${field}”`,
  stepKey: (key: string, field?: string) => (field ? `Pressed ${key} in “${field}”` : `Pressed ${key}`),
  /** A field with no label, placeholder, or name. */
  stepField: "a field",
  copyName: (name: string) => `Copy the name ${name}`,
  copyNameHint: "Copy name",
  moveToTrash: (name: string) => `Move ${name} to the trash`,
  moveToTrashHint: "Move to trash",
  movedToTrash: (name: string) => `Moved ${name} to the trash`,
  trash: (n: number) => `Trash, ${n} item${n === 1 ? "" : "s"}`,
  trashHeading: "Trash",
  trashCount: (n: number) => `${n} item${n === 1 ? "" : "s"}`,
  trashToday: "Today",
  trashYesterday: "Yesterday",
  trashEarlier: "Earlier",
  trashAll: "Back to all items",
  trashPrevious: "Previous (←)",
  trashNext: "Next (→)",
  trashPosition: (n: number, of: number) => `${n} of ${of}`,
  closeTrash: "Close",
  putBack: (name: string) => `Put back ${name}`,
  putBackShort: "Put back",
  setAsideFromTrash: (name: string) => `Set aside ${name}`,
  setAsideFromTrashHint: "Put it in the Set aside section",
  setAsideFailed: "Couldn't set it aside. Is the canvas's dev server running?",
  // The tool is a conversation with the agent, at the place the words are about:
  // a request for a change, or a question. "Ask" covers both, and names who answers.
  annotate: "Ask agent",
  annotateHint: "Ask agent (A)",
  annotateModeOn:
    "Ask-agent mode. Click an element, drag across an area, or click an item's name or a section's title for all of it, then ask for a change or ask a question. Double-click a text to rewrite it. Press Escape to finish.",
  /** The note a text edited in place becomes. Empty `after`: the person deleted the words. */
  textChange: (before: string, after: string) =>
    after ? `Change the text from “${before}” to “${after}”` : `Remove the text “${before}”`,
  /** A note on a whole section, as its card names it. */
  sectionRef: (title: string) => `Section “${title}”`,
  /** A section note's reference when sent: the items in it now, in reading order, and its notes. */
  sectionContents: (title: string, items: string[], notes: string[]) =>
    `Section “${title}”, ${items.length ? `with these items in reading order: ${items.join(", ")}` : "with no items"}${
      notes.length ? `; notes in it: ${notes.map((note) => `“${note}”`).join(", ")}` : ""
    }`,
  sectionItem: (name: string, id: string) => `${name} (id ${id})`,
  /** An area drawn over a preview, in px from the item's top-left, and what is entirely inside it. */
  areaRef: (w: number, h: number, x: number, y: number, names: string[], more: number) =>
    `area ${w}×${h} at ${x},${y}${names.length ? `: ${names.join(", ")}${more ? ` and ${more} more` : ""}` : ""}`,
  annotateModeOff: "Ask-agent mode off",
  annotationPlaceholder: "Ask for a change, or ask why",
  // The tool is "Ask agent", and the canvas has its own sticky notes, so nothing the person
  // reads calls these an annotation or a note: a name says what it is for, and where one
  // thing must be named it is the pin, which is what they see.
  annotationField: (ref: string) => `Ask agent about ${ref}`,
  annotationPin: (n: number, text: string) => `For the agent, ${n}: ${text}`,
  sentPin: (text: string) => `Sent to the agent: ${text}`,
  queuedPin: (text: string) => `Queued for the agent: ${text}`,
  sentNote: "Sent. Clears when this item changes; edit it to send again.",
  sentNoteVersion: "Sent. Clears when its new version appears; edit it to send again.",
  sentNoteSection: "Sent. Clears when the agent adds or removes an item; edit it to send again.",
  queuedNote: "Queued. The agent gets it when it's free; edit it to take it back.",
  newVersion: "Apply to a new version",
  /** The note a planned card's Build button sends for its item. The skill tells the agent what it means. */
  buildPlanned: "Build this planned direction",
  // In a note: one button, and one word on it. It sends everything that waits, so it
  // says how many when that is more than this note. Enter keeps the note and closes it.
  sendShort: (n: number) => (n > 1 ? `Send ${n}` : "Send"),
  sendHint: "⌘/Ctrl + Enter. Enter keeps it for later",
  // Without a listening agent: the note keeps itself, and the bar at the top copies everything.
  doneNote: "Done",
  doneHint: "Enter. ⌘/Ctrl + Enter copies all for the agent",
  replyPlaceholder: "Reply to the agent",
  threadLabel: "Conversation with the agent",
  threadYou: "You",
  // In the message the agent reads.
  threadEarlier: "Earlier on this note:",
  threadPerson: "Person",
  threadAgentYou: "Agent (you)",
  threadNow: "Now",
  deleteAnnotation: "Delete",
  // The toolbar button says what it does for the person: the canvas is source files, so nothing shows up until the agent applies it.
  // No noun after the number: what waits can be a request, a question, a note, a section, or a move.
  copyAnnotations: (n: number) => `Copy ${n} for agent`,
  copiedAnnotations: (n: number) => `Copied ${n} for the agent`,
  /** Shown in place of the copy button while an agent listens to the canvas. */
  sendAnnotations: (n: number) => `Send ${n} to agent`,
  sentToAgent: (n: number) => `Sent ${n} to the agent`,
  queuedForAgent: (n: number) => `Queued ${n}. The agent gets ${n === 1 ? "it" : "them"} when it's free.`,
  agentGoneCopied: (n: number) => `The agent stopped listening. Copied ${n} instead.`,
  /** The name on a reply, whichever agent it is. */
  agentName: "Agent",
  /** Beside a pin whose note the agent answered: the first words of the answer. */
  replyPreview: (text: string) => `Agent: ${text}`,
  repliedPin: (text: string, reply: string) => `The agent replied to: ${text}. ${reply}`,
  agentReplied: (n: number) => (n === 1 ? "The agent replied" : `The agent replied on ${n} pins`),
  /** A reply to a note that is gone from the canvas, so it is not lost. */
  agentReplyLoose: (text: string) => `Agent: ${text}`,
  showReply: "Show",
  /** On each item, section, and change the agent is handling, in place of its "Sent" tag. */
  agentWorking: "Agent working",
  /** On an item the agent added, until the person has seen it; the view no longer moves to it. */
  freshNew: "New",
  /** On an item the agent changed after a note, until the person has seen it. */
  freshUpdated: "Updated",
  share: "Share as an HTML file",
  sharing: "Preparing the file…",
  shared: (file: string) => `Downloaded ${file}`,
  /** The first two files the shared file could not hold, and how many more. */
  sharedMissing: (missing: string[]) =>
    `Missing from the file: ${missing.slice(0, 2).join(", ")}${missing.length > 2 ? ` and ${missing.length - 2} more` : ""}`,
  /** The share panel, before the download. */
  shareTitle: "Share as a file",
  shareScope: "Share",
  shareWhole: "Whole canvas",
  shareCount: (n: number) => `${n} ${n === 1 ? "item" : "items"}`,
  shareHint: "Opens in any browser. Drag it into Figma or Notion to embed it.",
  shareDownload: "Download",
  shareFailed: (reason: string) => `Couldn't make the file: ${reason}`,
  agentFinished: "The agent finished",
  agentGoneQueued: (n: number) => `The agent stopped listening, so ${n} ${n === 1 ? "wasn't" : "weren't"} sent`,
  /** Shown when annotate mode ends with something still waiting, so it is not forgotten. */
  unapplied: (n: number) => `${n} ${n === 1 ? "isn't" : "aren't"} sent yet`,
  applyNow: "Send now",
  copyNow: "Copy now",
  // Everything not sent yet.
  discardChanges: "Discard all",
  discardShort: "Discard",
  discardedChanges: (n: number) => `Discarded ${n}`,
  clearedSent: (n: number) => `Cleared ${n} sent pin${n === 1 ? "" : "s"} on updated items`,
  clearedVersioned: (n: number) => `Cleared ${n} sent pin${n === 1 ? "" : "s"}: new version added`,
  undo: "Undo",
  // In the message the agent reads, where the skill and older canvases know this word.
  annotationsHeading: (n: number) => `Annotations from the design canvas (${n}):`,
  /** The message's last line when some items should get a new version, e.g. "Card (1, 2); Menu (3)". */
  newVersionLine: (items: string) => `Keep the original and add a new version: ${items}`,
  // Notes and sections: marks the person adds, applied by the agent.
  noteTool: "Note",
  noteToolHint: "Note (N): click empty canvas",
  sectionTool: "Section",
  sectionToolHint: "Section (S): drag across empty canvas",
  notePlaceholder: "Write a note",
  sectionPlaceholder: "Section title",
  boardNotApplied: "Not applied yet",
  boardSaving: "Saving…",
  undone: "Undone",
  nothingToUndo: "Nothing to undo",
  undoFailed: "Couldn't undo. The dev server writes registry.tsx, so it must be running.",
  captionHint: "Double-click to edit the caption",
  captionLabel: "Caption",
  captionNotSaved: "Couldn't save the caption. The dev server writes registry.tsx, so it must be running.",
  saveNeedsServer: "Auto-save can't reach the dev server, so changes wait for the agent. Restart this canvas's dev server.",
  saveCouldntPlace: (names: string) =>
    `Couldn't save ${names} to registry.tsx. If its entry is generated by code (a computed id or number), the agent should write it out by hand. Until then the change waits for the agent.`,
  registryGenerated: (names: string) =>
    `${names} can't be saved when moved or resized: its entry in registry.tsx is generated by code. Ask the agent to write each entry out by hand (plain id, x, y, width, height).`,
  updateAvailable: (latest: number) => `Version ${latest} of this canvas is out`,
  updateAsk: "Ask the agent to update",
  updateRequest: (folder: string, current: number, latest: number) =>
    `Update the design-canvas skill to its newest version (${latest}; this canvas has ${current}), then run its scripts/update.sh on this canvas folder: ${folder}. Check that the canvas still opens, and tell me what changed in one line.`,
  updateSent: "Sent to the agent",
  updateCopied: "Copied the update request. Paste it to the agent.",
  deletedMany: (n: number) => `Removed ${n} from the canvas`,
  imageLabel: "Reference image",
  imageNotSaved: "Couldn't add the image. The dev server writes it into the canvas folder, so it must be running.",
  imageUnreadable: "Couldn't read that image. Try a PNG or a JPEG.",
  noteDeleted: "Note deleted",
  sectionDeleted: "Section deleted",
  noteRestored: "Note put back",
  sectionRestored: "Section put back",
  deleteFailed: "Couldn't delete it. The dev server writes registry.tsx, so it must be running.",
  restoreFailed: "Couldn't put it back. Add it again in registry.tsx.",
  boardSent: "Sent · waiting for the agent",
  boardQueued: "Queued · waiting for the agent",
  boardEditHint: "Double-click to edit",
  boardResize: "Resize",
  boardMoveLabel: (what: string) => `Move ${what}`,
  // The default tool: clicks reach the prototypes, as in the product. Named for that, not for
  // selecting, which it does only for notes and sections. V, as in design tools.
  interactTool: "Interact",
  interactToolHint: "Interact (V)",
  handTool: "Move canvas",
  handToolHint: "Move canvas (H)",
  inspectTool: "Inspect",
  inspectToolHint: "Inspect (I)",
  inspectPanel: "Inspect",
  inspectResize: "Panel width",
  inspectPath: "Where it sits",
  inspectEmpty: "Select an element in a preview",
  inspectPartOf: (system: string) => `${system} · inner part`,
  inspectDefaults: "Default props",
  inspectStyles: "Styles",
  inspectNoStyles: "No styles of its own",
  inspectAlso: (others: string[]) => `Same value: ${others.join(", ")}`,
  inspectNearest: (system: string, nearest: string[]) => `Not in ${system}. Nearest: ${nearest.join(" or ")}`,
  inspectNotToken: (system: string) => `Not in ${system}`,
  inspectUnset: "Not set",
  inspectDefaultMark: "default",
  inspectSearch: "Search",
  inspectNoMatch: "No match",
  inspectOn: "On",
  inspectOff: "Off",
  inspectNone: "None",
  inspectReset: "Undo this change",
  inspectResetProps: "Reset props",
  inspectResetStyles: "Reset styles",
  inspectResetTo: (value: string) => `Reset to ${value}`,
  inspectNearestMark: "nearest",
  inspectResetDone: (n: number) => `Reset ${n} change${n === 1 ? "" : "s"}`,
  inspectOwnStyles: (component: string) => `${component} sets these. Change them with its props, or unlock them to try an override.`,
  inspectOverriding: (component: string) => `Changes here override ${component}'s own look.`,
  inspectUnlock: "Unlock to override",
  inspectLock: "Lock",
  inspectOverrideMark: (component: string) => ` (overrides ${component})`,
  inspectOverrideScope: (system: string) =>
    `Lines marked “overrides” change a component's own look, outside its props: apply them to this instance only, and leave ${system} itself as it is.`,
  /** The note for the agent that changes from the Inspect panel become. */
  inspectStyleLine: (what: string, from: string, to: string) => `${what}: ${from} → ${to}`,
  inspectPropLine: (component: string, name: string, from: string, to: string) => `${component} ${name}: ${from} → ${to}`,
  inspectScope: (system: string) =>
    `Use these ${system} tokens and props as named. Change only this element. If the change would also change other places, ask before making it.`,
  // One name for the button on every pending change: a note, a section, a moved item.
  discardChange: "Discard this change",
  boardNoteLabel: "Note",
  boardSectionLabel: (title: string) => `Section ${title}`,
  movesHeading: (n: number) => `Items moved on the design canvas (${n}):`,
  moveItem: (name: string, id: string, where: string) => `Move “${name}” (id ${id}) to ${where}`,
  movesHowTo: "Set each item's `x` and `y` in registry.tsx to the position shown, so the shared file keeps this arrangement.",
  boardHeading: (n: number) => `Notes and sections from the design canvas (${n}):`,
  boardAddNote: (where: string, dims: string, text: string) => `Add a note at ${where}${dims ? `, ${dims}` : ""}: ${text}`,
  boardAddSection: (title: string, where: string, dims: string, items: string[]) =>
    `Add a section ${title} at ${where}${dims ? `, size ${dims}` : ""}${items.length ? `. Inside it, at their positions on the canvas now: ${items.join("; ")}` : ""}`,
  /** A change to a note or section already in the registry; `parts` say what changed. */
  boardChange: (kind: string, id: string, parts: string[]) => `Change ${kind} “${id}”: ${parts.join("; ")}`,
  boardPartText: (kind: string, text: string) => `${kind === "note" ? "text" : "title"} to ${text}`,
  boardPartMove: (where: string) => `move to ${where}`,
  boardPartSize: (dims: string) => `resize to ${dims}`,
  boardPartItems: (items: string[]) => `items and notes inside, at their positions on the canvas now: ${items.join("; ")}`,
  boardHowTo:
    "Write notes into `notes` and sections into `sections` in registry.tsx. For a change, edit that entry: `x`, `y`, `width`, `height` (a note's height is its minimum), `text` or `title`. For each item or note listed inside a section, set its x and y in the registry to the position shown, so the shared file keeps this arrangement.",
};
