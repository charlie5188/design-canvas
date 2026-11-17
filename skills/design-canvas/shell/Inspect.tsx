import { useEffect, useMemo, useState } from "react";
import { PROPS_PATH } from "./channel.ts";
import {
  choices,
  designProps,
  type DesignSystem,
  pathOf,
  placedComponent,
  type Row,
  styleRows,
  type Value,
} from "./inspect-read";
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
}: {
  system: DesignSystem;
  selection: { element: Element; preview: Element } | null;
  /** The item's own component: where the search for the placed component stops. */
  stop: unknown;
  changed: InspectChanged;
  onSelect: (element: Element) => void;
  onEdit: (edit: InspectEdit) => void;
}) {
  // A hot update, a change shown on the element, or the agent's change re-renders the preview: read it again then.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!selection) return;
    let timer = 0;
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setVersion((n) => n + 1), 120);
    });
    observer.observe(selection.preview, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ["class", "style"] });
    // The click that selects leaves the pointer on the element, so the first read can show its hover
    // colors. Read again once the pointer leaves and the element's transitions settle.
    const again = () => setVersion((n) => n + 1);
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
      rows: styleRows(element, preview, system, !placed),
      size: element instanceof HTMLElement ? `${element.offsetWidth} × ${element.offsetHeight}` : "",
    };
    // `version` re-reads the same element after its preview changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, system, stop, version]);

  const types = usePropTypes(system, read?.placed?.name);

  return (
    <aside className="canvas-inspect" aria-label={labels.inspectPanel}>
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
                >
                  {entry.name}
                </button>
              </span>
            ))}
          </nav>
          {read.placed && (
            <section className="canvas-inspect-section">
              <h3>
                {read.placed.name}
                <span className="canvas-subtle">{read.part ? labels.inspectPartOf(system.name) : system.name}</span>
              </h3>
              <Props placed={read.placed} types={types} changed={changed.props} onEdit={onEdit} />
            </section>
          )}
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
                    // A design-system component's own styles are read-only, and not marked (see InspectPanel).
                    editable={!read.placed}
                    changed={changed.styles}
                    onEdit={onEdit}
                  />
                ))}
              </dl>
            ) : (
              <p className="canvas-subtle">{labels.inspectNoStyles}</p>
            )}
            {read.placed && <p className="canvas-subtle canvas-inspect-hint">{labels.inspectOwnStyles(read.placed.name)}</p>}
          </section>
        </>
      )}
    </aside>
  );
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
}: {
  placed: NonNullable<ReturnType<typeof placedComponent>>;
  types: PropType[] | null | undefined;
  changed: ReadonlySet<string>;
  onEdit: (edit: InspectEdit) => void;
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
  const edit = (prop: PropType, value: unknown) => {
    const current = set[prop.name] ?? prop.default;
    onEdit({
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
                <select
                  className="canvas-inspect-select"
                  aria-label={prop.name}
                  data-changed={changed.has(prop.name) ? "" : undefined}
                  value={current === undefined ? "" : String(current)}
                  onChange={(event) => edit(prop, event.currentTarget.value)}
                >
                  {current === undefined && <option value="">{labels.inspectUnset}</option>}
                  {prop.options.map((option) => (
                    <option key={option} value={option}>
                      {option === prop.default ? labels.inspectDefault(option) : option}
                    </option>
                  ))}
                </select>
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
  changed,
  onEdit,
}: {
  row: Row;
  system: DesignSystem;
  element: Element;
  editable: boolean;
  changed: ReadonlySet<string>;
  onEdit: (edit: InspectEdit) => void;
}) {
  // One line under the row for its values outside the system: what it is not, and what it is closest to.
  const off = editable ? row.values.filter((value) => value.kind === "off") : [];
  const nearest = off.flatMap((value) => (value.kind === "off" ? value.nearest : []));
  const options = useMemo(() => (editable ? choices(element, system, row.category) : []), [editable, element, system, row.category]);
  const none = row.category === "space" || row.category === "radius" ? "0" : labels.inspectNone;
  return (
    <div>
      <dt>{row.label}</dt>
      <dd>
        {row.values.map((value, index) =>
          editable ? (
            <span key={index} className="canvas-inspect-pick">
              {value.side && <span className="canvas-subtle">{value.side}</span>}
              <select
                className="canvas-inspect-select"
                aria-label={[row.label, value.side].filter(Boolean).join(" ")}
                data-off={value.kind === "off" ? "" : undefined}
                data-changed={changed.has(value.property) ? "" : undefined}
                value={value.kind === "token" ? value.name : value.kind === "off" ? "current" : ""}
                onChange={(event) => {
                  const chosen = event.currentTarget.value;
                  // The value outside the system again: as if nothing was picked.
                  if (chosen === "current") return onEdit({ kind: "style", property: value.property, what: "", from: "", to: "", value: RESET });
                  onEdit({
                    kind: "style",
                    property: value.property,
                    what: [row.label, value.side].filter(Boolean).join(" "),
                    from: value.kind === "token" ? value.token : value.kind === "off" ? value.value : none,
                    to: chosen ? (options.find((o) => o.value === chosen)?.label.split(" · ")[0] ?? chosen) : none,
                    // 0 and none are values too: without the inline style the stylesheet's would show again.
                    value: chosen || (row.category === "space" || row.category === "radius" ? "0" : "transparent"),
                  });
                }}
              >
                {value.kind === "off" && <option value="current">{value.value}</option>}
                {row.category !== "typography" && <option value="">{none}</option>}
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
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
        {value.token}
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
