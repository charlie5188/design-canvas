// Paths and event names the page and the dev server share. Kept apart from
// agent-channel.ts, which runs in Node, so the page can import them safely.

/** Where the page talks to the agent: `listen`, `send`, and `done` are under it. */
export const AGENT_PATH = "/__design-canvas/agent";
/** Vite's HMR channel carries state changes to open pages. */
export const AGENT_EVENT = "design-canvas:agent";
/** The canvas's version and the newest one on GitHub, so the page can offer an update. */
export const VERSION_PATH = "/__design-canvas/version";
export const SHARE_PATH = "/__design-canvas/share";
/** Moves, resizes, and text changes of registry entries, written into registry.tsx. */
export const EDIT_PATH = "/__design-canvas/edit";
