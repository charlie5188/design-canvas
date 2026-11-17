import type React from "react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PROPS_PATH } from "./channel.ts";
import {
  choices,
  designProps,
  type DesignSystem,
  pathOf,
  placedComponent,
  PROBE,
  type Row,
  styleRows,
  type Value,
} from "./inspect-read";
import { Icon } from "./icons";
import { labels } from "./labels";
import type { PropType } from "./props-types.ts";

/** A change made in the panel. Canvas.tsx shows it on the element and turns it into a note for the agent. */
/** `RESET` as a value puts back what the code had, before any change from the panel. */
export const RESET = "\u0000reset";
export type InspectEdit =
  | {
      kind: "style";
      /** The CSS property it sets (`padding-inline`), or "typography". */
      property: string;
      /** The row and side, as the note names them: "Padding ↔". */
      what: string;
      from: string;
      to: string;
      /** A token's custom property name, or "" for 0 or none. */
      value: string;
      /** The design-system component whose own look this changes, when it is unlocked (an override). */
      override?: string;
    }
  | { kind: "prop"; component: string; name: string; from: string; to: string; value: unknown; fiber: unknown };

/** What has changed on the selected element, to mark those controls. */
export type InspectChanged = { styles: ReadonlySet<string>; props: ReadonlySet<string> };

/**
 * The Inspect panel (prototype), docked at the right while the Inspect tool is on.
 * From the top: where the element sits (a breadcrumb that selects any level), the
 * design-system component the app placed, then the element's styles as tokens.
 *
 * What can be changed follows who owns it. A design-system component is changed through
 * its props, with the values its types list; its own styles are the system's and stay
 * read-only. What the app built itself is changed through tokens only, never free values.
 * A value outside the design system is marked, with the nearest token.
 */
export function InspectPanel({
  system,
  selection,
  stop,
  changed,
  onSelect,
  onEdit,
  onPreview,
  onHighlight,
  onResetAll,
}: {
  system: DesignSystem;
  selection: { element: Element; preview: Element } | null;
  /** The item's own component: where the search for the placed component stops. */
  stop: unknown;
  changed: InspectChanged;
  onSelect: (element: Element) => void;
  onEdit: (edit: InspectEdit) => void;
  /** Shows a value on the element while the pointer is over it in a picker; `null` puts back what was there. */
  onPreview: (edit: InspectEdit | null) => void;
  /** Outlines an element on the canvas while its breadcrumb level is hovered or focused; `null` takes it away. */
  onHighlight: (element: Element | null) => void;
  /** Puts back every waiting change on the selected element. */
  onResetAll: () => void;
}) {
  // A hot update, a change shown on the element, or the agent's change re-renders the preview: read it again then.
  // Not while a picker is open: a value on show for a moment could change the rows under the pointer
  // (padding ↕ and ↔ that come out equal become one row), so the panel reads again once it closes.
  const [version, setVersion] = useState(0);
  const [holding, setHolding] = useState(false);
  // A design-system component's own styles: folded and locked by default, since they are the system's.
  // Unlocked, they can be changed to try an override (for a proposal), and the note says it is one.
  // Both stay as set while the tool is on, so working on one component does not mean unlocking each time.
  const [stylesOpen, setStylesOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const holdingRef = useRef(false);
  holdingRef.current = holding;
  useEffect(() => {
    if (!holding) setVersion((n) => n + 1);
  }, [holding]);
  useEffect(() => {
    if (!selection) return;
    let timer = 0;
    const observer = new MutationObserver((records) => {
      if (holdingRef.current) return;
      // The panel's own probes (inspect-read.ts) change nothing in the app.
      const ours = (node: Node) => node instanceof Element && !!node.closest(`[${PROBE}]`);
      if (records.every((r) => ours(r.target) || [...r.addedNodes, ...r.removedNodes].every(ours))) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setVersion((n) => n + 1), 120);
    });
    observer.observe(selection.preview, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ["class", "style"] });
    // The click that selects leaves the pointer on the element, so the first read can show its hover
    // colors. Read again once the pointer leaves and the element's transitions settle.
    const again = () => !holdingRef.current && setVersion((n) => n + 1);
    const { element } = selection;
    element.addEventListener("pointerleave", again);
    element.addEventListener("transitionend", again);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      element.removeEventListener("pointerleave", again);
      element.removeEventListener("transitionend", again);
    };
  }, [selection]);

  const read = useMemo(() => {
    if (!selection || !selection.element.isConnected) return null;
    const { element, preview } = selection;
    const placed = placedComponent(element, system, stop);
    return {
      element,
      path: pathOf(element, preview, system, stop),
      placed,
      // Inside a component, not its outer box: its own parts are the component's business.
      part: !!placed && placed.root !== element,
      rows: styleRows(element, preview, system, !placed || unlocked),
      size: element instanceof HTMLElement ? `${element.offsetWidth} × ${element.offsetHeight}` : "",
    };
    // `version` re-reads the same element after its preview changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, system, stop, version, unlocked]);

  const types = usePropTypes(system, read?.placed?.name);
  const [width, startResize, resizeKey] = usePanelWidth();

  return (
    <aside className="canvas-inspect" aria-label={labels.inspectPanel}>
      {/* The left edge resizes the panel, as a docked panel in a design tool does. */}
      <div
        className="canvas-inspect-edge"
        role="separator"
        aria-orientation="vertical"
        aria-label={labels.inspectResize}
        aria-valuenow={width}
        aria-valuemin={PANEL_MIN}
        aria-valuemax={PANEL_MAX}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeKey}
      />
      {/* The panel scrolls inside, so the edge above stays the panel's full height. */}
      <div className="canvas-inspect-body">
      {!read ? (
        <p className="canvas-inspect-empty">{labels.inspectEmpty}</p>
      ) : (
        <>
          <nav className="canvas-inspect-path" aria-label={labels.inspectPath}>
            {read.path.map((entry, index) => (
              <span key={index} className="canvas-inspect-crumb">
                {index > 0 && <span aria-hidden="true">›</span>}
                <button
                  type="button"
                  aria-current={entry.element === read.element ? "true" : undefined}
                  onClick={() => onSelect(entry.element)}
                  // Which area a level is, before choosing it.
                  onPointerEnter={() => onHighlight(entry.element)}
                  onPointerLeave={() => onHighlight(null)}
                  onFocus={() => onHighlight(entry.element)}
                  onBlur={() => onHighlight(null)}
                >
                  {entry.name}
                </button>
              </span>
            ))}
          </nav>
          {/* Only while the element has changes waiting: how many, and one button for all of them. */}
          {changed.styles.size + changed.props.size > 0 && (
            <div className="canvas-inspect-changes">
              <span>{labels.inspectChangeCount(changed.styles.size + changed.props.size)}</span>
              <button type="button" className="canvas-inspect-reset-all" onClick={onResetAll}>
                {labels.inspectResetAll}
              </button>
            </div>
          )}
          {read.placed && (
            <section className="canvas-inspect-section">
              <h3>
                {read.placed.name}
                <span className="canvas-subtle">{read.part ? labels.inspectPartOf(system.name) : system.name}</span>
              </h3>
              <Props
                placed={read.placed}
                types={types}
                changed={changed.props}
                onEdit={onEdit}
                onPreview={onPreview}
                onHold={setHolding}
              />
            </section>
          )}
          {read.placed ? (
            <section className="canvas-inspect-section">
              <h3>
                <button
                  type="button"
                  className="canvas-inspect-fold"
                  aria-expanded={stylesOpen || changed.styles.size > 0}
                  onClick={() => setStylesOpen((open) => !open)}
                >
                  <Icon name="chevron-right" />
                  {labels.inspectStyles}
                </button>
                {read.size && <span className="canvas-subtle">{read.size}</span>}
                <button
                  type="button"
                  className="canvas-inspect-lock"
                  aria-pressed={unlocked}
                  aria-label={unlocked ? labels.inspectLock : labels.inspectUnlock}
                  data-tip={unlocked ? labels.inspectLock : labels.inspectUnlock}
                  onClick={() => {
                    setUnlocked((was) => !was);
                    setStylesOpen(true);
                  }}
                >
                  <Icon name={unlocked ? "lock-open-2" : "lock"} />
                </button>
              </h3>
              {/* Open by itself when an override is on show, so a change is never hidden. */}
              {(stylesOpen || changed.styles.size > 0) && (
                <>
                  {read.rows.length ? (
                    <dl className="canvas-inspect-rows">
                      {read.rows.map((row) => (
                        <StyleRow
                          key={row.label}
                          row={row}
                          system={system}
                          element={read.element}
                          editable={unlocked}
                          // The component's own values need not be tokens: nothing is marked.
                          flag={false}
                          override={read.placed!.name}
                          changed={changed.styles}
                          onEdit={onEdit}
                          onPreview={onPreview}
                          onHold={setHolding}
                        />
                      ))}
                    </dl>
                  ) : (
                    <p className="canvas-subtle">{labels.inspectNoStyles}</p>
                  )}
                  <p className="canvas-subtle canvas-inspect-hint">
                    {unlocked ? labels.inspectOverriding(read.placed.name) : labels.inspectOwnStyles(read.placed.name)}
                  </p>
                </>
              )}
            </section>
          ) : (
            <section className="canvas-inspect-section">
              <h3>
                {labels.inspectStyles}
                {read.size && <span className="canvas-subtle">{read.size}</span>}
              </h3>
              {read.rows.length ? (
                <dl className="canvas-inspect-rows">
                  {read.rows.map((row) => (
                    <StyleRow
                      key={row.label}
                      row={row}
                      system={system}
                      element={read.element}
                      editable
                      flag
                      changed={changed.styles}
                      onEdit={onEdit}
                      onPreview={onPreview}
                      onHold={setHolding}
                    />
                  ))}
                </dl>
              ) : (
                <p className="canvas-subtle">{labels.inspectNoStyles}</p>
              )}
            </section>
          )}
        </>
      )}
      </div>
    </aside>
  );
}

const PANEL_MIN = 240;
const PANEL_MAX = 560;
const PANEL_WIDTH_KEY = "design-canvas:inspect-width";
/**
 * The panel's width: dragged at its left edge or set with the arrow keys there, kept for
 * the next time in this browser. It sits on the page root as a custom property, so the
 * view controls can stay clear of the panel (canvas.css), and goes when the panel does.
 */
function usePanelWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
      return saved >= PANEL_MIN && saved <= PANEL_MAX ? saved : 272;
    } catch {
      return 272;
    }
  });
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--canvas-inspect-width", `${width}px`);
    root.setAttribute("data-canvas-inspecting", "");
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(width));
    } catch {
      // Storage off: the width lasts until the page closes.
    }
  }, [width]);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty("--canvas-inspect-width");
      document.documentElement.removeAttribute("data-canvas-inspecting");
    },
    [],
  );
  const clamp = (value: number) => Math.round(Math.max(PANEL_MIN, Math.min(PANEL_MAX, value, window.innerWidth - 120)));
  const start = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const edge = event.currentTarget;
    edge.setPointerCapture(event.pointerId);
    const from = event.clientX;
    const was = width;
    const move = (e: PointerEvent) => setWidth(clamp(was + from - e.clientX));
    const end = () => {
      edge.removeEventListener("pointermove", move);
      edge.removeEventListener("pointerup", end);
      edge.removeEventListener("pointercancel", end);
    };
    edge.addEventListener("pointermove", move);
    edge.addEventListener("pointerup", end);
    edge.addEventListener("pointercancel", end);
  };
  const key = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 64 : 16;
    const next = { ArrowLeft: width + step, ArrowRight: width - step, Home: PANEL_MAX, End: PANEL_MIN }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    setWidth(clamp(next));
  };
  return [width, start, key] as const;
}

// One request per component for the canvas's life: the types do not change while it runs.
const typeRequests = new Map<string, Promise<PropType[] | null>>();
function usePropTypes(system: DesignSystem, component: string | undefined) {
  const [types, setTypes] = useState<Record<string, PropType[] | null>>({});
  useEffect(() => {
    if (!component || !system.package || component in types) return;
    const key = `${system.package}:${component}`;
    let request = typeRequests.get(key);
    if (!request) {
      const query = new URLSearchParams({ package: system.package, component: component.split(".")[0]! });
      request = fetch(`${PROPS_PATH}?${query}`)
        .then((response) => (response.ok ? response.json() : { props: null }))
        .then((body: { props: PropType[] | null }) => body.props)
        .catch(() => null);
      typeRequests.set(key, request);
    }
    let live = true;
    void request.then((props) => live && setTypes((was) => ({ ...was, [component]: props })));
    return () => {
      live = false;
    };
  }, [component, system.package, types]);
  return component ? types[component] : undefined;
}

// Props that are not design: what the component renders as, and plumbing. Shown nowhere.
const PLUMBING = /^(as|asChild|nativeButton|inputRef|type)$/;

/**
 * The component's props. With its types: every design prop, set or not, as a picker of the
 * values it allows (its default marked). Without them: the props the code set, read-only.
 */
function Props({
  placed,
  types,
  changed,
  onEdit,
  onPreview,
  onHold,
}: {
  placed: NonNullable<ReturnType<typeof placedComponent>>;
  types: PropType[] | null | undefined;
  changed: ReadonlySet<string>;
  onEdit: (edit: InspectEdit) => void;
  onPreview: (edit: InspectEdit | null) => void;
  onHold: (open: boolean) => void;
}) {
  const set = placed.props;
  const editable = (types ?? []).filter((p) => !PLUMBING.test(p.name) && (p.options.length > 0 || p.boolean));
  if (!editable.length) {
    const shown = designProps(set);
    return shown.length ? (
      <dl className="canvas-inspect-rows">
        {shown.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>
              <span className="canvas-inspect-value">{String(value)}</span>
            </dd>
          </div>
        ))}
      </dl>
    ) : (
      <p className="canvas-subtle">{labels.inspectDefaults}</p>
    );
  }
  const edit = (prop: PropType, value: unknown, preview = false) => {
    const current = set[prop.name] ?? prop.default;
    (preview ? onPreview : onEdit)({
      kind: "prop",
      component: placed.name,
      name: prop.name,
      from: current === undefined ? labels.inspectUnset : String(current),
      to: String(value),
      value,
      fiber: placed.fiber,
    });
  };
  return (
    <dl className="canvas-inspect-rows">
      {editable.map((prop) => {
        const own = set[prop.name];
        const current = own ?? (prop.boolean ? prop.default === "true" : prop.default);
        return (
          <div key={prop.name}>
            <dt>{prop.name}</dt>
            <dd>
              {prop.options.length ? (
                <Picker
                  label={prop.name}
                  current={current === undefined ? labels.inspectUnset : String(current)}
                  selected={current === undefined ? undefined : String(current)}
                  changed={changed.has(prop.name)}
                  options={prop.options.map((option) => ({ value: option, label: option, detail: option === prop.default ? labels.inspectDefaultMark : undefined }))}
                  onPreview={(value) => (value === null ? onPreview(null) : edit(prop, value, true))}
                  onChoose={(value) => edit(prop, value)}
                  onOpen={onHold}
                />
              ) : (
                <label className="canvas-inspect-switch" data-changed={changed.has(prop.name) ? "" : undefined}>
                  <input type="checkbox" checked={!!current} onChange={(event) => edit(prop, event.currentTarget.checked)} />
                  {current ? labels.inspectOn : labels.inspectOff}
                </label>
              )}
              {changed.has(prop.name) && <Reset onClick={() => edit(prop, RESET)} />}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * One style. Editable: a picker per value, of the tokens of its kind only. A value outside
 * the system shows as itself until a token replaces it. Read-only: chips.
 */
function StyleRow({
  row,
  system,
  element,
  editable,
  flag,
  override,
  changed,
  onEdit,
  onPreview,
  onHold,
}: {
  row: Row;
  system: DesignSystem;
  element: Element;
  editable: boolean;
  /** Whether a value outside the system is marked: not for a component's own values. */
  flag: boolean;
  /** The component whose own look a change here overrides. */
  override?: string;
  changed: ReadonlySet<string>;
  onEdit: (edit: InspectEdit) => void;
  onPreview: (edit: InspectEdit | null) => void;
  onHold: (open: boolean) => void;
}) {
  // One line under the row for its values outside the system: what it is not, and what it is closest to.
  const off = flag ? row.values.filter((value) => value.kind === "off") : [];
  const nearest = off.flatMap((value) => (value.kind === "off" ? value.nearest : []));
  const options = useMemo(() => (editable ? choices(element, system, row.category) : []), [editable, element, system, row.category]);
  const lengths = row.category === "space" || row.category === "radius";
  const paints = row.category === "text" || row.category === "fill" || row.category === "border";
  const none = lengths ? "0" : labels.inspectNone;
  // A pick as a change: 0 and none are values too, since without the inline style the stylesheet's would show again.
  const styleEdit = (value: Value, chosen: string): InspectEdit => ({
    kind: "style",
    property: value.property,
    what: [row.label, value.side].filter(Boolean).join(" "),
    from: value.kind === "token" ? value.token : value.kind === "off" ? value.value : none,
    to: chosen === RESET ? "" : chosen ? (options.find((o) => o.value === chosen)?.label ?? chosen) : none,
    value: chosen === RESET ? RESET : chosen || (lengths ? "0" : "transparent"),
    ...(override ? { override } : {}),
  });
  return (
    <div>
      <dt>{row.label}</dt>
      <dd>
        {row.values.map((value, index) =>
          editable ? (
            <span key={index} className="canvas-inspect-pick">
              {value.side && <span className="canvas-subtle">{value.side}</span>}
              <Picker
                label={[row.label, value.side].filter(Boolean).join(" ")}
                current={value.kind === "token" ? value.token : value.kind === "off" ? value.value : none}
                swatch={paints ? (value.kind === "token" ? options.find((o) => o.value === value.name)?.swatch : value.kind === "off" ? value.value : undefined) : undefined}
                selected={value.kind === "token" ? value.name : value.kind === "off" ? "current" : ""}
                off={flag && value.kind === "off"}
                changed={changed.has(value.property)}
                options={[
                  ...(value.kind === "off" ? [{ value: "current", label: value.value, detail: labels.inspectNotToken(system.name), swatch: paints ? value.value : undefined }] : []),
                  ...(row.category !== "typography" ? [{ value: "", label: none }] : []),
                  ...options,
                ]}
                onPreview={(chosen) => {
                  // The value outside the system is what the element shows without a preview.
                  if (chosen === null || chosen === "current") return onPreview(null);
                  onPreview(styleEdit(value, chosen));
                }}
                onChoose={(chosen) => onEdit(chosen === "current" ? styleEdit(value, RESET) : styleEdit(value, chosen))}
                onOpen={onHold}
              />
              {changed.has(value.property) && (
                <Reset onClick={() => onEdit({ kind: "style", property: value.property, what: "", from: "", to: "", value: RESET })} />
              )}
            </span>
          ) : (
            <ValueChip key={index} value={value} />
          ),
        )}
        {off.length > 0 && (
          <span className="canvas-inspect-off">
            {nearest.length
              ? labels.inspectNearest(system.name, nearest.map((n) => `${n.token} (${n.value})`))
              : labels.inspectNotToken(system.name)}
          </span>
        )}
      </dd>
    </div>
  );
}

/** A token by its name, its value on hover. */
function ValueChip({ value }: { value: Value }) {
  const side = value.side && <span className="canvas-subtle">{value.side} </span>;
  if (value.kind === "none") return <span className="canvas-inspect-value canvas-subtle">{side}0</span>;
  if (value.kind === "token") {
    const title = [value.value, value.others.length ? labels.inspectAlso(value.others) : ""].filter(Boolean).join("\n");
    return (
      <span className="canvas-inspect-value" title={title}>
        {side}
        {breakable(value.token)}
        {value.others.length > 0 && <span className="canvas-subtle"> +{value.others.length}</span>}
      </span>
    );
  }
  return (
    <span className="canvas-inspect-value">
      {side}
      {value.value}
    </span>
  );
}

/** Puts back what the code had. */
function Reset({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="canvas-inspect-reset" aria-label={labels.inspectReset} data-tip={labels.inspectReset} onClick={onClick}>
      ↺
    </button>
  );
}

/** `short`: the name shown in the list, when it differs from `label`, which is what the note says. */
type PickerOption = { value: string; label: string; short?: string; detail?: string; swatch?: string };

/**
 * A value picker that shows each option on the element before it is picked, which a native
 * select cannot: its options give the page no hover. Pointer over an option, or Arrow Up and
 * Down, shows it; leaving the list, Escape, or a press outside puts back what was there; a
 * click or Enter picks it. A long list (the colors) gets a search field.
 */
function Picker({
  label,
  current,
  swatch,
  selected,
  options,
  off,
  changed,
  onPreview,
  onChoose,
  onOpen,
}: {
  label: string;
  current: ReactNode;
  swatch?: string;
  selected: string | undefined;
  options: PickerOption[];
  off?: boolean;
  changed?: boolean;
  onPreview: (value: string | null) => void;
  onChoose: (value: string) => void;
  onOpen: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<{ left: number; width: number; top?: number; bottom?: number; height: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const searchable = options.length > 12;
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return words ? options.filter((o) => o.label.toLowerCase().includes(words)) : options;
  }, [options, query]);
  const id = useMemo(() => `canvas-pick-${Math.random().toString(36).slice(2, 8)}`, []);

  const close = (focus = true) => {
    onPreview(null);
    setOpen(false);
    setQuery("");
    onOpen(false);
    if (focus) trigger.current?.focus({ preventScroll: true });
  };
  const choose = (value: string) => {
    setOpen(false);
    setQuery("");
    onOpen(false);
    onChoose(value);
    trigger.current?.focus({ preventScroll: true });
  };
  // Only a key moves the list to the option: scrolling under a still pointer would put it over the next one.
  const byKey = useRef(false);
  const show = (index: number, key = false) => {
    byKey.current = key;
    setActive(index);
    const option = shown[index];
    if (option) onPreview(option.value);
  };

  // Below the trigger, or above it when the room is below is short; never past the window's edge.
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const box = trigger.current.getBoundingClientRect();
    const width = Math.max(box.width, 260);
    const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
    const below = window.innerHeight - box.bottom - 12;
    const above = box.top - 12;
    const height = Math.min(320, Math.max(below, above));
    setPlace(below >= Math.min(240, above) ? { left, width, top: box.bottom + 4, height } : { left, width, bottom: window.innerHeight - box.top + 4, height });
    const at = options.findIndex((o) => o.value === selected);
    setActive(at);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // The search field, or else the list, takes the keys once it opens.
  useEffect(() => {
    if (!open || !place) return;
    (popover.current?.querySelector<HTMLElement>("input") ?? list.current)?.focus({ preventScroll: true });
  }, [open, place]);
  useEffect(() => {
    if (byKey.current) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && (popover.current?.contains(event.target) || trigger.current?.contains(event.target))) return;
      close(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="canvas-inspect-select"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-off={off ? "" : undefined}
        data-changed={changed ? "" : undefined}
        onClick={() => {
          if (open) return close();
          setOpen(true);
          onOpen(true);
        }}
        onKeyDown={(event) => {
          if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
          event.preventDefault();
          setOpen(true);
          onOpen(true);
        }}
      >
        {swatch && <span className="canvas-inspect-swatch" style={{ background: swatch }} aria-hidden="true" />}
        <span className="canvas-inspect-select-text">{typeof current === "string" ? breakable(current) : current}</span>
        <span className="canvas-inspect-caret" aria-hidden="true">▾</span>
      </button>
      {open && place && (
        <div
          ref={popover}
          className="canvas-inspect-popover"
          style={{ left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.height }}
          onKeyDown={(event) => {
            // The canvas's keys (Escape lets go of the element, arrows pan) stay out while the list has them.
            event.stopPropagation();
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              show(Math.max(0, Math.min(shown.length - 1, (active < 0 ? (step > 0 ? -1 : shown.length) : active) + step)), true);
            } else if (event.key === "Enter") {
              event.preventDefault();
              const option = shown[active];
              if (option) choose(option.value);
            } else if (event.key === "Escape" || event.key === "Tab") {
              if (event.key === "Escape") event.preventDefault();
              close();
            }
          }}
        >
          {searchable && (
            <input
              className="canvas-inspect-search"
              type="search"
              placeholder={labels.inspectSearch}
              aria-label={labels.inspectSearch}
              aria-controls={id}
              aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setActive(-1);
                onPreview(null);
              }}
            />
          )}
          <ul
            ref={list}
            id={id}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
            onPointerLeave={() => {
              setActive(-1);
              onPreview(null);
            }}
          >
            {shown.map((option, index) => (
              <li
                key={option.value}
                id={`${id}-${index}`}
                data-index={index}
                role="option"
                aria-selected={option.value === selected}
                data-active={index === active ? "" : undefined}
                onPointerEnter={() => show(index)}
                onClick={() => choose(option.value)}
              >
                {option.swatch !== undefined && <span className="canvas-inspect-swatch" style={{ background: option.swatch }} aria-hidden="true" />}
                <span className="canvas-inspect-option-text">{breakable(option.short ?? option.label)}</span>
                {option.detail && <span className="canvas-subtle">{option.detail}</span>}
              </li>
            ))}
            {!shown.length && <li className="canvas-subtle">{labels.inspectNoMatch}</li>}
          </ul>
        </div>
      )}
    </>
  );
}

/** A token name that wraps only after its dots (`color.foreground.` / `inverse`), never inside a word. */
const breakable = (name: string) => name.replace(/\./g, ".\u200b");
