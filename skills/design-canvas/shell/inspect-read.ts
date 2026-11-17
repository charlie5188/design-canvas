// Inspect (prototype, read-only): what a selected element in a preview is made of,
// in the design system's own words. Which of its components the app placed there,
// with the props the app set, and which design tokens the element's styles use.
// A value that is no token is flagged, with the nearest token beside it.
//
// It reads, never writes: the canvas shows the panel (Inspect.tsx) and the agent
// is the only one that changes code. Editing (pick a token or a prop, preview it,
// send it as a change) is the next step and is not built yet.
//
// How it knows:
// - Components: React's dev build records, for every element, the component that
//   rendered it (`_debugOwner`). Walking those owners up to the item's own component,
//   the outermost design-system component on the way is the one the app code placed:
//   a click inside Button's label is about Button, not about FocusRing, which Button
//   renders. Dev builds only; the shared file has no Inspect.
// - Tokens: every public custom property with the design system's prefix found in the
//   page's stylesheets, resolved in the selected element's own context (a scale or
//   color scheme set by an ancestor changes them), then compared with its computed
//   style. Tokens come from the installed package, never from a fixed list.

export type DesignSystem = {
  /** Shown in the panel, such as "Aegis". */
  name: string;
  /** The package's React exports, such as `import * as Aegis from "@legalforce/aegis-react"`. */
  components: Record<string, unknown>;
  /** The prefix of its token custom properties, such as "--aegis-". */
  tokenPrefix: string;
  /** Token names that contain this are private and never shown, such as "-internal-". */
  privateTokens?: string;
  /** The attribute its typography styles key on, such as "data-aegis-typography". */
  typographyAttribute?: string;
  /** The package the components come from, such as "@legalforce/aegis-react": its types list each prop's values. */
  package?: string;
};

type Fiber = {
  tag: number;
  return: Fiber | null;
  alternate: Fiber | null;
  type: unknown;
  elementType: unknown;
  memoizedProps: Record<string, unknown> | null;
  child: Fiber | null;
  sibling: Fiber | null;
  stateNode: unknown;
  _debugOwner?: Fiber | null;
};

const HOST_COMPONENT = 5;

function fiberOf(element: Element): Fiber | null {
  const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
  return key ? ((element as unknown as Record<string, Fiber>)[key] ?? null) : null;
}

const namesCache = new WeakMap<Record<string, unknown>, Map<unknown, string>>();
/** Export value → its name. Compound parts hung on an export (`Card.Header`) count too. */
function componentNames(system: DesignSystem) {
  let names = namesCache.get(system.components);
  if (names) return names;
  names = new Map();
  for (const [name, value] of Object.entries(system.components)) {
    if (!/^[A-Z]/.test(name) || !value || (typeof value !== "function" && typeof value !== "object")) continue;
    if (!names.has(value)) names.set(value, name);
    for (const [part, sub] of Object.entries(value as Record<string, unknown>)) {
      if (/^[A-Z]/.test(part) && sub && (typeof sub === "function" || typeof sub === "object") && !names.has(sub)) {
        names.set(sub, `${name}.${part}`);
      }
    }
  }
  namesCache.set(system.components, names);
  return names;
}

export type Placed = { name: string; props: Record<string, unknown>; root: Element | null; fiber: unknown };

/**
 * The design-system component the app placed that rendered `element`, if any: the
 * outermost one among the element's owners below the item's own component (`stop`).
 */
export function placedComponent(element: Element, system: DesignSystem, stop: unknown): Placed | null {
  const names = componentNames(system);
  let found: Fiber | null = null;
  let owner = fiberOf(element)?._debugOwner ?? null;
  for (let guard = 0; owner && guard < 80; guard++) {
    if (owner.type === stop || owner.elementType === stop) break;
    if (names.has(owner.type) || names.has(owner.elementType)) found = owner;
    owner = owner._debugOwner ?? null;
  }
  if (!found) return null;
  found = current(found);
  const name = names.get(found.type) ?? names.get(found.elementType)!;
  return { name, props: found.memoizedProps ?? {}, root: hostRoot(found), fiber: found };
}

/**
 * React keeps two copies of each component, the one on screen and the one it works on, and
 * an owner link can point at either. The one on screen is found as React itself finds it
 * (findCurrentFiberUsingSlowPath in react-dom): up the tree in step, then the root says.
 */
function current(fiber: Fiber): Fiber {
  const alternate = fiber.alternate;
  if (!alternate) return fiber;
  let a = fiber;
  let b = alternate;
  for (let guard = 0; guard < 10000; guard++) {
    const parentA = a.return;
    if (!parentA) break;
    const parentB = parentA.alternate;
    if (!parentB) {
      if (!parentA.return) break;
      a = b = parentA.return;
      continue;
    }
    if (parentA.child === parentB.child) {
      for (let child = parentA.child; child; child = child.sibling) {
        if (child === a) return fiber;
        if (child === b) return alternate;
      }
      return fiber;
    }
    if (a.return !== b.return) {
      a = parentA;
      b = parentB;
      continue;
    }
    const inA = (child: Fiber | null): Fiber | null => (child && child !== a && child !== b ? inA(child.sibling) : child);
    const foundA = inA(parentA.child);
    if (foundA) [a, b] = foundA === a ? [parentA, parentB] : [parentB, parentA];
    else {
      const foundB = inA(parentB.child);
      if (!foundB) return fiber;
      [a, b] = foundB === a ? [parentB, parentA] : [parentA, parentB];
    }
  }
  const root = a.stateNode as { current?: Fiber } | null;
  return a.tag === 3 && root?.current !== a ? alternate : fiber;
}

/** The first DOM element a component renders: the box it shows as. */
function hostRoot(fiber: Fiber): Element | null {
  for (let node = fiber.child, guard = 0; node && guard < 80; node = node.child, guard++) {
    if (node.tag === HOST_COMPONENT && node.stateNode instanceof Element) return node.stateNode;
  }
  return null;
}

/**
 * What a click on `target` selects: the whole design-system component it is part
 * of, as Figma selects an instance before its layers; anything the app built itself
 * is selected as it is. Arrow Down still reaches a component's own parts.
 */
export function selectable(target: Element, preview: Element, system: DesignSystem, stop: unknown): Element {
  const root = placedComponent(target, system, stop)?.root;
  return root && root !== preview && preview.contains(root) && root.contains(target) ? root : target;
}

/** The element's name in the breadcrumb: its component, or its tag and readable class. */
export function nameOf(element: Element, system: DesignSystem, stop: unknown) {
  const placed = placedComponent(element, system, stop);
  if (placed && placed.root === element) return placed.name;
  const tag = element.tagName.toLowerCase();
  const cls = [...element.classList].map(readableClass).find(Boolean);
  return cls ? `${tag}.${cls}` : tag;
}

// CSS Modules add a hash (`_actions_x7k2p_12` in Vite's dev build); the name a person wrote is inside it.
function readableClass(name: string) {
  const module = /^_?([A-Za-z][\w-]*?)_[A-Za-z0-9]{5}(?:_\d+)?$/.exec(name);
  if (module) return module[1]!;
  // A package's own hashed names, such as `aegis--_VRTG_content`: the last word.
  const hashed = /--_[A-Za-z0-9]+_([A-Za-z][\w-]*)$/.exec(name);
  if (hashed) return hashed[1]!;
  return /^[a-z][\w-]{1,24}$/.test(name) && !/^(css|sc|jsx|emotion)-/.test(name) ? name : "";
}

/** From the element up to the preview: one entry per component, and each plain element. */
export function pathOf(selected: Element, preview: Element, system: DesignSystem, stop: unknown) {
  const path: { element: Element; name: string }[] = [{ element: selected, name: nameOf(selected, system, stop) }];
  for (let at = selected.parentElement, guard = 0; at && at !== preview && preview.contains(at) && guard < 60; guard++) {
    const element = selectable(at, preview, system, stop);
    if (!path.some((entry) => entry.element === element)) path.unshift({ element, name: nameOf(element, system, stop) });
    at = element.parentElement;
  }
  return path;
}

// Props a designer sets. Handlers, children, refs, and DOM plumbing are code, not design.
// Content (placeholder, value) is edited as text, not here.
const HIDDEN_PROPS =
  /^(children|className|style|ref|key|id|as|asChild|nativeButton|tabIndex|role|form|name|htmlFor|placeholder|value|defaultValue|checked|defaultChecked|href|src|alt|title|autoComplete|on[A-Z].*|aria-.*|data-.*)$/;
export function designProps(props: Record<string, unknown>) {
  return Object.entries(props).filter(
    ([name, value]) =>
      !HIDDEN_PROPS.test(name) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean"),
  ) as [string, string | number | boolean][];
}

// --- Tokens -----------------------------------------------------------------------------

/** `rules`: the style rules that use a token, to tell which of several equal tokens the code chose. */
/** Each typography style's font, per place in the page (a scale set by an ancestor changes them). */
const typeFonts = new WeakMap<Element, { key: string; font: Map<string, string> }>();
/** Raw token values already measured: a length in px, a color as computed. */
const measured = { px: new Map<string, number>(), color: new Map<string, string>() };
type TokenSet = { names: string[]; typography: string[]; rules: CSSStyleRule[] };
let tokenCache: { key: string; set: TokenSet } | null = null;

/** Every public token name, and every typography style, the page's stylesheets define. */
function tokens(system: DesignSystem): TokenSet {
  // A stylesheet added or removed (a hot update) can change the set; the count is enough to notice.
  const key = `${system.tokenPrefix}:${document.styleSheets.length}`;
  if (tokenCache?.key === key) return tokenCache.set;
  const names = new Set<string>();
  const typography = new Set<string>();
  const rules: CSSStyleRule[] = [];
  const uses = `var(${system.tokenPrefix}`;
  const attribute = system.typographyAttribute;
  const pattern = attribute ? new RegExp(`\\[${attribute.replace(/[-]/g, "\\-")}=["']?([^"'\\]]+)["']?\\]`, "g") : null;
  const walk = (list: CSSRuleList) => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSStyleRule) {
        for (let i = 0; i < rule.style.length; i++) {
          const name = rule.style[i]!;
          if (name.startsWith(system.tokenPrefix) && !(system.privateTokens && name.includes(system.privateTokens))) names.add(name);
        }
        if (pattern) for (const match of rule.selectorText.matchAll(pattern)) typography.add(match[1]!);
        if (rule.style.cssText.includes(uses)) rules.push(rule);
      }
      if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) walk((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules);
    } catch {
      // A stylesheet from another origin cannot be read; it holds no tokens of this page.
    }
  }
  const set = { names: [...names].sort(), typography: [...typography].sort(), rules };
  tokenCache = { key, set };
  measured.px.clear();
  measured.color.clear();
  return set;
}

/** `--aegis-space-medium` → `space.medium`: the form the design system's code and docs use. */
export const tokenLabel = (name: string, system: DesignSystem) => name.slice(system.tokenPrefix.length).replace(/-/g, ".");

export type Value = (
  /** A token: `name` as written in CSS, `token` as shown. `others`: tokens with the same value. */
  | { kind: "token"; name: string; token: string; others: string[]; value: string }
  /** No token has this value. `nearest`: the closest ones, for lengths. */
  | { kind: "off"; value: string; nearest: { token: string; value: string }[] }
  /** Nothing to show: zero, none, or transparent. */
  | { kind: "none" }
) & {
  /** Which side or axis, when a row has more than one value: "↕", "↔", "Top", and so on. */
  side?: string;
  /** The CSS property a change to this value sets: `padding-inline`, `gap`, or "typography" (the attribute). */
  property: string;
};

/** Which tokens a row's values can be: lengths, radii, the three kinds of color, or typography. */
export type Category = "space" | "radius" | "text" | "fill" | "border" | "typography";
export type Row = { label: string; category: Category; values: Value[] };

/**
 * The element's styles that matter, each as tokens. Read-only (`all` false): only what is
 * set, a row for padding only when there is padding. Editable: the rows a designer may set
 * too (padding, margin, radius, fill), at 0 or none. A text row only for an element with text.
 */
export function styleRows(element: Element, preview: Element, system: DesignSystem, all = false): Row[] {
  const { names, typography, rules } = tokens(system);
  // Which rules match an element is asked again and again (each property, each ancestor, each alias): once per read.
  const matched = new Map<Element, CSSStyleRule[]>();
  const declared = (properties: string[], inherited = false) =>
    declaredTokens(element, properties, rules, system.tokenPrefix, inherited, matched);
  const style = getComputedStyle(element);
  // Probes measure token values as the element would see them: under the app's providers,
  // which set scale and color scheme. Beside the preview, not in it: the panel watches the
  // preview for changes, and its own probes must not count as one (each read would start the
  // next, for as long as an element is selected). Added and removed in one go, so React never sees them.
  const probes = document.createElement("div");
  probes.setAttribute(PROBE, "");
  probes.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;inset:0 auto auto 0;contain:strict;width:0;height:0";
  (preview.parentElement ?? preview).append(probes);
  try {
    const probe = document.createElement("div");
    probes.append(probe);
    // Each needs a style pass on the probe, and a design system has hundreds of colors: a raw
    // value is measured once and remembered (cleared with the token set, on a stylesheet change).
    const px = (raw: string) => {
      if (/^-?[\d.]+px$/.test(raw)) return parseFloat(raw);
      let value = measured.px.get(raw);
      if (value === undefined) {
        probe.style.paddingLeft = raw;
        value = parseFloat(getComputedStyle(probe).paddingLeft);
        probe.style.paddingLeft = "";
        measured.px.set(raw, value);
      }
      return value;
    };
    const color = (raw: string) => {
      let value = measured.color.get(raw);
      if (value === undefined) {
        probe.style.color = "";
        probe.style.color = raw;
        value = probe.style.color ? getComputedStyle(probe).color : "";
        measured.color.set(raw, value);
      }
      return value;
    };
    // Each token's value as the selected element resolves it.
    const resolved = (filter: (name: string) => boolean) =>
      names.filter(filter).map((name) => ({ name, raw: style.getPropertyValue(name).trim() })).filter((t) => t.raw);

    const lengthTokens = (word: string) => resolved((name) => name.includes(word)).map((t) => ({ ...t, px: px(t.raw) }));
    const space = lengthTokens("-space-");
    const radius = lengthTokens("-radius-");
    const colors = resolved((name) => name.includes("-color-")).map((t) => ({ ...t, color: color(t.raw) }));

    // Several tokens can have one value. The one the code names comes first, then the
    // one made for this kind of property, then the plainest name.
    const pick = (same: { name: string }[], used: string[], prefer: string[], shown: string): Value => {
      const score = (name: string) =>
        (used.includes(name) ? 0 : 100) +
        (prefer.some((word) => name.includes(word)) ? 0 : 10) +
        // A resting element rarely uses a state's token, even when the values agree.
        (STATES.test(name) ? 5 : 0) +
        (name.includes("default") ? 0 : 1) +
        name.split("-").length / 100;
      const ordered = same.map((t) => t.name).sort((a, b) => score(a) - score(b));
      return {
        kind: "token",
        name: ordered[0]!,
        token: tokenLabel(ordered[0]!, system),
        others: ordered.slice(1).map((name) => tokenLabel(name, system)),
        value: shown,
        property: "",
      };
    };
    const length = (raw: string, scale: typeof space, property: string, used: string[] = []): Value => {
      const value = parseFloat(raw);
      if (!Number.isFinite(value) || Math.abs(value) < 0.5) return { kind: "none", property };
      const same = scale.filter((t) => Math.abs(t.px - value) < 0.5);
      const shown = `${round(value)}px`;
      if (same.length) return { ...pick(same, used, [], shown), property };
      // Every token at the smallest distance: 14px is as near to 12px as to 16px.
      const distance = Math.min(...scale.map((t) => Math.abs(t.px - value)));
      const nearest = scale.filter((t) => Math.abs(Math.abs(t.px - value) - distance) < 0.5);
      return { kind: "off", value: shown, nearest: nearest.map((t) => ({ token: tokenLabel(t.name, system), value: `${round(t.px)}px` })), property };
    };
    const paint = (raw: string, prefer: string[], used: string[], property: string): Value => {
      const value = color(raw);
      if (!value || /^rgba\(0, 0, 0, 0\)$|^transparent$/.test(value)) return { kind: "none", property };
      const same = colors.filter((t) => t.color === value);
      if (same.length) return { ...pick(same, used, prefer, hex(value)), property };
      return { kind: "off", value: hex(value), nearest: [], property };
    };
    // One value for four equal sides, one per axis for two pairs, else each side (each that is set, read-only).
    const sides = (values: string[], scale: typeof space, base: string, used: string[]): Value[] => {
      const [top, right, bottom, left] = values;
      if (values.every((v) => v === top)) return [length(top!, scale, base, used)];
      if (top === bottom && right === left) {
        return [
          { ...length(top!, scale, `${base}-block`, used), side: "↕" },
          { ...length(right!, scale, `${base}-inline`, used), side: "↔" },
        ];
      }
      return values
        .map((v, i) => ({ ...length(v, scale, `${base}-${SIDES[i]!.toLowerCase()}`, used), side: SIDES[i] }))
        .filter((v) => all || v.kind !== "none");
    };
    const shows = (values: Value[]) => all || values.some((v) => v.kind !== "none");

    const rows: Row[] = [];
    const hasText =
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || textLooksLike(element, style);
    if (hasText) {
      if (typography.length) rows.push({ label: "Type", category: "typography", values: [typeStyle(element, style, typography, probes, system)] });
      rows.push({ label: "Text", category: "text", values: [paint(style.color, ["foreground", "text"], declared(["color"], true), "color")] });
    }
    const fill = paint(style.backgroundColor, ["background", "surface", "fill"], declared(["background-color", "background"]), "background-color");
    if (shows([fill])) rows.push({ label: "Fill", category: "fill", values: [fill] });
    if (["Top", "Right", "Bottom", "Left"].some((side) => parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0)) {
      const used = declared(["border-color", "border", "border-top-color", "border-top"]);
      rows.push({ label: "Border", category: "border", values: [paint(style.borderTopColor, ["border"], used, "border-color")] });
    }
    // A radius is per corner, not per side or axis: one value, or each corner.
    const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius];
    const usedRadius = declared(["border-radius", "border-top-left-radius"]);
    const corners = radii.every((v) => v === radii[0])
      ? [length(radii[0]!, radius, "border-radius", usedRadius)]
      : radii.map((v, i) => ({ ...length(v, radius, `border-${CORNERS[i]!.toLowerCase().replace(" ", "-")}-radius`, usedRadius), side: CORNERS[i] }));
    if (shows(corners)) rows.push({ label: "Radius", category: "radius", values: corners });
    const padding = sides([style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft], space, "padding", declared(PADDING));
    if (shows(padding)) rows.push({ label: "Padding", category: "space", values: padding });
    if (/flex|grid/.test(style.display)) {
      // The gap that applies: between columns in a row, between rows in a column, both in a grid.
      const used = declared(["gap", "row-gap", "column-gap"]);
      const gaps = /grid/.test(style.display)
        ? style.rowGap === style.columnGap
          ? [length(style.columnGap, space, "gap", used)]
          : [
              { ...length(style.rowGap, space, "row-gap", used), side: "↕" },
              { ...length(style.columnGap, space, "column-gap", used), side: "↔" },
            ]
        : [length(style.flexDirection.startsWith("column") ? style.rowGap : style.columnGap, space, "gap", used)];
      if (shows(gaps)) rows.push({ label: "Gap", category: "space", values: gaps });
    }
    const margin = sides([style.marginTop, style.marginRight, style.marginBottom, style.marginLeft], space, "margin", declared(MARGIN));
    if (shows(margin)) rows.push({ label: "Margin", category: "space", values: margin });
    return rows;
  } finally {
    probes.remove();
  }
}

/**
 * The typography style whose font matches the element's: size, weight, and line height.
 * The element's own attribute, or an ancestor's, wins a tie.
 */
function typeStyle(element: Element, style: CSSStyleDeclaration, typography: string[], probes: HTMLElement, system: DesignSystem): Value {
  const attribute = system.typographyAttribute!;
  const font = (s: CSSStyleDeclaration) => `${s.fontSize}/${s.lineHeight}/${s.fontWeight}`;
  const mine = font(style);
  const shown = `${round(parseFloat(style.fontSize))}px · ${style.fontWeight}`;
  // Every style's font in one style pass (all probes in, then read), remembered for this place in the page.
  let fonts = typeFonts.get(probes.parentElement!);
  if (!fonts || fonts.key !== typography.join()) {
    const spans = typography.map((name) => {
      const probe = document.createElement("span");
      probe.setAttribute(attribute, name);
      probe.textContent = "x";
      return probe;
    });
    probes.append(...spans);
    fonts = { key: typography.join(), font: new Map(typography.map((name, i) => [name, font(getComputedStyle(spans[i]!))])) };
    for (const span of spans) span.remove();
    typeFonts.set(probes.parentElement!, fonts);
  }
  const matches = typography.filter((name) => fonts!.font.get(name) === mine);
  if (!matches.length) return { kind: "off", value: shown, nearest: [], property: "typography" };
  const declared = element.closest(`[${attribute}]`)?.getAttribute(attribute);
  const ordered = declared && matches.includes(declared) ? [declared, ...matches.filter((m) => m !== declared)] : matches;
  return { kind: "token", name: ordered[0]!, token: ordered[0]!, others: ordered.slice(1), value: shown, property: "typography" };
}

const round = (value: number) => Math.round(value * 10) / 10;
/** Marks the probes, so a watcher of the preview can tell their changes from the app's. */
export const PROBE = "data-canvas-probe";
const SIDES = ["Top", "Right", "Bottom", "Left"];
const CORNERS = ["Top left", "Top right", "Bottom right", "Bottom left"];
const STATES = /hover|press|active|focus|disabled|selected|visited|checked/;
const PADDING = ["padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "padding-block", "padding-inline", "padding-block-start", "padding-block-end", "padding-inline-start", "padding-inline-end"];
const MARGIN = PADDING.map((name) => name.replace("padding", "margin"));

/**
 * The tokens the element's own declarations of these properties name: its inline
 * style and the rules that match it. For an inherited property (color) the nearest
 * ancestor that declares it. Only to rank tokens of equal value; the computed value
 * decides whether a token applies at all.
 */
function declaredTokens(
  element: Element,
  properties: string[],
  rules: CSSStyleRule[],
  prefix: string,
  inherited: boolean,
  matched: Map<Element, CSSStyleRule[]>,
) {
  const pattern = /var\((--[\w-]+)/g;
  const matching = (at: Element) => {
    let list = matched.get(at);
    if (!list) {
      list = rules.filter((rule) => {
        try {
          return at.matches(rule.selectorText);
        } catch {
          // A selector this browser cannot match, such as a vendor pseudo-class.
          return false;
        }
      });
      matched.set(at, list);
    }
    return list;
  };
  /** What a declaration names. A component's own variable (`--aegis-internal-…`) is followed to the tokens it is set to. */
  const named = (value: string, at: Element, depth: number): string[] =>
    [...value.matchAll(pattern)].flatMap((match) => {
      const name = match[1]!;
      if (!name.startsWith(prefix)) return [];
      if (depth > 3) return [name];
      for (let scope: Element | null = at; scope; scope = scope.parentElement) {
        const own = scope instanceof HTMLElement ? scope.style.getPropertyValue(name) : "";
        const set = own || matching(scope).map((rule) => rule.style.getPropertyValue(name)).filter(Boolean).pop();
        if (set) return [name, ...named(set, scope, depth + 1)];
      }
      return [name];
    });
  for (let at: Element | null = element; at; at = inherited ? at.parentElement : null) {
    const found: string[] = [];
    const values = [
      ...(at instanceof HTMLElement ? [at.style] : []),
      ...matching(at).map((rule) => rule.style),
    ].flatMap((declaration) => properties.map((property) => declaration.getPropertyValue(property)).filter(Boolean));
    for (const value of values) found.push(...named(value, at, 0));
    if (values.length || !inherited) return found;
  }
  return [];
}

/** rgb() as hex, which designers read and type; other color spaces stay as they are. */
function hex(color: string) {
  const match = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(color);
  if (!match) return color;
  const [r, g, b] = [match[1], match[2], match[3]].map((n) => Number(n).toString(16).padStart(2, "0"));
  const alpha = match[4] !== undefined && Number(match[4]) < 1 ? ` ${Math.round(Number(match[4]) * 100)}%` : "";
  return `#${r}${g}${b}${alpha}`.toUpperCase();
}

/**
 * Whether the element's text is styled as the element is: its own text, or text in a part
 * that keeps the same font and color (a component's label inside its box, say).
 */
function textLooksLike(element: Element, style: CSSStyleDeclaration) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  const text = walker.nextNode();
  if (!text?.parentElement) return false;
  if (text.parentElement === element) return true;
  const inner = getComputedStyle(text.parentElement);
  return inner.fontSize === style.fontSize && inner.fontWeight === style.fontWeight && inner.color === style.color;
}

// --- Editing ----------------------------------------------------------------------------

/** `detail`: a length's value. `swatch`: a color as the element resolves it. */
export type Choice = { value: string; label: string; short?: string; detail?: string; swatch?: string };

/**
 * What a row can be set to: the tokens of its kind, as the element resolves them, with
 * their values, smallest first for lengths. A state's color (hovered, pressed) is left out:
 * it belongs to the component that has the state.
 */
export function choices(element: Element, system: DesignSystem, category: Category): Choice[] {
  const { names, typography } = tokens(system);
  if (category === "typography") return typography.map((name) => ({ value: name, label: name }));
  const style = getComputedStyle(element);
  const word = { space: "-space-", radius: "-radius-", text: "-color-foreground-", fill: "-color-background-", border: "-color-border-" }[category];
  const list = names
    .filter((name) => name.includes(word) && !STATES.test(name))
    .map((name) => ({ name, raw: style.getPropertyValue(name).trim() }))
    .filter((t) => t.raw);
  if (category === "space" || category === "radius") {
    return list
      .map((t) => ({ ...t, px: parseFloat(t.raw) * (t.raw.endsWith("rem") ? 16 : 1) }))
      .sort((a, b) => a.px - b.px)
      .map((t) => ({ value: t.name, label: tokenLabel(t.name, system), detail: `${round(t.px)}px` }));
  }
  // In the list, a color goes by what follows its kind (`accent.blue.subtle`): the row already says which kind.
  const kind = tokenLabel(`${system.tokenPrefix}${word.slice(1)}`, system);
  return list.map((t) => {
    const label = tokenLabel(t.name, system);
    return { value: t.name, label, short: label.startsWith(kind) ? label.slice(kind.length) : label, swatch: t.raw };
  });
}

/**
 * Shows a value on the element itself, before the agent writes it: an inline style (a
 * token as `var(...)`, or "" to take it away), or the typography attribute. Returns what
 * was there before, to put back. React leaves inline styles it did not set alone.
 */
export function showStyle(element: Element, property: string, value: string, system: DesignSystem) {
  if (!(element instanceof HTMLElement)) return "";
  if (property === "typography") {
    const attribute = system.typographyAttribute!;
    const before = element.getAttribute(attribute) ?? "";
    if (value) element.setAttribute(attribute, value);
    else element.removeAttribute(attribute);
    return before;
  }
  const before = element.style.getPropertyValue(property);
  if (value) element.style.setProperty(property, value.startsWith("--") ? `var(${value})` : value);
  else element.style.removeProperty(property);
  return before;
}

type Renderer = { overrideProps?: (fiber: unknown, path: string[], value: unknown) => void; overridePropsDeletePath?: (fiber: unknown, path: string[]) => void };
/** React's dev build, as it reported itself to the hook the dev server adds (agent-channel.ts). */
function renderer(): Renderer | undefined {
  const hook = (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: { renderers?: Map<number, Renderer> } }).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  return [...(hook?.renderers?.values() ?? [])].find((r) => typeof r.overrideProps === "function");
}
/** Whether a prop change can be shown before the agent writes it. */
export const canShowProps = () => !!renderer();

/**
 * Shows a prop change on the component, as React DevTools does: the component renders with
 * it until its parent renders again (the agent's change to the code, say). `undefined` takes
 * the prop away, so the component falls back to its default.
 */
export function showProp(fiber: unknown, name: string, value: unknown) {
  const react = renderer();
  if (!react) return false;
  if (value === undefined) react.overridePropsDeletePath?.(fiber, [name]);
  else react.overrideProps?.(fiber, [name], value);
  return true;
}
