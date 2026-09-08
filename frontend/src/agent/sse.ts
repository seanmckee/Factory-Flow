/**
 * The agent service's SSE wire format, parsed by hand — ~30 lines beats a
 * dependency, and `EventSource` can't POST, so the page reads the stream off
 * `fetch` and feeds chunks through here. Pure, so it's testable like the
 * simulation transforms.
 */
/** the run an approval would touch, as the SIM reports it — not as the model
 * described it, which is the whole point of confirming against this */
export type ApprovalRun = {
  id: number;
  name: string;
  tickNum: number;
  status: string;
  netCents: number;
  isFork: boolean;
};

/** one write, paused inside the graph until the person here answers */
export type ApprovalRequest = {
  tool: string;
  args: Record<string, unknown>;
  run: ApprovalRun;
  /** the server's own one-line description, including money where there is any */
  summary: string;
  /** the sim's frozen quote for this call — 0 where no money moves */
  spendCents?: number;
  /**
   * Why this paused **despite** an approved plan covering the thread: the
   * wrong run, a verb the plan didn't ask for, a longer advance, a bigger
   * charge. Present only when a plan is active and this call falls outside
   * it, because that is the case where a person is being asked something
   * they thought they had already answered.
   */
  outsidePlan?: string;
  /**
   * Every run a *plan* would touch, when the pause is a request for
   * authority over a whole experiment rather than one write. `run` carries
   * the first of them, so a client that only knows how to draw one write
   * still draws something true.
   */
  runs?: ApprovalRun[];
};

export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool"; name: string; input: Record<string, unknown> }
  /**
   * A tool's own *result*, for the few tools whose output the transcript can
   * draw. The `tool` event above carries only what the model asked for; this
   * carries what the sim answered, which is the difference between rendering
   * a computed figure and rendering one a model retyped. `data` is unknown
   * until narrowed — see `verdict.ts` for the comparator's shape.
   */
  | { type: "result"; name: string; data: unknown }
  /**
   * A long-running tool saying how far it has got. Only the chunked advance
   * emits these today — a jump of many committed requests, minutes long,
   * which would otherwise be silence. Fields are optional because the channel
   * is generic and each tool shapes its own payload; `tool` says whose it is.
   */
  | {
      type: "progress";
      tool: string;
      runId?: number;
      tickNum?: number;
      fromTick?: number;
      toTick?: number;
      dayTicks?: number | null;
      wipCount?: number | null;
    }
  | ({ type: "approval" } & ApprovalRequest)
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
