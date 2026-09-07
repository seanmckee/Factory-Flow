/**
 * The agent service's SSE wire format, parsed by hand — ~30 lines beats a
 * dependency, and `EventSource` can't POST, so the page reads the stream off
 * `fetch` and feeds chunks through here. Pure, so it's testable like the
 * simulation transforms.
 */
export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool"; name: string; input: Record<string, unknown> }
  | { type: "done"; threadId: string }
  | { type: "error"; message: string };

export type SseParseResult = {
  /** unconsumed tail — a partial event waiting for its next chunk */
  buffer: string;
  events: AgentEvent[];
};

/**
 * Consumes one network chunk against the carried buffer and returns every
 * complete event. SSE events end in a blank line; each of ours is a single
 * `data: <json>` line. Anything unparseable is skipped rather than thrown —
 * a malformed frame shouldn't kill the conversation.
 */
export function parseSseChunk(buffer: string, chunk: string): SseParseResult {
  const combined = buffer + chunk;
  const frames = combined.split("\n\n");
  // the last piece is either "" (chunk ended on a boundary) or a partial frame
  const tail = frames.pop() ?? "";
  const events: AgentEvent[] = [];
  for (const frame of frames) {
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        events.push(JSON.parse(line.slice("data: ".length)) as AgentEvent);
      } catch {
        // skip malformed frames
      }
    }
  }
  return { buffer: tail, events };
}
