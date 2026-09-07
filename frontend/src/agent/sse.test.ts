import { describe, expect, it } from "vitest";
import { parseSseChunk } from "./sse";

describe("parseSseChunk", () => {
  it("parses complete events and returns an empty buffer on a boundary", () => {
    const { buffer, events } = parseSseChunk(
      "",
      'data: {"type":"token","text":"hi"}\n\ndata: {"type":"done","threadId":"t1"}\n\n',
    );
    expect(events).toEqual([
      { type: "token", text: "hi" },
      { type: "done", threadId: "t1" },
    ]);
    expect(buffer).toBe("");
  });

  it("holds a partial frame in the buffer until the next chunk completes it", () => {
    const first = parseSseChunk("", 'data: {"type":"token",');
    expect(first.events).toEqual([]);
    expect(first.buffer).toBe('data: {"type":"token",');

    const second = parseSseChunk(first.buffer, '"text":"hello"}\n\n');
    expect(second.events).toEqual([{ type: "token", text: "hello" }]);
    expect(second.buffer).toBe("");
  });

  it("skips malformed frames instead of throwing", () => {
    const { events } = parseSseChunk(
      "",
      'data: not-json\n\ndata: {"type":"token","text":"ok"}\n\n',
    );
    expect(events).toEqual([{ type: "token", text: "ok" }]);
  });

  it("ignores non-data lines (comments, event names)", () => {
    const { events } = parseSseChunk(
      "",
      ':keepalive\n\nevent: x\ndata: {"type":"token","text":"a"}\n\n',
    );
    expect(events).toEqual([{ type: "token", text: "a" }]);
  });
});
