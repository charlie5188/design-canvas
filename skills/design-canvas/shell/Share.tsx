// Share: the panel says what goes in the file (SharePanel); the dev server builds the canvas
// into one HTML file without the rest, and the browser downloads it.
import { type Ref, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadSharedFile } from "./agent";
import { Icon } from "./icons";
import { labels } from "./labels";
import { ITEM_HEAD, type Position } from "./layout";
import { type CanvasItem, type CanvasNote, type CanvasSection, isSetAside } from "./types";

/** What a share puts in the file: how many items, and the registry ids the file leaves out. */
type ShareContents = { items: number; leaveOut: { items: string[]; notes: string[]; sections: string[] } };

/** What a share reads of the board. `trash` is the ids of the items in the trash, which never go in the file. */
type ShareBoard = {
  items: CanvasItem[];
  notes: CanvasNote[];
  sections: CanvasSection[];
  positions: Record<string, Position>;
  trash: string[];
  notify: (text: string, action?: undefined, long?: boolean) => void;
};

/** The share panel's state, what each choice in it would put in the file, and the download. */
export function useShare({ items, notes, sections, positions, trash, notify }: ShareBoard) {
  const [sharing, setSharing] = useState(false);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // What is inside a frame is what the person sees inside it: by the centre, at the positions
  // they have now, as a section's own notes and moves count it.
  const centres = useMemo(() => {
    const centre = (x: number, y: number, w: number, h: number) => ({ x: x + w / 2, y: y + h / 2 });
    return {
      items: new Map(items.map((item) => {
        const at = positions[item.id] ?? item;
        return [item.id, centre(at.x, at.y, item.width, ITEM_HEAD + item.height)];
      })),
      notes: new Map(notes.map((note) => [note.id, centre(note.x, note.y, note.width ?? 220, note.height ?? 80)])),
      sections: new Map(sections.map((section) => [section.id, centre(section.x, section.y, section.width, section.height)])),
    };
  }, [items, notes, sections, positions]);
  const contents = useCallback(
    (section: string | null): ShareContents => {
      const holds = (frame: CanvasSection, at: { x: number; y: number } | undefined) =>
        !!at && at.x >= frame.x && at.x <= frame.x + frame.width && at.y >= frame.y && at.y <= frame.y + frame.height;
      const scope = section ? sections.find((s) => s.id === section) : undefined;
      const inScope = (at: { x: number; y: number } | undefined) => !scope || holds(scope, at);
      const keptItems = items.filter((item) => !trash.includes(item.id) && inScope(centres.items.get(item.id)));
      const keptNotes = notes.filter((note) => inScope(centres.notes.get(note.id)));
      const keptSections = sections.filter((s) => s === scope || inScope(centres.sections.get(s.id)));
      const out = <T extends { id: string }>(all: T[], keep: T[]) => all.filter((entry) => !keep.includes(entry)).map((entry) => entry.id);
      return {
        items: keptItems.length,
        leaveOut: { items: out(items, keptItems), notes: out(notes, keptNotes), sections: out(sections, keptSections) },
      };
    },
    [items, notes, sections, trash, centres],
  );
  // Each titled section a person may share alone, in reading order. Set-aside frames are not offered:
  // they are the losing side of a decision, and go with the canvas or the section they sit in.
  const scopes = useMemo(
    () =>
      sections
        .filter((section) => section.title.trim() && !isSetAside(section))
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((section) => ({ id: section.id, title: section.title.trim(), items: contents(section.id).items })),
    [sections, contents],
  );
  const share = useCallback(
    async (only: string | null) => {
      setSharing(true);
      try {
        // The file is named for the canvas (and the section shared), not its folder, with the day it was made.
        const now = new Date();
        const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
        const title = document.title.replace(/\s*·\s*canvas\s*$/, "").trim() || "canvas";
        const section = only ? sections.find((s) => s.id === only)?.title.trim() : undefined;
        const name = `${[title, section].filter(Boolean).join(" · ")} ${date}`.replace(/[\\/:*?"<>|]+/g, "-");
        const file = await downloadSharedFile(contents(only).leaveOut, `${name}.html`);
        setOpen(false);
        buttonRef.current?.focus({ preventScroll: true });
        notify(file.missing.length ? `${labels.shared(file.name)}. ${labels.sharedMissing(file.missing)}` : labels.shared(file.name), undefined, file.missing.length > 0);
      } catch (error) {
        const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 160);
        notify(labels.shareFailed(reason), undefined, true);
      } finally {
        setSharing(false);
      }
    },
    [notify, sections, contents],
  );

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  }, []);
  // Like the trash, the share panel closes on a press outside it.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".canvas-share-popover, .canvas-share-button")) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  return { sharing, open, setOpen, buttonRef, scopes, contents, share, close };
}

/** At the top bar's end, with its word: the one control there that is about other people, so
    it reads first. While the file builds, the icon pulses and the button takes no second click. */
export function ShareButton({
  buttonRef,
  busy,
  open,
  onClick,
}: {
  buttonRef: Ref<HTMLButtonElement>;
  busy: boolean;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="canvas-button canvas-share-button"
      aria-busy={busy}
      aria-expanded={open}
      aria-label={busy ? labels.sharing : labels.share}
      data-tip={busy ? labels.sharing : labels.share}
      onClick={onClick}
    >
      <Icon name="share-2" />
      {labels.shareShort}
    </button>
  );
}

/**
 * Before Share downloads the file: what goes in it. A canvas collects many explorations, and the
 * reader often needs one, so a canvas with sections offers the whole canvas or one section; one
 * without sections offers no choice. The download then says so in a notice.
 */
export function SharePanel({
  scopes,
  whole,
  busy,
  onDownload,
  onClose,
}: {
  scopes: { id: string; title: string; items: number }[];
  whole: number;
  busy: boolean;
  /** `section`: the id of the one section to share, or null for the whole canvas. */
  onDownload: (section: string | null) => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState<string | null>(null);
  const downloadRef = useRef<HTMLButtonElement>(null);
  useEffect(() => downloadRef.current?.focus({ preventScroll: true }), []);
  return (
    <div
      className="canvas-share-popover"
      role="dialog"
      aria-label={labels.shareTitle}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="canvas-share-head">
        <span className="canvas-share-title">{labels.shareTitle}</span>
        <button type="button" className="canvas-button canvas-icon-button" aria-label={labels.dismiss} onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      {scopes.length > 0 && (
        <label className="canvas-share-row">
          <span className="canvas-share-label">{labels.shareScope}</span>
          <span className="canvas-share-select">
            <select value={section ?? ""} onChange={(event) => setSection(event.currentTarget.value || null)}>
              <option value="">{`${labels.shareWhole} · ${labels.shareCount(whole)}`}</option>
              {scopes.map((scope) => (
                <option key={scope.id} value={scope.id}>{`${scope.title} · ${labels.shareCount(scope.items)}`}</option>
              ))}
            </select>
            <Icon name="chevron-down" />
          </span>
        </label>
      )}
      <p className="canvas-share-hint">{labels.shareHint}</p>
      <button
        ref={downloadRef}
        type="button"
        className="canvas-button canvas-button-primary canvas-share-download"
        disabled={busy}
        aria-busy={busy}
        onClick={() => onDownload(section)}
      >
        {busy ? labels.sharing : labels.shareDownload}
      </button>
    </div>
  );
}
