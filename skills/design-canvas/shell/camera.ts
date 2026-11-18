// The camera: where the canvas is and how far in. How it gets on the page, how it glides,
// and when the layout is written to this browser. (Where to move it to, such as fit all or
// reveal an item, is the board's: that needs the items' places.)
import { useCallback, useLayoutEffect, useRef } from "react";
import { type Camera, sanitizeCamera } from "./layout";

export const DEFAULT_CAMERA: Camera = { x: 48, y: 120, z: 1 };
const SAVE_DELAY = 400;
const SAVE_MAX_WAIT = 2000;

type CameraBoard = {
  /** The camera this browser saved, if it has one. */
  initial: Camera | undefined;
  worldRef: { readonly current: HTMLElement | null };
  /** The box that outlines the element being chosen. It is in screen space, so a camera move hides it. */
  pickRef: { readonly current: HTMLElement | null };
  zoomLabelRef: { readonly current: HTMLElement | null };
  viewportRef: { readonly current: HTMLElement | null };
  /** Writes the layout to this browser with the camera given. What is in the layout is the board's. */
  writeLayout: (camera: Camera) => void;
};

/**
 * `frame` and `saveTimer` are given out as they are: the board's event handlers stop a
 * pending paint, and write a queued save at once, when the page is left.
 */
export function useCamera({ initial, worldRef, pickRef, zoomLabelRef, viewportRef, writeLayout }: CameraBoard) {
  const camera = useRef<Camera>(initial ?? DEFAULT_CAMERA);
  const frame = useRef(0);
  // Puts the camera on the page: the world's place and size, and the zoom label.
  const paint = useCallback(() => {
    const { x, y, z } = camera.current;
    // Each frame of a pan or zoom touches the page as little as it can. Adding or
    // removing any node (setting textContent does both) makes the browser re-check
    // `:has()` rules up the whole tree, and an item's or the app's CSS often has some:
    // on a canvas of plain items that meant restyling every element on every frame
    // (~35 ms). So nothing is written that did not change, and the zoom label edits
    // its text node in place instead of replacing it.
    if (worldRef.current) {
      worldRef.current.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
      // Annotation pins counter-scale with this, so they keep one size on screen.
      const unzoom = String(1 / z);
      if (worldRef.current.style.getPropertyValue("--canvas-unzoom") !== unzoom) worldRef.current.style.setProperty("--canvas-unzoom", unzoom);
    }
    // The outline is drawn in screen space; after the camera moves it would
    // point at the wrong place, so it waits for the next pointer move.
    if (pickRef.current && !pickRef.current.hidden) pickRef.current.hidden = true;
    const label = zoomLabelRef.current?.firstChild;
    const zoomText = `${Math.round(z * 100)}%`;
    if (label instanceof Text) {
      if (label.data !== zoomText) label.data = zoomText;
    } else if (zoomLabelRef.current) zoomLabelRef.current.textContent = zoomText;
  }, []);
  const render = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      paint();
    });
  }, [paint]);
  // The saved camera is on the page before the first paint. Left to render(), it came a
  // frame or two after the items: on every reload the canvas showed at the default view
  // and then jumped to the saved one, for longer on a slow machine or a large canvas.
  useLayoutEffect(paint, [paint]);

  // Items glide to a place the canvas moved them to by itself (a pick sets the others
  // aside; Undo brings things back), so the person sees where each one went. Only for
  // that moment: a drag, a resize, and a hot update set positions too, and must not
  // trail the pointer or animate on load. The motion itself is in canvas.css ("Motion").
  const glideTimer = useRef(0);
  const glide = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.setAttribute("data-glide", "");
    window.clearTimeout(glideTimer.current);
    glideTimer.current = window.setTimeout(() => viewport.removeAttribute("data-glide"), 400);
  }, []);

  const saveTimer = useRef(0);
  const firstQueued = useRef(0);
  const flushSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = 0;
    firstQueued.current = 0;
    writeLayout(camera.current);
  }, [writeLayout]);
  const queueSave = useCallback(() => {
    const now = performance.now();
    if (!firstQueued.current) firstQueued.current = now;
    window.clearTimeout(saveTimer.current);
    const wait = Math.max(0, Math.min(SAVE_DELAY, SAVE_MAX_WAIT - (now - firstQueued.current)));
    saveTimer.current = window.setTimeout(flushSave, wait);
  }, [flushSave]);

  // A glide of the camera in progress (flyTo), as its animation frame; 0 when there is none.
  const flight = useRef(0);
  const setCamera = useCallback(
    (next: Camera) => {
      // Anything else that sets the camera takes over from a glide.
      cancelAnimationFrame(flight.current);
      flight.current = 0;
      camera.current = sanitizeCamera(next);
      render();
      queueSave();
    },
    [render, queueSave],
  );
  // Glides the camera to `to` in about a quarter of a second, so the person sees where the
  // view came from. Used when a link that opens a new tab takes the view to another item: a
  // jump there would leave them not knowing where the first item went. The person is never
  // held by it: a press, a wheel turn, or a key stops the glide where it is, and they go on
  // from there. With reduced motion the camera is set at once.
  const flyTo = useCallback(
    (to: Camera) => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setCamera(to);
      cancelAnimationFrame(flight.current);
      const from = camera.current;
      const start = performance.now();
      const events = ["pointerdown", "wheel", "keydown"] as const;
      const stop = () => {
        cancelAnimationFrame(flight.current);
        flight.current = 0;
        for (const type of events) window.removeEventListener(type, stop, true);
        queueSave();
      };
      for (const type of events) window.addEventListener(type, stop, true);
      const step = (now: number) => {
        const part = Math.min(1, (now - start) / 260);
        const eased = 1 - (1 - part) ** 3;
        camera.current = sanitizeCamera({
          x: from.x + (to.x - from.x) * eased,
          y: from.y + (to.y - from.y) * eased,
          z: from.z + (to.z - from.z) * eased,
        });
        render();
        if (part < 1) flight.current = requestAnimationFrame(step);
        else stop();
      };
      flight.current = requestAnimationFrame(step);
    },
    [queueSave, render, setCamera],
  );
  return { camera, frame, saveTimer, render, glide, flushSave, queueSave, setCamera, flyTo };
}
