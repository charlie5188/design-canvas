// The page's side of the agent channel (agent-channel.ts): whether an agent is
// listening or handling the person's notes, sending it a message, and
// downloading the canvas as a shared file.

import { useEffect, useRef, useState } from "react";
import { AGENT_EVENT, AGENT_PATH, type AgentReply, MAX_REPLY, NOTE_ID, REPLY_EVENT, SHARE_PATH } from "./channel.ts";
import type { AgentState, AgentStatus, SharedFile } from "./agent-channel.ts";

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

const readReply = (data: unknown): AgentReply | undefined => {
  const reply = data as Partial<AgentReply> | null;
  if (!reply || typeof reply.id !== "string" || !NOTE_ID.test(reply.id)) return undefined;
  if (typeof reply.text !== "string" || !reply.text.trim() || reply.text.length > MAX_REPLY) return undefined;
  return { id: reply.id, text: reply.text, at: typeof reply.at === "number" && Number.isFinite(reply.at) ? reply.at : 0 };
};

/**
 * The agent's answers to notes: as they arrive (`live`), and the ones the dev
 * server still holds when the page opens. The agent often answers right after
 * it edits a file, which is when the page may be reloading, so an answer that
 * only came once would be lost. `onReply` may hear the same answer twice.
 */
export function useAgentReplies(onReply: (reply: AgentReply, live: boolean) => void) {
  const handler = useRef(onReply);
  handler.current = onReply;
  useEffect(() => {
    const hot = (import.meta as ImportMeta & { hot?: HotChannel }).hot;
    if (!hot) return;
    const hear = (data: unknown, live: boolean) => {
      const reply = readReply(data);
      if (reply) handler.current(reply, live);
    };
    const onPush = (data: unknown) => hear(data, true);
    hot.on(REPLY_EVENT, onPush);
    fetch(AGENT_PATH)
      .then((response) => response.json())
      .then((data: { replies?: unknown }) => {
        for (const entry of Array.isArray(data?.replies) ? data.replies : []) hear(entry, false);
      })
      .catch(() => {});
    return () => hot.off?.(REPLY_EVENT, onPush);
  }, []);
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
