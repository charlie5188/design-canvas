// The page's side of the agent channel (agent-channel.ts): whether an agent is
// listening or handling the person's notes, sending it a message, and
// downloading the canvas as a shared file.

import { useEffect, useRef, useState } from "react";
import { AGENT_EVENT, AGENT_PATH, type AgentState, type AgentStatus, SHARE_PATH, type SharedFile } from "./agent-channel";

export type { AgentState, AgentStatus };

/** The part of Vite's `import.meta.hot` this uses; absent outside the dev server. */
type HotChannel = {
  on(event: string, listener: (data: unknown) => void): void;
  off?(event: string, listener: (data: unknown) => void): void;
};

const readState = (data: unknown): AgentState => {
  const state = (data as { state?: unknown } | null)?.state;
  return state === "listening" || state === "working" ? state : "off";
};
const readStatus = (data: unknown): AgentStatus => {
  const state = readState(data);
  const { handling, finished } = (data ?? {}) as { handling?: unknown; finished?: unknown };
  return { state, handling: state !== "off" && handling === true, finished: finished === true };
};

/**
 * The agent's state, kept current by the dev server. `state` is undefined until
 * known, so nothing acts on a default "off" before the first answer.
 * `onFinished` runs when the agent says it is done with the notes it had.
 */
export function useAgentStatus(onFinished?: () => void): { state: AgentState | undefined; handling: boolean } {
  const [status, setStatus] = useState<{ state: AgentState | undefined; handling: boolean }>({
    state: undefined,
    handling: false,
  });
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  useEffect(() => {
    const hot = (import.meta as ImportMeta & { hot?: HotChannel }).hot;
    // A build has no dev server, so no agent.
    if (!hot) {
      setStatus({ state: "off", handling: false });
      return;
    }
    let live = true;
    let pushed = false;
    const onPush = (data: unknown) => {
      pushed = true;
      if (!live) return;
      const next = readStatus(data);
      setStatus({ state: next.state, handling: next.handling });
      if (next.finished) finishedRef.current?.();
    };
    // A stopped dev server sends nothing more; the page reloads once it is back.
    const onDisconnect = () => onPush(null);
    hot.on(AGENT_EVENT, onPush);
    hot.on("vite:ws:disconnect", onDisconnect);
    // A canvas whose vite.config lacks agentChannel() answers with its page, which reads as "off".
    fetch(AGENT_PATH)
      .then((response) => response.json())
      .then(readStatus, () => readStatus(null))
      .then((initial) => {
        if (live && !pushed) setStatus({ state: initial.state, handling: initial.handling });
      });
    return () => {
      live = false;
      hot.off?.(AGENT_EVENT, onPush);
      hot.off?.("vite:ws:disconnect", onDisconnect);
    };
  }, []);
  return status;
}

/** Hands a message to the listening agent. Not delivered: nobody listened, and `state` says why. */
export async function sendToAgent(text: string): Promise<{ delivered: boolean; state: AgentState }> {
  try {
    const response = await fetch(`${AGENT_PATH}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const result = (await response.json()) as { delivered?: unknown; state?: unknown };
    return { delivered: result.delivered === true, state: readState(result) };
  } catch {
    return { delivered: false, state: "off" };
  }
}

/**
 * Has the dev server build the canvas into one HTML file and downloads it.
 * Rejects with the server's reason when the build fails.
 */
export async function downloadSharedFile(): Promise<{ name: string; missing: string[] }> {
  const response = await fetch(SHARE_PATH, { method: "POST" });
  // A canvas whose vite.config lacks agentChannel() has no such endpoint.
  if (!response.ok) throw new Error(response.status === 404 ? "the canvas's vite config lacks agentChannel()" : await response.text());
  const file = (await response.json()) as SharedFile;
  const url = URL.createObjectURL(new Blob([file.html], { type: "text/html" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  // The download has started from the object URL by the next task.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { name: file.name, missing: file.missing };
}
