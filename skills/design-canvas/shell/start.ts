// Start here. A comparison is often about one moment of a flow: a later screen, a dialog
// open, a form half filled. Every item opens at its first screen, so side by side the
// versions hide the very part that differs, and each Restart or reload means clicking back
// to it. Start here, in an item's More menu once the item has left its start, asks the
// agent to make the item, and the versions it is compared with, open at that moment.
//
// The start is written in the item's code (SKILL.md, "Start here"), not kept in this
// browser. Then Restart, a reload, the shared file, and a teammate all open there, and when
// the agent changes the item it changes the start with it. A recording replayed here would
// break without a sign at the next change, and only this browser would have it.
//
// This file keeps what the person did in an item since its start, in words the agent can
// follow ("Pressed “Next”", "Typed “Acme” in “Company”"), so the note says how to get
// there, not only where it ended. A click or key counts only when the item's content
// changed after it: a stray click or a click in Ask agent mode stays out.
import { nameOf, pickElement } from "./dom";
import { controlWords } from "./FlowView";
import { labels } from "./labels";

const MAX_STEPS = 30;
const MAX_VALUE = 60;
/** When a click's effect is looked for: at once, and again for one that takes a moment (as Item.tsx `look`). */
const LOOK_MS = [60, 500];

type Step =
  // `pending`: heard, and waiting to see whether it changed anything (`after` below).
  | { kind: "press" | "click"; words: string; pending?: boolean }
  | { kind: "type"; field: Element; name: string; value: string; hidden: boolean }
  | { kind: "choose"; field: Element; name: string; value: string }
  | { kind: "check"; field: Element; name: string; checked: boolean }
  | { kind: "key"; key: string; name?: string; pending?: boolean };

/** A press or a key: it counts only if the item changed after it. */
type Waiting = Extract<Step, { kind: "press" | "click" | "key" }>;

const isWaiting = (step: Step) => (step.kind === "press" || step.kind === "click" || step.kind === "key") && !!step.pending;

const clip = (text: string) => {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE - 1)}…` : value;
};

// Read by tag, not `instanceof`: a frame's elements belong to another window's classes.
const tagIs = (element: Element, tag: string) => element.tagName.toLowerCase() === tag;
const NOT_TYPED = ["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"];
/** The element an event came from, or a text node's element. */
const elementOf = (target: EventTarget | null): Element | null => {
  const node = target as Node | null;
  return node?.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null);
};
const isTextField = (element: Element) =>
  tagIs(element, "textarea") || (tagIs(element, "input") && !NOT_TYPED.includes((element as HTMLInputElement).type));

/** The steps one item went through since its start, newest last. */
export class Trail {
  private steps: Step[] = [];
  private dropped = 0;
  private timers = new Set<number>();
  /** The presses and keys not settled yet, with the content as it was just before each. */
  private waiting = new Map<Waiting, string | undefined>();

  reset() {
    this.steps = [];
    this.dropped = 0;
    this.waiting.clear();
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
  }

  /** A waiting step stays if the content changed after it, and leaves the list if not. */
  private settle(step: Waiting, now: string | undefined, last: boolean) {
    if (!this.waiting.has(step)) return;
    if (now !== undefined && now !== this.waiting.get(step)) step.pending = false;
    else if (last) this.steps = this.steps.filter((other) => other !== step);
    else return;
    this.waiting.delete(step);
  }

  /**
   * Settles every waiting step against the content as it is now, before a new press or key
   * changes it: otherwise a click that did nothing, quickly followed by one that did, would
   * take the second one's change as its own.
   */
  private settleAll(now: string | undefined) {
    for (const step of [...this.waiting.keys()]) this.settle(step, now, true);
  }

  private push(step: Step) {
    this.steps.push(step);
    if (this.steps.length > MAX_STEPS) {
      this.steps.shift();
      this.dropped += 1;
    }
  }

  /**
   * The same field again replaces its last step: typing a word is one step, not one per letter.
   * A press still waiting in between does not count: it may turn out to have changed nothing.
   */
  private pushField(step: Extract<Step, { field: Element }>) {
    let index = this.steps.length - 1;
    while (index >= 0 && isWaiting(this.steps[index]!)) index -= 1;
    const last = this.steps[index];
    if (last && "field" in last && last.field === step.field && last.kind === step.kind) this.steps[index] = step;
    else this.push(step);
  }

  /**
   * Hears `target` (the item's preview, or a frame's document) in the capture phase, before
   * the item's own handlers. `root` is the item's content, `stateOf` reads it (Item.tsx), to
   * tell a click that did something from one that did not. Returns what stops hearing.
   */
  listen(target: EventTarget, root: () => Element | null | undefined, stateOf: () => string | undefined) {
    // A press or key takes its place in the list at once, so typing right after it comes after
    // it, and stays there only if the content changed by the last look, or by the next press.
    const after = (before: string | undefined, step: Waiting) => {
      step.pending = true;
      this.push(step);
      this.waiting.set(step, before);
      LOOK_MS.forEach((wait, index) => {
        const timer = window.setTimeout(() => {
          this.timers.delete(timer);
          this.settle(step, stateOf(), index === LOOK_MS.length - 1);
        }, wait);
        this.timers.add(timer);
      });
    };
    let pressed: string | undefined;
    const onDown = () => {
      pressed = stateOf();
      this.settleAll(pressed);
    };
    const onClick = (event: Event) => {
      const element = elementOf(event.target);
      const content = root();
      // A link's screen can already be gone: the canvas follows links before this hears the
      // click (Canvas.tsx, on the window), and React shows the next screen in between. It
      // was in the item, or this would not hear it.
      if (!element || !content || (element.isConnected && !content.contains(element))) return;
      // A field's own click only focuses it, and a label's click is passed on to its field:
      // what they change is heard as input or change below.
      const field = element.closest("input, textarea, select, label");
      if (field && !(tagIs(field, "input") && ["button", "submit", "reset", "image"].includes((field as HTMLInputElement).type))) return;
      const words = controlWords(element);
      const picked = words ? undefined : pickElement(element, content);
      const step: Waiting | undefined = words ? { kind: "press", words: clip(words) } : picked && clip(nameOf(picked)) ? { kind: "click", words: clip(nameOf(picked)) } : undefined;
      if (step) after(pressed, step);
    };
    const onInput = (event: Event) => {
      const field = elementOf(event.target);
      if (!field || !isTextField(field)) return;
      const input = field as HTMLInputElement | HTMLTextAreaElement;
      this.pushField({ kind: "type", field, name: nameOf(field) || labels.stepField, value: clip(input.value), hidden: input.type === "password" });
    };
    const onChange = (event: Event) => {
      const field = elementOf(event.target);
      if (!field) return;
      if (tagIs(field, "select")) {
        const select = field as HTMLSelectElement;
        const chosen = [...select.selectedOptions].map((option) => option.textContent ?? "").join(", ");
        this.pushField({ kind: "choose", field, name: nameOf(field) || labels.stepField, value: clip(chosen) });
      } else if (tagIs(field, "input") && ["checkbox", "radio"].includes((field as HTMLInputElement).type)) {
        this.pushField({ kind: "check", field, name: nameOf(field) || labels.stepField, checked: (field as HTMLInputElement).checked });
      }
    };
    const onKey = (event: Event) => {
      const { key } = event as KeyboardEvent;
      const now = stateOf();
      // Any key, typing too: a letter changes what a field holds, which is not the press's doing.
      this.settleAll(now);
      if (key !== "Enter" && key !== "Escape") return;
      const from = elementOf(event.target);
      const field = from && (tagIs(from, "input") || tagIs(from, "select")) ? from : null;
      // Enter in a text area is a new line, already heard as typing.
      if (key === "Enter" && from && tagIs(from, "textarea")) return;
      after(now, { kind: "key", key, name: field ? nameOf(field) || labels.stepField : undefined });
    };
    const heard: [string, EventListener][] = [
      ["pointerdown", onDown],
      ["click", onClick],
      ["input", onInput],
      ["change", onChange],
      ["keydown", onKey],
    ];
    for (const [type, handler] of heard) target.addEventListener(type, handler, true);
    return () => {
      for (const [type, handler] of heard) target.removeEventListener(type, handler, true);
    };
  }

  /** The steps in words, oldest first, and how many earlier ones were left out. */
  lines(): { steps: string[]; earlier: number } {
    const steps = this.steps.filter((step) => !isWaiting(step)).map((step) => {
      switch (step.kind) {
        case "press":
          return labels.stepPress(step.words);
        case "click":
          return labels.stepClick(step.words);
        case "type":
          return step.hidden ? labels.stepTypeHidden(step.name) : labels.stepType(step.value, step.name);
        case "choose":
          return labels.stepChoose(step.value, step.name);
        case "check":
          return labels.stepCheck(step.checked, step.name);
        case "key":
          return labels.stepKey(step.key, step.name);
      }
    });
    return { steps, earlier: this.dropped };
  }
}
