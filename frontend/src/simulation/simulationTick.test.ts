import { describe, it, expect } from "vitest";
import { simulateTick } from "./simulationTick";
import type { Routing } from "../types/Routing";
import type { WipPart } from "../types/WipPart";
import type { WorkCenter } from "../types/WorkCenter";

const testRouting: Routing = {
  id: 1,
  partId: 1,
  name: "Test Routing",
  revision: "A",
  steps: [
    {
      id: 1,
      routingId: 1,
      workCenterId: 10,
      sequence: 1,
      processTimeSeconds: 5,
      setupTimeSeconds: 0,
    },
    {
      id: 2,
      routingId: 1,
      workCenterId: 20,
      sequence: 2,
      processTimeSeconds: 5,
      setupTimeSeconds: 0,
    },
  ],
};

const testRoutings = new Map<number, Routing>([[1, testRouting]]);

const makeWorkCenters = (firstStepCapacity: number) =>
  new Map<number, WorkCenter>([
    [10, { id: 10, name: "WC 10", capacity: firstStepCapacity }],
    [20, { id: 20, name: "WC 20", capacity: 1 }],
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

describe("simulateTick", () => {
  it("advances a part's progress by 1 second per tick", () => {
    // Arrange
    const wipParts: WipPart[] = [makeWipPart("part-1")];
    // Act
    const result = simulateTick(wipParts, testRoutings, 1, testWorkCenters);
    // Assert
    expect(result.wipParts[0].progressSeconds).toBe(1);
  });

  it("only advances one part per work center (capacity of 1)", () => {
    const wipParts: WipPart[] = [makeWipPart("part-1"), makeWipPart("part-2")];
    const result = simulateTick(wipParts, testRoutings, 1, testWorkCenters);
    expect(result.wipParts[0].progressSeconds).toBe(1);
    expect(result.wipParts[1].progressSeconds).toBe(0);
  });

  it("moves to next step when process time completes", () => {
    const wipParts: WipPart[] = [
      makeWipPart("part-1", { progressSeconds: 4 }),
    ];
    const result = simulateTick(wipParts, testRoutings, 1, testWorkCenters);
    expect(result.wipParts[0].stepIndex).toBe(1);
    expect(result.wipParts[0].progressSeconds).toBe(0);
  });

  it("finished part leaves wipParts and appears in finishedParts", () => {
    const wipParts: WipPart[] = [
      makeWipPart("part-1", { stepIndex: 1, progressSeconds: 4 }),
    ];
    const result = simulateTick(wipParts, testRoutings, 1, testWorkCenters);
    expect(result.finishedParts.length).toBe(1);
    expect(result.finishedParts[0].workOrderId).toBe(1);
    expect(result.wipParts.length).toBe(0);
  });

  it("advances up to capacity parts at a work center", () => {
    const wipParts: WipPart[] = [
      makeWipPart("part-1"),
      makeWipPart("part-2"),
      makeWipPart("part-3"),
    ];
    const result = simulateTick(wipParts, testRoutings, 1, makeWorkCenters(2));

    const advanced = result.wipParts.filter((w) => w.progressSeconds === 1);
    expect(advanced.length).toBe(2);
    expect(result.wipParts.filter((w) => w.progressSeconds === 0).length).toBe(
      1,
    );
  });

  it("capacity of 1 still admits only one waiting part", () => {
    const wipParts: WipPart[] = [makeWipPart("part-1"), makeWipPart("part-2")];
    const result = simulateTick(wipParts, testRoutings, 1, makeWorkCenters(1));

    expect(result.wipParts.filter((w) => w.progressSeconds === 1).length).toBe(
      1,
    );
  });

  it("a part already in service holds one machine, not two", () => {
    const wipParts: WipPart[] = [
      makeWipPart("part-1", { progressSeconds: 2 }),
      makeWipPart("part-2"),
      makeWipPart("part-3"),
    ];
    const result = simulateTick(wipParts, testRoutings, 1, makeWorkCenters(2));

    const byId = new Map(result.wipParts.map((w) => [w.id, w]));
    // the in-service part keeps running on its machine
    expect(byId.get("part-1")?.progressSeconds).toBe(3);
    // only one machine was left free, so exactly one waiter is admitted
    const admittedWaiters = ["part-2", "part-3"].filter(
      (id) => byId.get(id)?.progressSeconds === 1,
    );
    expect(admittedWaiters.length).toBe(1);
  });
});
