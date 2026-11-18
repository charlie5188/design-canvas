// Paths and event names the page and the dev server share. Kept apart from
// agent-channel.ts, which runs in Node, so the page can import them safely.

/** Where the page talks to the agent: `listen`, `send`, `done`, and `reply` are under it. */
export const AGENT_PATH = "/__design-canvas/agent";
/** Vite's HMR channel carries state changes to open pages. */
export const AGENT_EVENT = "design-canvas:agent";
/** The agent's answer to one note, shown on that note's pin. */
export const REPLY_EVENT = "design-canvas:reply";
/** One answer: the note's id, as the message to the agent gave it, plain text, and when it came (ms). */
export type AgentReply = { id: string; text: string; at: number };
export const MAX_REPLY = 2000;
export const NOTE_ID = /^[a-z0-9]{1,40}$/i;
/** The canvas's version and the newest one on GitHub, so the page can offer an update. */
export const VERSION_PATH = "/__design-canvas/version";
export const SHARE_PATH = "/__design-canvas/share";
/** Moves, resizes, and text changes of registry entries, written into registry.tsx. */
export const EDIT_PATH = "/__design-canvas/edit";
/** Inspect: the props a design-system component takes, read from its type declarations (props-types.ts). */
export const PROPS_PATH = "/__design-canvas/props";
/** Inspect: the Tailwind theme the app builds with, its tokens whether the page uses them or not (tailwind-theme.ts). */
export const THEME_PATH = "/__design-canvas/theme";
