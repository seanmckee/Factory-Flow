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

it("parses an approval event with its nested run", () => {
  const payload = {
    type: "approval",
    tool: "capital_action",
    args: { run_id: 39, kind: "buy_machine", work_center_id: 98 },
    run: {
      id: 39,
      name: "Playground shakedown",
      tickNum: 86400,
      status: "idle",
      netCents: 4244443,
      isFork: false,
    },
    summary: "Buy a machine at Drill Press — $1,200.00 at Day 4 · 0:00:00.",
  };
  const { events, buffer } = parseSseChunk("", `data: ${JSON.stringify(payload)}\n\n`);
  expect(buffer).toBe("");
  expect(events).toHaveLength(1);
  const event = events[0];
  expect(event.type).toBe("approval");
  // the run is nested, so a shallow cast would have lost it
  expect(event).toMatchObject({ run: { name: "Playground shakedown" } });
});

it("parses a tool result, whose data stays unknown until narrowed", () => {
  const payload = {
    type: "result",
    name: "compare_runs",
    data: { netDeltaCents: 448775, summary: "#59 wins by $4,487.75" },
  };
  const { events, buffer } = parseSseChunk("", `data: ${JSON.stringify(payload)}\n\n`);
  expect(buffer).toBe("");
  expect(events).toEqual([payload]);
});

it("parses a progress event from a long-running tool", () => {
  const payload = {
    type: "progress",
    tool: "advance_to_tick",
    runId: 59,
    tickNum: 106_400,
    fromTick: 86_400,
    toTick: 144_000,
    dayTicks: 28_800,
    wipCount: 4,
  };
  const { events, buffer } = parseSseChunk("", `data: ${JSON.stringify(payload)}\n\n`);
  expect(buffer).toBe("");
  expect(events).toEqual([payload]);
});

it("parses a plan approval, which spans several runs", () => {
  const payload = {
    type: "approval",
    tool: "propose_experiment",
    args: { purpose: "test a second press", run_ids: [58, 59] },
    run: {
      id: 58,
      name: "Baseline · CONWIP 150",
      tickNum: 230400,
      dayTicks: 28800,
      status: "idle",
      netCents: 1094433,
      isFork: false,
    },
    runs: [
      {
        id: 58,
        name: "Baseline · CONWIP 150",
        tickNum: 230400,
        dayTicks: 28800,
        status: "idle",
        netCents: 1094433,
        isFork: false,
      },
      {
        id: 59,
        name: "Second drill press",
        tickNum: 230400,
        dayTicks: 28800,
        status: "idle",
        netCents: 1543208,
        isFork: true,
      },
    ],
    spendCents: 200000,
    summary: "Run an experiment on #58 and #59 — spend up to $2,000.00.",
  };
  const { events } = parseSseChunk("", `data: ${JSON.stringify(payload)}\n\n`);
  expect(events).toEqual([payload]);
});

it("parses a pause that fell outside an approved plan", () => {
  const payload = {
    type: "approval",
    tool: "capital_action",
    args: { run_id: 61, kind: "buy_machine", work_center_id: 98 },
    run: {
      id: 61,
      name: "agent test",
      tickNum: 403200,
      status: "idle",
      netCents: 0,
      isFork: false,
    },
    spendCents: 120000,
    outsidePlan: "the approved plan covers #58, #59, not #61",
    summary: "Buy a machine at Drill Press — $1,200.00.",
  };
  const { events } = parseSseChunk("", `data: ${JSON.stringify(payload)}\n\n`);
  expect(events).toEqual([payload]);
});
