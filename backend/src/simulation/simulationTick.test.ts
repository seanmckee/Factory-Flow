import { describe, it, expect } from "vitest";
import { simulateTick } from "./simulationTick.js";
import type { Routing, WipPart, WorkCenter } from "./types.js";

const SEED = 42;

const testRouting: Routing = {
  steps: [
    { workCenterId: 10, processTimeSeconds: 5 },
    { workCenterId: 20, processTimeSeconds: 5 },
  ],
};

const testRoutings = new Map<number, Routing>([[1, testRouting]]);

const makeWorkCenters = (firstStepCapacity: number) =>
  new Map<number, WorkCenter>([
    [10, { id: 10, capacity: firstStepCapacity }],
    [20, { id: 20, capacity: 1 }],
  ]);

const testWorkCenters = makeWorkCenters(1);

const makeWipPart = (id: string, overrides: Partial<WipPart> = {}): WipPart => ({
  id,
  workOrderId: 1,
  routingId: 1,
  stepIndex: 0,
  progressSeconds: 0,
  actualProcessTimeSeconds: 5,
  ...overrides,
});

const tick = (
  wipParts: WipPart[],
  workCenters = testWorkCenters,
  tickNum = 1,
  seed = SEED,
) => simulateTick(wipParts, testRoutings, tickNum, workCenters, seed);

describe("simulateTick", () => {
  it("advances a part's progress by 1 second per tick", () => {
    const result = tick([makeWipPart("part-1")]);
    expect(result.wipParts[0]?.progressSeconds).toBe(1);
  });

  it("does not mutate the parts it is given", () => {
    const part = makeWipPart("part-1");
    tick([part]);
    expect(part.progressSeconds).toBe(0);
  });

  it("only advances one part per work center (capacity of 1)", () => {
    const result = tick([makeWipPart("part-1"), makeWipPart("part-2")]);
    expect(result.wipParts[0]?.progressSeconds).toBe(1);
    expect(result.wipParts[1]?.progressSeconds).toBe(0);
  });

  it("moves to next step when process time completes", () => {
    const result = tick([makeWipPart("part-1", { progressSeconds: 4 })]);
    expect(result.wipParts[0]?.stepIndex).toBe(1);
    expect(result.wipParts[0]?.progressSeconds).toBe(0);
  });

  it("finished part leaves wipParts and appears in finishedParts", () => {
    const result = tick(
      [makeWipPart("part-1", { stepIndex: 1, progressSeconds: 4 })],
      testWorkCenters,
      7,
    );
    expect(result.finishedParts).toEqual([
      { id: "part-1", workOrderId: 1, completedAtTick: 7 },
    ]);
    expect(result.wipParts.length).toBe(0);
  });

  it("advances up to capacity parts at a work center", () => {
    const result = tick(
      [makeWipPart("part-1"), makeWipPart("part-2"), makeWipPart("part-3")],
      makeWorkCenters(2),
    );

    expect(result.wipParts.filter((w) => w.progressSeconds === 1).length).toBe(2);
    expect(result.wipParts.filter((w) => w.progressSeconds === 0).length).toBe(1);
  });

  it("capacity of 1 still admits only one waiting part", () => {
    const result = tick(
      [makeWipPart("part-1"), makeWipPart("part-2")],
      makeWorkCenters(1),
    );
    expect(result.wipParts.filter((w) => w.progressSeconds === 1).length).toBe(1);
  });

  it("a part already in service holds one machine, not two", () => {
    const result = tick(
      [
        makeWipPart("part-1", { progressSeconds: 2 }),
        makeWipPart("part-2"),
        makeWipPart("part-3"),
      ],
      makeWorkCenters(2),
    );

    const byId = new Map(result.wipParts.map((w) => [w.id, w]));
    // the in-service part keeps running on its machine
    expect(byId.get("part-1")?.progressSeconds).toBe(3);
    // only one machine was left free, so exactly one waiter is admitted
    const admittedWaiters = ["part-2", "part-3"].filter(
      (id) => byId.get(id)?.progressSeconds === 1,
    );
    expect(admittedWaiters.length).toBe(1);
  });

  it("draws a new process time for the step it moves onto", () => {
    const result = tick([makeWipPart("part-1", { progressSeconds: 4 })]);
    const actual = result.wipParts[0]?.actualProcessTimeSeconds ?? 0;
    // nominal 5, ±30%
    expect(actual).toBeGreaterThanOrEqual(4);
    expect(actual).toBeLessThanOrEqual(7);
  });

  it("reproduces the same draw from the same seed", () => {
    const draw = (seed: number) =>
      tick(
        [makeWipPart("part-1", { progressSeconds: 4 })],
        testWorkCenters,
        1,
        seed,
      ).wipParts[0]?.actualProcessTimeSeconds;

    expect(draw(SEED)).toBe(draw(SEED));
  });

  it("draws independently per part, not once per step", () => {
    // a long nominal time so two draws colliding after rounding is unlikely
    const routings = new Map<number, Routing>([
      [
        1,
        {
          steps: [
            { workCenterId: 10, processTimeSeconds: 5 },
            { workCenterId: 20, processTimeSeconds: 1000 },
          ],
        },
      ],
    ]);
    const result = simulateTick(
      [
        makeWipPart("part-1", { progressSeconds: 4 }),
        makeWipPart("part-2", { progressSeconds: 4 }),
      ],
      routings,
      1,
      makeWorkCenters(2),
      SEED,
    );

    const [first, second] = result.wipParts;
    expect(first?.stepIndex).toBe(1);
    expect(second?.stepIndex).toBe(1);
    expect(first?.actualProcessTimeSeconds).not.toBe(
      second?.actualProcessTimeSeconds,
    );
  });

  describe("when a routing has been shortened under an in-flight part", () => {
    const shortened = new Map<number, Routing>([
      [1, { steps: [{ workCenterId: 10, processTimeSeconds: 5 }] }],
    ]);

    it("finishes the stranded part at the current tick", () => {
      const result = simulateTick(
        [makeWipPart("part-1", { stepIndex: 1, progressSeconds: 3 })],
        shortened,
        9,
        testWorkCenters,
        SEED,
      );

      expect(result.finishedParts).toEqual([
        { id: "part-1", workOrderId: 1, completedAtTick: 9 },
      ]);
      expect(result.wipParts.length).toBe(0);
    });

    it("does not let the stranded part hold a machine on its way out", () => {
      const result = simulateTick(
        [
          makeWipPart("stranded", { stepIndex: 1, progressSeconds: 3 }),
          makeWipPart("part-2"),
        ],
        shortened,
        1,
        testWorkCenters,
        SEED,
      );

      expect(result.wipParts[0]?.progressSeconds).toBe(1);
    });
  });

  it("throws when a part's routing was not loaded", () => {
    expect(() =>
      simulateTick([makeWipPart("part-1")], new Map(), 1, testWorkCenters, SEED),
    ).toThrow(/routing 1/);
  });

  it("throws when a step's work center was not loaded", () => {
    expect(() =>
      simulateTick([makeWipPart("part-1")], testRoutings, 1, new Map(), SEED),
    ).toThrow(/work center 10/);
  });
});
