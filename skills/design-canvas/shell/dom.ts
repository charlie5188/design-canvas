// DOM helpers shared by the canvas page and item frames.

export const isEditable = (element: Element | null) =>
  !!element &&
  (element.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']") !== null ||
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

/** Canvas chrome: the item titles, toolbar, and notices. Never previews. */
export const CHROME = ".canvas-item-head, .canvas-toolbar, .canvas-toast";

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
