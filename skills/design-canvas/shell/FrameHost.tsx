import { useEffect, useLayoutEffect, useRef } from "react";
import { frameParams, frameSource, fromThisCanvas, NAVIGATE_EVENT, postToCanvas, readCanvasMessage } from "./bridge";
import { describeArea, describeElement, isEditable, nestedCanScroll, pickElement, previewLink, wheelPixels } from "./dom";
import { labels } from "./labels";
import { loadTheme } from "./layout";
import type { ThemeStore } from "./theme";
import type { CanvasItem } from "./types";
import "./canvas.css";

/** Z by key position or by letter: Alt changes the letter on a Mac (Ω), and other layouts move the key. */
const zoomKey = (event: KeyboardEvent) => event.code === "KeyZ" || event.key === "z" || event.key === "Z";

/**
 * One canvas item alone, at its real size. The canvas loads it in an iframe
 * for `viewport` items; opened directly (frame.html?item=<id>) it is a clean
 * page for screenshots, Figma capture, or sharing.
 */
export function FrameHost({
  items,
  storageKey,
  theme,
}: {
  items: CanvasItem[];
  /** The canvas storage key, so a frame opens in the canvas's saved theme. */
  storageKey?: string;
  theme?: ThemeStore;
}) {
  const params = frameParams();
  const id = params.get("item") ?? "";
  const context = params.get("in");
  const item = items.find((entry) => entry.id === id);
  // Only a frame inside the canvas hands its gestures to the parent page.
  const inCanvas = context === "canvas" && window.parent !== window;
  const rootRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef<HTMLDivElement>(null);
  const drawRef = useRef<HTMLDivElement>(null);

  // Open in the canvas's saved theme, before the first paint.
  useLayoutEffect(() => {
    if (!theme || !storageKey) return;
    const saved = loadTheme(storageKey, new Set(theme.options.map((option) => option.id)));
    if (saved) theme.set(saved);
  }, [storageKey, theme]);

  // Theme changes on the canvas follow into its frames.
  useEffect(() => {
    if (!inCanvas || !theme) return;
    const onMessage = (event: MessageEvent) => {
      if (!fromThisCanvas(event) || event.source !== window.parent) return;
      const message = readCanvasMessage(event.data);
      if (message?.type === "theme") theme.set(message.id);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [inCanvas, theme]);

  useEffect(() => {
    const root = rootRef.current;
    if (!inCanvas || !root) return;

    // Gestures the canvas owns are handed to the parent page.
    const onWheel = (event: WheelEvent) => {
      const { dx, dy } = wheelPixels(event, window.innerHeight);
      const zoom = event.ctrlKey || event.metaKey;
      if (!zoom && nestedCanScroll(event.target, root, dx, dy)) return;
      event.preventDefault();
      postToCanvas({ type: "wheel", dx, dy, x: event.clientX, y: event.clientY, zoom });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") document.documentElement.setAttribute("data-canvas-alt", "");
      if (event.key === "Alt" && pointer.x >= 0) showPick(document.elementFromPoint(pointer.x, pointer.y));
      // Keys inside a frame never reach the canvas page, so Escape is handed over.
      if (event.key === "Escape" && annotating) postToCanvas({ type: "escape" });
      const active = document.activeElement;
      const typing = !!active && active !== document.body && isEditable(active);
      // Z held is the canvas's zoom, as in Figma, unless a field here takes the letter.
      if (zoomKey(event) && !event.metaKey && !event.ctrlKey && !typing && !event.repeat) {
        postToCanvas({ type: "zoom-key", down: true, out: event.altKey });
      }
      if (event.code !== "Space" || event.repeat || typing) return;
      event.preventDefault();
      postToCanvas({ type: "space", down: true });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") postToCanvas({ type: "space", down: false });
      if (zoomKey(event)) postToCanvas({ type: "zoom-key", down: false, out: false });
      if (event.key === "Alt") document.documentElement.removeAttribute("data-canvas-alt");
      if (event.key === "Alt" && !annotating) hidePick();
    };
    const onBlur = () => {
      postToCanvas({ type: "space", down: false });
      postToCanvas({ type: "zoom-key", down: false, out: false });
      hidePick();
      cancelDraw();
      document.documentElement.removeAttribute("data-canvas-alt");
    };

    // Element references and annotations, same as on the canvas page. The canvas
    // tells each frame when annotate mode turns on or off.
    let annotating = false;
    const pointer = { x: -1, y: -1 };
    const hidePick = () => {
      if (pickRef.current) pickRef.current.hidden = true;
    };
    const showPick = (target: EventTarget | null) => {
      const box = pickRef.current;
      const element = target instanceof Element ? pickElement(target, root) : null;
      if (!box || !element) return hidePick();
      const rect = element.getBoundingClientRect();
      Object.assign(box.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      box.hidden = false;
    };
    // A drag in annotate mode marks an area, as on the canvas page. Frame pixels are item pixels.
    let drawing: { pointerId: number; x: number; y: number; moved: boolean } | null = null;
    // Set for the click that ends a drag, so it does not also annotate one element.
    let clickAfterDraw = false;
    const areaOf = (current: NonNullable<typeof drawing>, clientX: number, clientY: number) => {
      const rect = root.getBoundingClientRect();
      const clampX = (x: number) => Math.min(rect.right, Math.max(rect.left, x));
      const clampY = (y: number) => Math.min(rect.bottom, Math.max(rect.top, y));
      const [x1, x2] = [clampX(current.x), clampX(clientX)].sort((a, b) => a - b);
      const [y1, y2] = [clampY(current.y), clampY(clientY)].sort((a, b) => a - b);
      return { left: x1!, top: y1!, right: x2!, bottom: y2! };
    };
    const cancelDraw = () => {
      drawing = null;
      if (drawRef.current) drawRef.current.hidden = true;
    };
    const onDrawEnd = (event: PointerEvent) => {
      if (!drawing || event.pointerId !== drawing.pointerId) return;
      const current = drawing;
      cancelDraw();
      if (!current.moved || event.type === "pointercancel") return;
      clickAfterDraw = true;
      window.setTimeout(() => {
        clickAfterDraw = false;
      }, 0);
      const area = areaOf(current, event.clientX, event.clientY);
      const rect = root.getBoundingClientRect();
      const x = Math.round(area.left - rect.left);
      const y = Math.round(area.top - rect.top);
      const w = Math.round(area.right - area.left);
      const h = Math.round(area.bottom - area.top);
      if (w < 4 || h < 4) return;
      const { names, more } = describeArea(root, area);
      postToCanvas({ type: "annotate-area", label: labels.areaRef(w, h, x, y, names, more), x, y, w, h });
    };
    const onPickMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      document.documentElement.toggleAttribute("data-canvas-alt", event.altKey);
      if (drawing && event.pointerId === drawing.pointerId) {
        if (!drawing.moved && Math.hypot(event.clientX - drawing.x, event.clientY - drawing.y) <= 3) return;
        if (!drawing.moved) {
          drawing.moved = true;
          hidePick();
          // Keeps the drag when it leaves the frame. Only now: a captured plain
          // click would land on the root, not the element.
          try {
            root.setPointerCapture(event.pointerId);
          } catch {
            // The pointer may already be gone.
          }
        }
        const area = areaOf(drawing, event.clientX, event.clientY);
        const box = drawRef.current;
        if (box) {
          Object.assign(box.style, {
            left: `${area.left}px`,
            top: `${area.top}px`,
            width: `${area.right - area.left}px`,
            height: `${area.bottom - area.top}px`,
          });
          box.hidden = false;
        }
        return;
      }
      if (event.altKey || annotating) showPick(event.target);
      else hidePick();
    };
    const blockPick = (event: MouseEvent) => {
      if ((!event.altKey && !annotating) || !(event.target instanceof Element) || !root.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (annotating && !event.altKey && event.button === 0 && event.type === "pointerdown") {
        const pointerEvent = event as PointerEvent;
        if (pointerEvent.pointerType !== "touch")
          drawing = { pointerId: pointerEvent.pointerId, x: event.clientX, y: event.clientY, moved: false };
      }
    };
    const onPickClick = (event: MouseEvent) => {
      if (clickAfterDraw) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if ((!event.altKey && !annotating) || !(event.target instanceof Element)) return;
      const element = pickElement(event.target, root);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      const label = describeElement(element, root);
      if (event.altKey) postToCanvas({ type: "pick", label });
      else postToCanvas({ type: "annotate", label, x: event.clientX, y: event.clientY });
    };
    const onCanvasMessage = (event: MessageEvent) => {
      if (!fromThisCanvas(event) || event.source !== window.parent) return;
      const message = readCanvasMessage(event.data);
      if (message?.type !== "annotate-mode") return;
      annotating = message.on;
      document.documentElement.toggleAttribute("data-canvas-annotating", annotating);
      if (annotating && pointer.x >= 0) showPick(document.elementFromPoint(pointer.x, pointer.y));
      else hidePick();
    };

    // Navigation never leaves the frame; the canvas reveals or reports it.
    const onLinkClick = (event: MouseEvent) => {
      // A click in annotate mode places an annotation; the pick handler cancels it.
      if (annotating) return;
      const anchor = previewLink(event);
      if (!anchor) return;
      event.preventDefault();
      postToCanvas({ type: "link", href: anchor.getAttribute("href") ?? "" });
    };
    const onSubmit = (event: SubmitEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      postToCanvas({ type: "form" });
    };
    const onNavigate = (event: Event) => {
      const href = (event as CustomEvent<unknown>).detail;
      if (typeof href === "string") postToCanvas({ type: "link", href });
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener(NAVIGATE_EVENT, onNavigate);
    window.addEventListener("click", onLinkClick, { capture: true });
    window.addEventListener("submit", onSubmit);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointermove", onPickMove, { capture: true });
    window.addEventListener("pointerdown", blockPick, { capture: true });
    window.addEventListener("mousedown", blockPick, { capture: true });
    window.addEventListener("click", onPickClick, { capture: true });
    window.addEventListener("pointerup", onDrawEnd, { capture: true });
    window.addEventListener("pointercancel", onDrawEnd, { capture: true });
    // Leaving the frame ends its hover: no outline stays behind on the element last under the pointer.
    document.documentElement.addEventListener("pointerleave", hidePick);
    window.addEventListener("message", onCanvasMessage);
    return () => {
      window.removeEventListener("message", onCanvasMessage);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener(NAVIGATE_EVENT, onNavigate);
      window.removeEventListener("click", onLinkClick, { capture: true });
      window.removeEventListener("submit", onSubmit);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointermove", onPickMove, { capture: true });
      window.removeEventListener("pointerdown", blockPick, { capture: true });
      window.removeEventListener("mousedown", blockPick, { capture: true });
      window.removeEventListener("click", onPickClick, { capture: true });
      window.removeEventListener("pointerup", onDrawEnd, { capture: true });
      window.removeEventListener("pointercancel", onDrawEnd, { capture: true });
      document.documentElement.removeEventListener("pointerleave", hidePick);
    };
  }, [inCanvas]);

  if (!item) return <p className="canvas-frame-missing">{labels.missingItem(id)}</p>;

  // Opened in a tab, a viewport item nests in a frame of its own size, so its
  // breakpoints see the item's width instead of the tab's.
  if (!context && item.viewport) {
    return (
      <div className="canvas-frame-page">
        <iframe
          className="canvas-frame"
          {...frameSource(item.id, "page")}
          title={item.name}
          width={item.width}
          height={item.height}
        />
      </div>
    );
  }

  const Component = item.component;
  const body = (
    <div ref={rootRef} className="canvas-frame-root" style={{ inlineSize: item.width, blockSize: item.height }}>
      <Component />
    </div>
  );
  if (!context) return <div className="canvas-frame-page">{body}</div>;
  return (
    <>
      {body}
      <div ref={pickRef} className="canvas-pick" hidden aria-hidden="true" />
      <div ref={drawRef} className="canvas-draw" hidden aria-hidden="true" />
    </>
  );
}
