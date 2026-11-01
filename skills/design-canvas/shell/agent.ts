// The page's side of the agent channel (agent-channel.ts): whether an agent is
// listening, and sending it a message.

import { useEffect, useState } from "react";
import { AGENT_EVENT, AGENT_PATH, type AgentState } from "./agent-channel";

export type { AgentState };

/** The part of Vite's `import.meta.hot` this uses; absent outside the dev server. */
type HotChannel = {
  on(event: string, listener: (data: unknown) => void): void;
  off?(event: string, listener: (data: unknown) => void): void;
};

const readState = (data: unknown): AgentState => {
  const state = (data as { state?: unknown } | null)?.state;
  return state === "listening" || state === "working" ? state : "off";
};

/**
 * The agent's state, kept current by the dev server. Undefined until known, so
 * nothing acts on a default "off" before the first answer.
 */
export function useAgentState(): AgentState | undefined {
  const [state, setState] = useState<AgentState>();
  useEffect(() => {
    const hot = (import.meta as ImportMeta & { hot?: HotChannel }).hot;
    // A build has no dev server, so no agent.
    if (!hot) {
      setState("off");
      return;
    }
    let live = true;
    let pushed = false;
    const onPush = (data: unknown) => {
      pushed = true;
      if (live) setState(readState(data));
    };
    // A stopped dev server sends nothing more; the page reloads once it is back.
    const onDisconnect = () => onPush(null);
    hot.on(AGENT_EVENT, onPush);
    hot.on("vite:ws:disconnect", onDisconnect);
    // A canvas whose vite.config lacks agentChannel() answers with its page, which reads as "off".
    fetch(AGENT_PATH)
      .then((response) => response.json())
      .then(readState, () => "off" as const)
      .then((initial) => {
        if (live && !pushed) setState(initial);
      });
    return () => {
      live = false;
      hot.off?.(AGENT_EVENT, onPush);
      hot.off?.("vite:ws:disconnect", onDisconnect);
    };
  }, []);
  return state;
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
