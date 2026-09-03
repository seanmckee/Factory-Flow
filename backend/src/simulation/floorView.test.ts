import { describe, it, expect } from "vitest";
import { deriveFloorView } from "./floorView.js";
import type { Routing, WipPart, WorkCenter } from "./types.js";

const twoStep: Routing = {
  steps: [
    { workCenterId: 10, processTimeSeconds: 10 },
    { workCenterId: 20, processTimeSeconds: 10 },
  ],
};

const routings = new Map<number, Routing>([[1, twoStep]]);

const centers = (capacityOf10 = 1) =>
  new Map<number, WorkCenter>([
    [10, { id: 10, capacity: capacityOf10 }],
    [20, { id: 20, capacity: 1 }],
  ]);

const part = (id: string, overrides: Partial<WipPart> = {}): WipPart => ({
  id,
  workOrderId: 1,
  unitIndex: 0,
  releasedAtTick: 0,
  stepIndex: 0,
  progressSeconds: 0,
  actualProcessTimeSeconds: 10,
  ...overrides,
});

describe("deriveFloorView", () => {
  it("reports every work center, idle ones included", () => {
    const view = deriveFloorView([], routings, centers());
    expect(view).toEqual([
      { workCenterId: 10, partsAtStation: 0, slots: [null], slotsInUse: 0 },
      { workCenterId: 20, partsAtStation: 0, slots: [null], slotsInUse: 0 },
    ]);
  });

  it("puts a part at the center its current step names", () => {
    const view = deriveFloorView(
      [part("p1", { stepIndex: 1, progressSeconds: 5 })],
      routings,
      centers(),
    );
    expect(view[0]?.partsAtStation).toBe(0);
    expect(view[1]).toEqual({
      workCenterId: 20,
      partsAtStation: 1,
      slots: [50],
      slotsInUse: 1,
    });
  });

  it("shows percent complete per machine", () => {
    const view = deriveFloorView(
      [part("p1", { progressSeconds: 3, actualProcessTimeSeconds: 4 })],
      routings,
      centers(),
    );
    expect(view[0]?.slots).toEqual([75]);
  });

  it("counts a waiting part at the station but on no machine", () => {
    // progress 0 means it never got a machine this tick — queueing is implicit
    const view = deriveFloorView(
      [part("running", { progressSeconds: 5 }), part("waiting")],
      routings,
      centers(),
    );
    expect(view[0]).toEqual({
      workCenterId: 10,
      partsAtStation: 2,
      slots: [50],
      slotsInUse: 1,
    });
  });

  it("pads slots to capacity and leaves the spare machines null", () => {
    const view = deriveFloorView(
      [part("p1", { progressSeconds: 5 })],
      routings,
      centers(3),
    );
    expect(view[0]?.slots).toEqual([50, null, null]);
  });

  it("sorts busy slots descending so bars don't shuffle between rows", () => {
    const view = deriveFloorView(
      [
        part("p1", { progressSeconds: 2 }),
        part("p2", { progressSeconds: 8 }),
        part("p3", { progressSeconds: 5 }),
      ],
      routings,
      centers(3),
    );
    expect(view[0]?.slots).toEqual([80, 50, 20]);
  });

  it("leaves a part stranded past a shortened route off every machine", () => {
    // the frontend original indexed steps[stepIndex] unguarded here and crashed
    const view = deriveFloorView(
      [part("stranded", { stepIndex: 7, progressSeconds: 5 })],
      routings,
      centers(),
    );
    expect(view.every((center) => center.partsAtStation === 0)).toBe(true);
    expect(view.every((center) => center.slotsInUse === 0)).toBe(true);
  });

  it("throws when a part's work order has no pinned routing", () => {
    expect(() => deriveFloorView([part("p1")], new Map(), centers())).toThrow(
      /work order 1/,
    );
  });
});
