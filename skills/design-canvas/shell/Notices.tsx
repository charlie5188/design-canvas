// What the canvas tells the person: the notice at the top of the canvas, the same words for a
// screen reader, and the two checks the canvas makes when it opens.
import { useCallback, useEffect, useRef, useState } from "react";
import { sendToAgent } from "./agent";
import { shared } from "./bridge";
import { EDIT_PATH, VERSION_PATH } from "./channel.ts";
import { labels } from "./labels";
import type { CanvasItem } from "./types";

const TOAST_MS = 2500;
const TOAST_ACTION_MS = 8000;

export type Toast = { kind: "copied" | "failed" | "notice"; text: string; action?: { label: string; run: () => void } };

export async function writeClipboard(text: string) {
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
  await navigator.clipboard.writeText(text);
}

/**
 * The one notice the canvas shows at a time, and the live region that says it aloud.
 * `setToast` and `toastTimer` are given out as they are: the board hides the notice when
 * the trash or the share panel opens in the same corner, and shows the copy fallback itself.
 */
export function useNotices() {
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef(0);
  const liveRef = useRef<HTMLDivElement>(null);
  const announce = useCallback((text: string) => {
    if (!liveRef.current) return;
    liveRef.current.textContent = "";
    requestAnimationFrame(() => {
      if (liveRef.current) liveRef.current.textContent = text;
    });
  }, []);

  const copyReference = useCallback(
    async (text: string) => {
      window.clearTimeout(toastTimer.current);
      try {
        await writeClipboard(text);
        setToast({ kind: "copied", text });
        announce(labels.copiedText(text));
        toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
      } catch {
        setToast({ kind: "failed", text });
      }
    },
    [announce],
  );
  const notify = useCallback(
    (text: string, action?: Toast["action"], long = false) => {
      window.clearTimeout(toastTimer.current);
      setToast({ kind: "notice", text, action });
      announce(text);
      // A notice with an action, or a long one, stays long enough to read and reach.
      toastTimer.current = window.setTimeout(() => setToast(null), action || long ? TOAST_ACTION_MS : TOAST_MS);
    },
    [announce],
  );
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  return { toast, setToast, toastTimer, liveRef, announce, copyReference, notify };
}

/** The two checks made once, when the canvas opens: items the registry cannot place, and a newer version of the skill. */
export function useOpeningChecks(items: CanvasItem[], notify: (text: string, action?: Toast["action"], long?: boolean) => void) {
  // Warns once, when the canvas opens, about items a move or resize could not be saved for,
  // instead of letting the first drag fail. Silent when the server is missing or too old to answer.
  const warnedGenerated = useRef(false);
  useEffect(() => {
    if (shared || warnedGenerated.current || !items.length) return;
    warnedGenerated.current = true;
    fetch(`${EDIT_PATH}/check`)
      .then((response) => (response.ok ? (response.json() as Promise<{ placeable?: unknown }>) : undefined))
      .then((result) => {
        if (!result || !Array.isArray(result.placeable)) return;
        const ok = new Set(result.placeable);
        const bad = items.filter((item) => !ok.has(item.id)).map((item) => item.id);
        if (bad.length) notify(labels.registryGenerated(bad.slice(0, 3).join(", ") + (bad.length > 3 ? ` and ${bad.length - 3} more` : "")), undefined, true);
      })
      .catch(() => {});
  }, [shared, items, notify]);
  // A newer version of the skill than this canvas has: one notice per version, with a button that asks the agent
  // to update (the agent knows whether the skill is a git checkout or an npx copy). With no agent listening,
  // the same request is copied instead. Silent when the server cannot tell, so an old server shows nothing.
  const askedUpdate = useRef(false);
  useEffect(() => {
    if (shared || askedUpdate.current || !items.length) return;
    askedUpdate.current = true;
    fetch(VERSION_PATH)
      .then((response) => (response.ok ? (response.json() as Promise<{ current?: unknown; latest?: unknown; folder?: unknown }>) : undefined))
      .then((v) => {
        if (!v || typeof v.current !== "number" || typeof v.latest !== "number" || typeof v.folder !== "string" || v.latest <= v.current) return;
        const key = `design-canvas:update-notice:${v.latest}`;
        try {
          if (localStorage.getItem(key)) return;
          localStorage.setItem(key, "1");
        } catch {
          // Without storage the notice shows each time the canvas opens.
        }
        const request = labels.updateRequest(v.folder, v.current, v.latest);
        notify(
          labels.updateAvailable(v.latest),
          {
            label: labels.updateAsk,
            run: () => {
              void sendToAgent(request).then(async (result) => {
                if (result.delivered) return notify(labels.updateSent);
                try {
                  await writeClipboard(request);
                  notify(labels.updateCopied);
                } catch {
                  notify(labels.updateCopied, undefined, true);
                }
              });
            },
          },
          true,
        );
      })
      .catch(() => {});
  }, [shared, items, notify]);
}

/** The notice itself: a copied reference, a message with at most one action, or the text to copy by hand when the copy failed. */
export function ToastView({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  return (
    <div className="canvas-toast">
      {toast.kind === "copied" ? (
        <span>{labels.copiedText(toast.text)}</span>
      ) : toast.kind === "notice" ? (
        <>
          <span>{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              className="canvas-button"
              onClick={() => {
                toast.action?.run();
                onClose();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </>
      ) : (
        <>
          <span className="canvas-subtle">{labels.copyFailed}</span>
          {/* A list of annotations keeps its lines; one reference fits a field. */}
          {toast.text.includes("\n") ? (
            <textarea
              readOnly
              rows={4}
              value={toast.text}
              aria-label={labels.copyFailed}
              onFocus={(event) => event.currentTarget.select()}
              // biome-ignore lint/a11y/noAutofocus: the fallback appears only after a copy attempt.
              autoFocus
            />
          ) : (
            <input
              readOnly
              value={toast.text}
              aria-label={labels.copyFailed}
              onFocus={(event) => event.currentTarget.select()}
              // biome-ignore lint/a11y/noAutofocus: the fallback appears only after a copy attempt.
              autoFocus
            />
          )}
          <button type="button" className="canvas-button" onClick={() => onClose()}>
            {labels.dismiss}
          </button>
        </>
      )}
    </div>
  );
}
