import { describe, expect, it } from "vitest";
import { parseRunLink, runLink, runLinkParams } from "./runLink";

const runs = [{ id: 58 }, { id: 59 }, { id: 61 }];

describe("runLink", () => {
  it("addresses one run, or a pair", () => {
    expect(runLink(59)).toBe("/?run=59");
    expect(runLink(59, 58)).toBe("/?run=59&compare=58");
  });

  it("drops a compare that is the run itself, since that is no comparison", () => {
    expect(runLink(59, 59)).toBe("/?run=59");
    expect(runLink(59, null)).toBe("/?run=59");
  });
});

describe("runLinkParams", () => {
  it("builds the same query the link carries, for the URL a selection writes", () => {
    expect(runLinkParams(59, 58).toString()).toBe("run=59&compare=58");
    expect(runLinkParams(59).toString()).toBe("run=59");
  });
});

describe("parseRunLink", () => {
  const parse = (query: string) => parseRunLink(new URLSearchParams(query), runs);

  it("reads a pair that exists", () => {
    expect(parse("run=59&compare=58")).toEqual({
      runId: 59,
      compareRunId: 58,
      missing: [],
    });
  });

  it("reads a run on its own", () => {
    expect(parse("run=61")).toEqual({ runId: 61, compareRunId: null, missing: [] });
  });

  it("names a run the list no longer has instead of failing a fetch", () => {
    // A link outlives the run it points at. Falling back quietly would open a
    // page showing somebody else's run as though it were the one they sent.
    expect(parse("run=99")).toEqual({ runId: null, compareRunId: null, missing: [99] });
    expect(parse("run=59&compare=99")).toEqual({
      runId: 59,
      compareRunId: null,
      missing: [99],
    });
  });

  it("ignores a comparison with no run to compare against", () => {
    expect(parse("compare=58")).toEqual({
      runId: null,
      compareRunId: null,
      missing: [],
    });
  });

  it("ignores a run compared with itself", () => {
    expect(parse("run=59&compare=59").compareRunId).toBeNull();
  });

  it("ignores junk rather than treating it as an id", () => {
    expect(parse("run=abc")).toEqual({ runId: null, compareRunId: null, missing: [] });
    expect(parse("run=-3")).toEqual({ runId: null, compareRunId: null, missing: [] });
    expect(parse("run=1.5")).toEqual({ runId: null, compareRunId: null, missing: [] });
    expect(parse("")).toEqual({ runId: null, compareRunId: null, missing: [] });
  });
});
