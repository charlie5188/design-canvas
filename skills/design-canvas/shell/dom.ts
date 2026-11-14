// DOM helpers shared by the canvas page and item frames.

/** Fields and editable text, which take the keys a canvas shortcut would. */
export const TYPING = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

export const isEditable = (element: Element | null) =>
  !!element &&
  (element.closest(TYPING) !== null ||
    element.closest("button, a[href], [role='button'], [role='tab'], [role='radio'], [tabindex]") !== null);

/** True when a scroll area between the target and `stop` can still scroll this way. */
export function nestedCanScroll(target: EventTarget | null, stop: Element, dx: number, dy: number) {
  let node = target instanceof Element ? target : null;
  while (node && node !== stop) {
    if (node instanceof HTMLElement) {
      const style = getComputedStyle(node);
      const scrollY = /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
      const scrollX = /(auto|scroll|overlay)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
      if (scrollY && dy < 0 && node.scrollTop > 0) return true;
      if (scrollY && dy > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true;
      if (scrollX && dx < 0 && node.scrollLeft > 0) return true;
      if (scrollX && dx > 0 && node.scrollLeft + node.clientWidth < node.scrollWidth - 1) return true;
    }
    node = node.parentElement;
  }
  return false;
}

/** Canvas chrome: the item titles, toolbar, notices, and trash. Never previews. */
export const CHROME = ".canvas-item-head, .canvas-toolbar, .canvas-toast, .canvas-trash-popover";

/** The link a plain click would follow, unless it belongs to the canvas chrome. */
export function previewLink(event: MouseEvent): HTMLAnchorElement | null {
  if (event.button !== 0 || event.altKey || !(event.target instanceof Element)) return null;
  const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
  return anchor && !anchor.closest(CHROME) ? anchor : null;
}

/** Wheel deltas in pixels, whatever unit the browser reported. */
export function wheelPixels(event: WheelEvent, pageHeight: number) {
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1;
  return { dx: event.deltaX * scale, dy: event.deltaY * scale };
}

// Element references: Alt/Option-click copies "Item name › button “Send”" so a
// person can point at one control when talking to the model.

const PICKABLE =
  "button, a[href], input, select, textarea, label, summary, h1, h2, h3, h4, h5, h6, img[alt], [aria-label], [role]:not([role='presentation']):not([role='none'])";
const MAX_NAME = 40;

const hasOwnText = (element: Element) =>
  [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());

/** The element a reference should name: the nearest control, heading, or text. */
export function pickElement(target: Element, root: Element): Element | null {
  if (target === root || !root.contains(target)) return null;
  const meaningful = target.closest(PICKABLE);
  if (meaningful && meaningful !== root && root.contains(meaningful)) return meaningful;
  for (let node: Element | null = target; node && node !== root; node = node.parentElement) {
    if (hasOwnText(node)) return node;
  }
  return target;
}

function roleOf(element: Element) {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "input") {
    const type = (element as HTMLInputElement).type;
    if (type === "checkbox" || type === "radio") return type;
    if (type === "range") return "slider";
    if (type === "button" || type === "submit" || type === "reset") return "button";
    return "textbox";
  }
  const roles: Record<string, string> = {
    a: "link",
    button: "button",
    select: "select",
    textarea: "textbox",
    summary: "button",
    label: "label",
    img: "image",
  };
  return roles[tag] ?? "text";
}

const clean = (text: string | null | undefined) => {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  return value.length > MAX_NAME ? `${value.slice(0, MAX_NAME - 1)}…` : value;
};

function nameOf(element: Element) {
  const label = element.getAttribute("aria-label");
  if (label) return clean(label);
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (clean(text)) return clean(text);
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const fieldLabel = element.labels?.[0]?.textContent;
    if (clean(fieldLabel)) return clean(fieldLabel);
    if ("placeholder" in element && element.placeholder) return clean(element.placeholder);
    return clean(element.name);
  }
  if (element instanceof HTMLImageElement) return clean(element.alt);
  return clean(element.textContent) || clean(element.getAttribute("title"));
}

function describeOne(element: Element) {
  const name = nameOf(element);
  return name ? `${roleOf(element)} “${name}”` : roleOf(element);
}

/** A short, human reference to `element`, numbered when the item has look-alikes. */
export function describeElement(element: Element, root: Element) {
  const text = describeOne(element);
  const twins = [...root.querySelectorAll(element.tagName)].filter((other) => describeOne(other) === text);
  return twins.length > 1 ? `${text} (${twins.indexOf(element) + 1}/${twins.length})` : text;
}

/**
 * What an area drawn over a preview holds, for its reference: the controls,
 * headings, and texts entirely inside `area` (client coordinates), outermost
 * first, at most `limit` of them, and how many more there are.
 */
export function describeArea(root: Element, area: { left: number; top: number; right: number; bottom: number }, limit = 4) {
  const inside = (rect: DOMRect) =>
    rect.width > 0 &&
    rect.height > 0 &&
    rect.left >= area.left - 1 &&
    rect.right <= area.right + 1 &&
    rect.top >= area.top - 1 &&
    rect.bottom <= area.bottom + 1;
  const found: Element[] = [];
  for (const element of root.querySelectorAll("*")) {
    if (found.some((outer) => outer.contains(element))) continue;
    if (!element.matches(PICKABLE) && !hasOwnText(element)) continue;
    if (inside(element.getBoundingClientRect())) found.push(element);
  }
  return { names: found.slice(0, limit).map((element) => describeElement(element, root)), more: Math.max(0, found.length - limit) };
}

// Text edits. In annotate mode a double-click on a text edits its words where
// they sit, so a person sees new copy in place: its line breaks, whether it
// fits. When the edit ends, the element gets back the exact nodes React
// rendered (new or removed nodes would break React's next update of them), and
// the change goes to the agent as an annotation. The new words then stay on
// show in those same nodes, marked as not applied yet (showPending), so several
// rewritten texts can be judged together, until the annotation goes or React
// renders those words itself.

/** The element whose words a double-click edits: the nearest one with text of its own. Never a field. */
export function textTarget(target: Element, root: Element): HTMLElement | null {
  if (target === root || !root.contains(target) || target.closest(TYPING)) return null;
  for (let node: Element | null = target; node && node !== root; node = node.parentElement) {
    if (node instanceof HTMLElement && hasOwnText(node)) return node;
  }
  return null;
}

/** The words as written, not as styled (text-transform), with line breaks kept. */
function wordsOf(element: HTMLElement) {
  const copy = element.cloneNode(true) as HTMLElement;
  for (const br of copy.querySelectorAll("br")) br.replaceWith("\n");
  return (copy.textContent ?? "").replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
}

/** The element's text nodes, in order. */
const textsOf = (element: Element) => {
  const texts: Text[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
  return texts;
};

/**
 * Writes `words` into the text nodes that hold words: all of them in the first,
 * the others emptied, the spaces around them kept. The nodes stay React's, so
 * putting their old data back restores the element exactly.
 */
function writeWords(texts: Text[], words: string) {
  const shown = texts.filter((text) => text.data.trim());
  shown.forEach((text, i) => {
    const lead = text.data.match(/^\s*/)?.[0] ?? "";
    const trail = text.data.match(/\s*$/)?.[0] ?? "";
    const last = i === shown.length - 1;
    text.data = i === 0 ? lead + words + (last ? trail : "") : last ? trail : "";
  });
}

// Marks on an element whose new words are on show: the annotation they belong
// to, the markup React rendered (so a fingerprint of the item ignores the
// preview), and whether the words break lines (shown with white-space, since
// the element's own <br> no longer matches them). All attributes, so they work
// the same in item frames.
const PENDING = "data-canvas-pending";
const ORIGINAL = "data-canvas-original";
const LINES = "data-canvas-lines";
const pendings = new Map<string, { element: HTMLElement; words: string; end: () => void }>();

/**
 * Shows `words` in place of the element's own, marked as waiting for the agent,
 * for annotation `id`. It gives way on its own once React writes those nodes
 * (usually the agent's change arriving), and clearPending ends it.
 */
export function showPending(id: string, element: HTMLElement, words: string) {
  clearPending(id);
  const texts = textsOf(element);
  const before = new Map(texts.map((text) => [text, text.data] as const));
  element.setAttribute(ORIGINAL, element.innerHTML);
  writeWords(texts, words);
  element.setAttribute(PENDING, id);
  element.toggleAttribute(LINES, words.includes("\n"));
  const end = (touched: ReadonlySet<Node>) => {
    observer.disconnect();
    // What React rewrote stays; the rest gets its words back.
    for (const [text, data] of before) if (!touched.has(text) && text.isConnected && text.data !== data) text.data = data;
    for (const name of [PENDING, ORIGINAL, LINES]) element.removeAttribute(name);
    pendings.delete(id);
  };
  const observer = new MutationObserver((records) => end(new Set(records.map((record) => record.target))));
  observer.observe(element, { characterData: true, childList: true, subtree: true });
  pendings.set(id, { element, words, end: () => end(new Set()) });
}

export function clearPending(id: string) {
  pendings.get(id)?.end();
}

/** The annotation and the words on show, when the element holds new words. */
export function pendingOf(element: Element) {
  const id = element.getAttribute(PENDING);
  const pending = id ? pendings.get(id) : undefined;
  return id && pending ? { id, words: pending.words } : null;
}

/** The markup React rendered under `root`: any words on show put back. For telling whether an item changed. */
export function renderedHtml(root: Element) {
  if (!root.querySelector(`[${PENDING}]`)) return root.innerHTML;
  const copy = root.cloneNode(true) as Element;
  // One at a time: putting an element's markup back can bring back an inner one's marks.
  for (let element = copy.querySelector(`[${PENDING}]`); element; element = copy.querySelector(`[${PENDING}]`)) {
    element.innerHTML = element.getAttribute(ORIGINAL) ?? element.innerHTML;
    for (const name of [PENDING, ORIGINAL, LINES]) element.removeAttribute(name);
  }
  return copy.innerHTML;
}

export type TextEdit = {
  element: HTMLElement;
  /** Ends the edit: `keep` reports the new words, otherwise it is cancelled. */
  finish: (keep: boolean) => void;
};

// Typing and IME events stay with the edit: the preview's own handlers and the
// canvas shortcuts never see them.
const KEPT = ["keyup", "keypress", "beforeinput", "input", "compositionstart", "compositionupdate", "compositionend", "paste", "cut"];

/**
 * Makes `element`'s words editable in place, selected. Enter or leaving the
 * text keeps the edit, Escape cancels it; Shift + Enter breaks the line. `done`
 * gets the words React rendered and the words kept, or `null` when cancelled.
 * `initial`: words to start from instead of the rendered ones, such as new
 * words still on show (the caller clears that preview first).
 */
export function editText(
  element: HTMLElement,
  done: (before: string, after: string | null) => void,
  initial?: string,
): TextEdit {
  const doc = element.ownerDocument;
  const children = new Map<Node, Node[]>();
  const texts = new Map<Text, string>();
  const keep = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) texts.set(node as Text, (node as Text).data);
    else if (node.nodeType === Node.ELEMENT_NODE) {
      children.set(node, [...node.childNodes]);
      node.childNodes.forEach(keep);
    }
  };
  keep(element);
  const before = wordsOf(element);
  const attributes = ["contenteditable", "spellcheck"].map((name) => [name, element.getAttribute(name)] as const);

  element.setAttribute("contenteditable", "plaintext-only");
  const plain = element.contentEditable === "plaintext-only";
  if (!plain) element.setAttribute("contenteditable", "true");
  element.setAttribute("spellcheck", "false");
  element.setAttribute("data-canvas-editing", "");
  if (initial !== undefined) {
    writeWords([...texts.keys()], initial);
    element.toggleAttribute(LINES, initial.includes("\n"));
  }
  element.focus({ preventScroll: true });
  // Selects the words only, not a field or an image among them, so typing replaces just the words.
  const words = [...texts.keys()].filter((text) => text.data.trim());
  const first = words[0];
  const last = words[words.length - 1];
  const selection = doc.getSelection();
  if (selection && first && last) {
    const range = doc.createRange();
    range.setStart(first, first.data.search(/\S/));
    range.setEnd(last, last.data.trimEnd().length);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  let ended = false;
  const stop = (event: Event) => event.stopPropagation();
  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    // Enter that confirms an IME composition only confirms it.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  };
  // Without plaintext-only (older browsers), a paste would bring its styles along.
  const onPaste = (event: ClipboardEvent) => {
    if (plain) return;
    event.preventDefault();
    doc.execCommand("insertText", false, event.clipboardData?.getData("text/plain") ?? "");
  };
  const onBlur = () => finish(true);
  element.addEventListener("keydown", onKeyDown);
  element.addEventListener("paste", onPaste);
  element.addEventListener("blur", onBlur);
  for (const type of KEPT) element.addEventListener(type, stop);

  const finish = (kept: boolean) => {
    if (ended) return;
    ended = true;
    const after = wordsOf(element);
    element.removeEventListener("keydown", onKeyDown);
    element.removeEventListener("paste", onPaste);
    element.removeEventListener("blur", onBlur);
    for (const type of KEPT) element.removeEventListener(type, stop);
    for (const [node, kids] of children) {
      const now = node.childNodes;
      if (now.length !== kids.length || kids.some((kid, i) => now[i] !== kid)) (node as Element).replaceChildren(...kids);
    }
    for (const [text, data] of texts) if (text.data !== data) text.data = data;
    for (const [name, value] of attributes) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
    element.removeAttribute("data-canvas-editing");
    element.removeAttribute(LINES);
    if (selection && element.contains(selection.anchorNode)) selection.removeAllRanges();
    if (doc.activeElement === element) element.blur();
    done(before, kept ? after : null);
  };
  return { element, finish };
}
