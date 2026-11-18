// The Inspect tool on the board: which element is selected, the changes the person makes to it
// in the panel (Inspect.tsx), and the note those changes are written into for the agent.
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Annotation, limitText, newAnnotationId } from "./annotations";
import { shared } from "./bridge";
import { describeElement } from "./dom";
import { type InspectChanged, type InspectEdit, RESET } from "./Inspect";
import { type DesignSystem, pathOf as inspectPath, propsNow, showProp, showStyle } from "./inspect-read";
import { labels } from "./labels";
import type { CanvasItem } from "./types";

/** An element the Inspect panel changed, named for the agent: its path, then its own label when it has one. */
function inspectRef(item: CanvasItem | undefined, element: Element, preview: Element, system?: DesignSystem) {
  const path = system ? inspectPath(element, preview, system, item?.component).map((entry) => entry.name) : [];
  const label = describeElement(element, preview);
  return [item?.name, ...path].filter(Boolean).join(" › ") + (path.length && /^text /.test(label) ? "" : ` (${label})`);
}

/**
 * An element changed from the Inspect panel, under the id of the note it became. The
 * changes are on show on the element (inspect-read.ts showStyle, showProp) until the note
 * goes; `before` and `original` put back what the code had. `block`: the lines it wrote
 * into the note, swapped when they change so the person's own words there stay.
 */
export type InspectRecord = {
  element: Element;
  styles: Map<string, { what: string; from: string; to: string; value: string; before: string; override?: string }>;
  props: Map<string, { component: string; from: string; to: string; value: unknown; had: boolean; original: unknown; fiber: unknown }>;
  block: string;
};

/** What the Inspect tool uses of the board. */
type InspectBoard = {
  /** The project's design system. Without one there is no Inspect tool. */
  designSystem: DesignSystem | undefined;
  annotations: Annotation[];
  annotationsRef: { readonly current: Annotation[] };
  setAnnotations: Dispatch<SetStateAction<Annotation[]>>;
  itemsRef: { readonly current: CanvasItem[] };
  /** The box that outlines the element being chosen. */
  pickRef: { readonly current: HTMLElement | null };
  /** The changes on show, by note id. The board keeps the map: a note that goes, or comes back with Undo, takes its changes with it. */
  inspectRecords: { readonly current: Map<string, InspectRecord> };
  notify: (text: string, action?: { label: string; run: () => void }) => void;
};

// Inspect (prototype): a click in a preview selects an element and the panel at the right reads it
// (Inspect.tsx). As in a browser's element picker, the box marks what is being chosen, not what is
// chosen: the element under the pointer, a breadcrumb level hovered, or a new selection made from
// the keyboard or a double-click. It goes once the pointer works in the panel or a value shows, so it
// never sits on the edges being judged. The breadcrumb names the selection; hovering it shows it again.
export function useInspect({ designSystem, annotations, annotationsRef, setAnnotations, itemsRef, pickRef, inspectRecords, notify }: InspectBoard) {
  const inspectable = !!designSystem && !shared;
  const [inspectTool, setInspectTool] = useState(false);
  const inspectToolRef = useRef(false);
  inspectToolRef.current = inspectTool;
  const [inspected, setInspected] = useState<{ element: Element; preview: Element; itemId: string } | null>(null);
  const inspectedRef = useRef(inspected);
  inspectedRef.current = inspected;
  useEffect(() => {
    if (!inspectTool) setInspected(null);
  }, [inspectTool]);
  useEffect(
    () => () => {
      previewing.current?.();
      previewing.current = null;
    },
    [inspected],
  );
  // What changed on the selected element, to mark those controls; read again after each edit.
  const [inspectEdits, setInspectEdits] = useState(0);
  const inspectChanged = useMemo<InspectChanged>(() => {
    // The changes still waiting: a note already sent is the agent's now, and Reset all leaves it.
    const waiting = (id: string) => annotations.some((a) => a.id === id && !a.sent && !a.queued);
    const record = inspected && [...inspectRecords.current].find(([id, r]) => r.element === inspected.element && waiting(id))?.[1];
    return {
      styles: new Map([...(record?.styles ?? [])].map(([property, style]) => [property, style.from])),
      props: new Map([...(record?.props ?? [])].map(([name, prop]) => [name, prop.from])),
    };
    // `inspectEdits` counts changes to the records, which are a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspected, inspectEdits, annotations]);
  // A breadcrumb level hovered in the panel: outlined with the pick box, as a press would select it.
  const inspectHighlight = useCallback((element: Element | null) => {
    const box = pickRef.current;
    if (!box) return;
    if (!element || !element.isConnected) {
      box.hidden = true;
      return;
    }
    const rect = element.getBoundingClientRect();
    Object.assign(box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    box.hidden = false;
  }, []);
  // A new selection shows where it is: after a click the box is there already; after Arrow Up or
  // Down, a double-click, or a breadcrumb press, nothing else would show it.
  useEffect(() => {
    inspectHighlight(inspected?.element ?? null);
  }, [inspected, inspectHighlight]);
  /**
   * A value shown for a moment, while the pointer is over it in a picker (Inspect.tsx). It
   * changes nothing that is saved: `null`, or the next one, puts back what was there.
   */
  const previewing = useRef<(() => void) | null>(null);
  /**
   * What a prop had before the pointer started on its list. Kept for the whole run of
   * previews, so moving on (secondary, then ghost, then primary) and leaving puts back that
   * value, not one read in the middle of the run, while React may still be a render behind.
   */
  const previewBase = useRef<{ fiber: unknown; name: string; had: boolean; was: unknown } | null>(null);
  const inspectPreview = useCallback(
    (edit: InspectEdit | null) => {
      previewing.current?.();
      previewing.current = null;
      const current = inspectedRef.current;
      if (!edit || !current || !designSystem) {
        previewBase.current = null;
        return;
      }
      if (edit.kind !== "prop") previewBase.current = null;
      // A value on show is judged by its edges: no box over them (also when the keys chose it).
      if (pickRef.current) pickRef.current.hidden = true;
      const { element } = current;
      // "Reset to …" in a picker: what the code had, shown until the pointer moves on.
      if (edit.value === RESET) {
        const record = [...inspectRecords.current.values()].find((r) => r.element === element);
        if (edit.kind === "style") {
          const entry = record?.styles.get(edit.property);
          if (!entry) return;
          const now = showStyle(element, edit.property, entry.before, designSystem);
          previewing.current = () => showStyle(element, edit.property, now, designSystem);
        } else {
          const entry = record?.props.get(edit.name);
          if (!entry) return;
          showProp(entry.fiber, edit.name, entry.had ? entry.original : undefined);
          previewing.current = () => showProp(entry.fiber, edit.name, entry.value);
        }
        return;
      }
      if (edit.kind === "style") {
        const before = showStyle(element, edit.property, edit.value, designSystem);
        previewing.current = () => showStyle(element, edit.property, before, designSystem);
      } else {
        let base = previewBase.current;
        if (!base || base.fiber !== edit.fiber || base.name !== edit.name) {
          const props = propsNow(edit.fiber);
          base = previewBase.current = { fiber: edit.fiber, name: edit.name, had: edit.name in props, was: props[edit.name] };
        }
        const { had, was } = base;
        showProp(edit.fiber, edit.name, edit.value);
        previewing.current = () => showProp(edit.fiber, edit.name, had ? was : undefined);
      }
    },
    [designSystem],
  );
  /**
   * Writes an Inspect record's lines into its note: the lines it wrote before are swapped,
   * the person's own words there stay. A note left with neither goes; a first line makes it.
   */
  const writeInspectNote = useCallback(
    (id: string, record: InspectRecord, current: { element: Element; preview: Element; itemId: string }) => {
      if (!designSystem) return;
      const { element, preview, itemId } = current;
      const lines = [
        ...[...record.styles.values()].map(
          (style) => labels.inspectStyleLine(style.what, style.from, style.to) + (style.override ? labels.inspectOverrideMark(style.override) : ""),
        ),
        ...[...record.props].map(([name, prop]) => labels.inspectPropLine(prop.component, name, prop.from, prop.to)),
      ];
      const overrides = [...record.styles.values()].some((style) => style.override);
      const block = lines.length
        ? [...lines, ...(overrides ? [labels.inspectOverrideScope(designSystem.name)] : []), labels.inspectScope(designSystem.name)].join("\n")
        : "";
      const existing = annotationsRef.current.find((a) => a.id === id);
      const own = existing && record.block ? existing.text.replace(record.block, "").trim() : (existing?.text.trim() ?? "");
      const text = [block, own].filter(Boolean).join("\n");
      record.block = block;
      if (!text) {
        inspectRecords.current.delete(id);
        if (existing) setAnnotations((prev) => prev.filter((a) => a.id !== id));
      } else if (existing) {
        inspectRecords.current.set(id, record);
        setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, text: limitText(text) } : a)));
      } else {
        inspectRecords.current.set(id, record);
        // Pinned at the element's top-left corner, in unscaled preview units, as an annotation is.
        const box = element.getBoundingClientRect();
        const area = preview.getBoundingClientRect();
        const scale = area.width / Math.max(1, (preview as HTMLElement).offsetWidth);
        const item = itemsRef.current.find((entry) => entry.id === itemId);
        // A tweak changes the item in place, unless its other waiting notes already ask for a new version.
        const others = annotationsRef.current.filter((a) => a.itemId === itemId && !a.sent && !a.queued && a.text.trim());
        const annotation: Annotation = {
          id,
          itemId,
          x: Math.round((box.left - area.left) / scale),
          y: Math.round((box.top - area.top) / scale),
          // Where it sits, in component and class names the agent can find in code, and its words when it has some.
          ref: inspectRef(item, element, preview, designSystem),
          text: limitText(text),
          version: others.length ? !!others[others.length - 1]!.version : false,
        };
        setAnnotations((prev) => [...prev, annotation]);
      }
    },
    [designSystem],
  );
  /**
   * Every waiting change in one section of the panel (the component's props, or the styles)
   * on the selected element: each put back to what the code had and its lines taken out of
   * the note. A notice offers Undo, which brings back the changes and the note as they were.
   * A note already sent is the agent's now, and stays.
   */
  const inspectResetAll = useCallback(
    (section: "props" | "styles") => {
      const current = inspectedRef.current;
      if (!current || !designSystem) return;
      const waiting = (id: string) => annotationsRef.current.some((a) => a.id === id && !a.sent && !a.queued);
      const found = [...inspectRecords.current].find(([key, r]) => r.element === current.element && waiting(key));
      if (!found) return;
      const [id, record] = found;
      const count = section === "props" ? record.props.size : record.styles.size;
      if (!count) return;
      previewing.current?.();
      previewing.current = null;
      const before = { styles: new Map(record.styles), props: new Map(record.props), block: record.block };
      const note = annotationsRef.current.find((a) => a.id === id);
      if (section === "styles") {
        for (const [property, style] of record.styles) showStyle(record.element, property, style.before, designSystem);
        record.styles = new Map();
      } else {
        for (const [name, prop] of record.props) showProp(prop.fiber, name, prop.had ? prop.original : undefined);
        record.props = new Map();
      }
      writeInspectNote(id, record, current);
      setInspectEdits((n) => n + 1);
      notify(labels.inspectResetDone(count), {
        label: labels.undo,
        run: () => {
          if (!record.element.isConnected) return;
          for (const [property, style] of before.styles) showStyle(record.element, property, style.value, designSystem);
          for (const [name, prop] of before.props) showProp(prop.fiber, name, prop.value);
          Object.assign(record, before);
          inspectRecords.current.set(id, record);
          if (note) setAnnotations((prev) => [...prev.filter((a) => a.id !== id), note]);
          setInspectEdits((n) => n + 1);
        },
      });
    },
    [designSystem, notify, writeInspectNote],
  );
  const inspectEdit = useCallback(
    (edit: InspectEdit) => {
      // A value on show for a moment goes first, so what the change replaces is what the code had.
      previewing.current?.();
      previewing.current = null;
      const base = previewBase.current;
      previewBase.current = null;
      const current = inspectedRef.current;
      if (!current || !designSystem) return;
      const { element } = current;
      const waiting = (id: string) => annotationsRef.current.some((a) => a.id === id && !a.sent && !a.queued);
      // A note already sent keeps its changes; a further change starts a new note.
      let id = [...inspectRecords.current].find(([key, r]) => r.element === element && waiting(key))?.[0];
      const record: InspectRecord = (id && inspectRecords.current.get(id)) || { element, styles: new Map(), props: new Map(), block: "" };
      id ??= newAnnotationId();
      if (edit.kind === "style") {
        const entry = record.styles.get(edit.property);
        if (edit.value === RESET || (entry && edit.to === entry.from)) {
          if (entry) showStyle(element, edit.property, entry.before, designSystem);
          record.styles.delete(edit.property);
        } else {
          const before = showStyle(element, edit.property, edit.value, designSystem);
          record.styles.set(
            edit.property,
            entry
              ? { ...entry, to: edit.to, value: edit.value }
              : { what: edit.what, from: edit.from, to: edit.to, value: edit.value, before, ...(edit.override ? { override: edit.override } : {}) },
          );
        }
      } else {
        const entry = record.props.get(edit.name);
        if (edit.value === RESET || (entry && edit.to === entry.from)) {
          if (entry) showProp(entry.fiber, edit.name, entry.had ? entry.original : undefined);
          record.props.delete(edit.name);
        } else {
          // what the code had: from before the previews, else as the component is on screen now
          const props = propsNow(edit.fiber);
          const before = base && base.fiber === edit.fiber && base.name === edit.name ? base : { had: edit.name in props, was: props[edit.name] };
          const had = entry ? entry.had : before.had;
          const original = entry ? entry.original : before.was;
          showProp(edit.fiber, edit.name, edit.value);
          record.props.set(edit.name, {
            component: edit.component,
            from: entry?.from ?? edit.from,
            to: edit.to,
            value: edit.value,
            had,
            original,
            fiber: edit.fiber,
          });
        }
      }
      writeInspectNote(id, record, current);
      setInspectEdits((n) => n + 1);
    },
    [designSystem, writeInspectNote],
  );
  return {
    inspectable,
    inspectTool,
    setInspectTool,
    inspectToolRef,
    inspected,
    setInspected,
    inspectedRef,
    inspectChanged,
    inspectHighlight,
    inspectPreview,
    inspectResetAll,
    inspectEdit,
  };
}
