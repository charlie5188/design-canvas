import { useEffect, useLayoutEffect, useRef } from "react";
import { frameUrl, NAVIGATE_EVENT, postToCanvas, readCanvasMessage } from "./bridge";
import { describeElement, isEditable, nestedCanScroll, pickElement, previewLink, wheelPixels } from "./dom";
import { labels } from "./labels";
import { loadTheme } from "./layout";
import type { ThemeStore } from "./theme";
import type { CanvasItem } from "./types";
import "./canvas.css";

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
  const params = new URLSearchParams(window.location.search);
  const id = params.get("item") ?? "";
  const context = params.get("in");
  const item = items.find((entry) => entry.id === id);
  // Only a frame inside the canvas hands its gestures to the parent page.
  const inCanvas = context === "canvas" && window.parent !== window;
  const rootRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef<HTMLDivElement>(null);

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
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
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
      if (event.key === "Alt" && pointer.x >= 0) showPick(document.elementFromPoint(pointer.x, pointer.y));
      // Keys inside a frame never reach the canvas page, so Escape is handed over.
      if (event.key === "Escape" && annotating) postToCanvas({ type: "escape" });
      if (event.code !== "Space" || event.repeat) return;
      const active = document.activeElement;
      if (active && active !== document.body && isEditable(active)) return;
      event.preventDefault();
      postToCanvas({ type: "space", down: true });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") postToCanvas({ type: "space", down: false });
      if (event.key === "Alt" && !annotating) hidePick();
    };
    const onBlur = () => {
      postToCanvas({ type: "space", down: false });
      hidePick();
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
    const onPickMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      if (event.altKey || annotating) showPick(event.target);
      else hidePick();
    };
    const blockPick = (event: MouseEvent) => {
      if ((!event.altKey && !annotating) || !(event.target instanceof Element) || !root.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onPickClick = (event: MouseEvent) => {
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
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
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
          src={frameUrl(item.id, "page")}
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
    </>
  );
}
