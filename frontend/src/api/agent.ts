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
 * POSTs a body and reads the SSE response, invoking `onEvent` per event;
 * resolves when the stream ends. Shared by a turn and by a resumed turn —
 * both speak the same event vocabulary, so the caller handles one stream.
 */
async function streamPost(
  path: string,
  body: unknown,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const response = await fetch(`${AGENT_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

/**
 * One chat turn, streamed. Pass the threadId from a previous turn's `done`
 * event to keep memory. A turn that ends on an `approval` event is not
 * finished — it is paused in the graph, waiting for `resumeChat`.
 */
export async function streamChat(
  message: string,
  threadId: string | null,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  return streamPost(
    "/chat",
    threadId === null ? { message } : { message, threadId },
    onEvent,
  );
}

/**
 * Asks a long-running tool on this thread to stop at its next committed
 * boundary. Not a cancel: the backend commits every advance it accepted, so
 * the run keeps those ticks and the tool reports where it stopped. Fire and
 * forget — the answer arrives on the open stream, not here.
 */
export async function stopChat(threadId: string): Promise<void> {
  const response = await fetch(`${AGENT_BASE}/chat/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadId }),
  });
  if (!response.ok) throw new Error(`Agent responded ${response.status}`);
}

/**
 * Takes back a granted experiment, so every change pauses again. A grant is
 * kept with the conversation and outlives the turn that asked for it, so it
 * has to be cancellable without abandoning the conversation.
 */
export async function revokePlan(threadId: string): Promise<boolean> {
  const response = await fetch(`${AGENT_BASE}/chat/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadId }),
  });
  if (!response.ok) throw new Error(`Agent responded ${response.status}`);
  return ((await response.json()) as { revoked: boolean }).revoked;
}

/**
 * Answers a paused write and streams what follows. Declining is not a
 * cancellation: the model is told, and replies.
 */
export async function resumeChat(
  threadId: string,
  approved: boolean,
  onEvent: (event: AgentEvent) => void,
  note?: string,
): Promise<void> {
  return streamPost("/chat/resume", { threadId, approved, note }, onEvent);
}
