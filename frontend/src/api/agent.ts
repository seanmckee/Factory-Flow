import { parseSseChunk, type AgentEvent } from "../agent/sse";

/**
 * The agent service — called directly (CORS on its side); Express is never
 * between the browser and the agent. Like API_BASE, hard-coded until an env
 * story exists for any of the three services.
 */
const AGENT_BASE = "http://localhost:8000";

export type AgentHealth = {
  status: string;
  backendReachable: boolean;
  model: string;
};

export const getAgentHealth = async (): Promise<AgentHealth> => {
  const response = await fetch(`${AGENT_BASE}/health`);
  if (!response.ok) throw new Error(`Agent responded ${response.status}`);
  return (await response.json()) as AgentHealth;
};

/**
 * One chat turn, streamed. POSTs the message and reads the SSE body off the
 * fetch stream, invoking `onEvent` per event; resolves when the stream ends.
 * Pass the threadId from a previous turn's `done` event to keep memory.
 */
export async function streamChat(
  message: string,
  threadId: string | null,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const response = await fetch(`${AGENT_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(threadId === null ? { message } : { message, threadId }),
  });
  if (!response.ok || response.body === null) {
    throw new Error(`Agent responded ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const parsed = parseSseChunk(buffer, decoder.decode(value, { stream: true }));
    buffer = parsed.buffer;
    for (const event of parsed.events) onEvent(event);
  }
}
