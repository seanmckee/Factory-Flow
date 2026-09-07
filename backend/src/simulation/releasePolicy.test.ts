import { describe, expect, it } from "vitest";
import {
  eligibleBacklogCount,
  planReleases,
  policyFromRun,
  type BacklogOrder,
  type ReleasePolicy,
  type ReleaseView,
} from "./releasePolicy.js";
import type { Routing, WipPart } from "./types.js";

const order = (
  workOrderId: number,
  overrides: Partial<BacklogOrder> = {},
): BacklogOrder => ({
  workOrderId,
  quantity: 10,
  dueAtTick: null,
  workCenterIds: new Set([10]),
  ...overrides,
});

const part = (
  workOrderId: number,
  stepIndex: number,
  unitIndex = 0,
): WipPart => ({
  id: `p-${workOrderId}-${unitIndex}-${stepIndex}`,
  workOrderId,
  unitIndex,
  releasedAtTick: 0,
  stepIndex,
  progressSeconds: 0,
  actualProcessTimeSeconds: 5,
});

/** wc 10 then wc 20 — a part at step 1 is *past* wc 10 */
const twoStep: Routing = {
  steps: [
    { workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 },
    { workCenterId: 20, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 },
  ],
};

const view = (overrides: Partial<ReleaseView> = {}): ReleaseView => ({
  tickNum: 0,
  wipParts: [],
  routingByWorkOrder: new Map([[1, twoStep]]),
  ...overrides,
});

const runRow = {
  releasePolicy: "manual",
  wipCap: 200,
  releaseLeadDays: 1,
  drumWorkCenterId: null as number | null,
  drumBuffer: 50,
  dayTicks: 28_800,
};

describe("policyFromRun", () => {
  it("maps each policy string, converting lead days to ticks at the boundary", () => {
    expect(policyFromRun(runRow)).toEqual({ kind: "manual" });
    expect(policyFromRun({ ...runRow, releasePolicy: "conwip", wipCap: 40 })).toEqual({
      kind: "conwip",
      wipCap: 40,
    });
    expect(
      policyFromRun({ ...runRow, releasePolicy: "due_date", releaseLeadDays: 2 }),
    ).toEqual({ kind: "due_date", leadTicks: 57_600 });
    expect(
      policyFromRun({
        ...runRow,
        releasePolicy: "dbr",
        drumWorkCenterId: 10,
        drumBuffer: 30,
      }),
    ).toEqual({ kind: "dbr", drumWorkCenterId: 10, drumBuffer: 30 });
  });

  it("throws on a policy this build does not know, rather than falling back", () => {
    expect(() => policyFromRun({ ...runRow, releasePolicy: "kanban" })).toThrow(
      /kanban/,
    );
  });

  it("throws on a dbr run with no drum — a silent manual would read as a losing policy", () => {
    expect(() =>
      policyFromRun({ ...runRow, releasePolicy: "dbr", drumWorkCenterId: null }),
    ).toThrow(/drum/);
  });
});

describe("planReleases priority", () => {
  // The playground seed's work-order ids ascend in due-date order, so a
  // fixture where they DISAGREE is the only kind that can catch an EDD bug.
  const backlog = [
    order(5, { dueAtTick: 200 }),
    order(3, { dueAtTick: 100 }),
    order(9), // undated
    order(1), // undated — later than every dated order despite the low id
  ];

  it("orders by due date, undated last, id tie-break", () => {
    const planned = planReleases(
      { kind: "conwip", wipCap: 1000 },
      view(),
      backlog,
    );
    expect(planned).toEqual([3, 5, 1, 9]);
  });

  it("is deterministic — same inputs, same plan", () => {
    const policy: ReleasePolicy = { kind: "conwip", wipCap: 1000 };
    expect(planReleases(policy, view(), backlog)).toEqual(
      planReleases(policy, view(), backlog),
    );
  });

  it("breaks a due-date tie on work order id", () => {
    const planned = planReleases({ kind: "conwip", wipCap: 1000 }, view(), [
      order(7, { dueAtTick: 100 }),
      order(2, { dueAtTick: 100 }),
    ]);
    expect(planned).toEqual([2, 7]);
  });
});

describe("planReleases: manual", () => {
  it("releases nothing, whatever the backlog", () => {
    expect(planReleases({ kind: "manual" }, view(), [order(1)])).toEqual([]);
  });
});

describe("planReleases: conwip", () => {
  it("fills to the cap, counting each planned order's quantity", () => {
    // cap 25: order of 10 (wip 10), order of 10 (wip 20), then 20 < 25 so one
    // more releases and overshoots — whole orders, never a partial one
    const planned = planReleases({ kind: "conwip", wipCap: 25 }, view(), [
      order(1, { dueAtTick: 1 }),
      order(2, { dueAtTick: 2 }),
      order(3, { dueAtTick: 3 }),
      order(4, { dueAtTick: 4 }),
    ]);
    expect(planned).toEqual([1, 2, 3]);
  });

  it("counts the floor already there", () => {
    const floor = Array.from({ length: 15 }, (_, i) => part(1, 0, i));
    const planned = planReleases(
      { kind: "conwip", wipCap: 25 },
      view({ wipParts: floor }),
      [order(2, { dueAtTick: 1 }), order(3, { dueAtTick: 2 })],
    );
    // 15 on the floor: one order of 10 reaches 25, the second stays back
    expect(planned).toEqual([2]);
  });

  it("releases nothing at or above the cap", () => {
    const floor = Array.from({ length: 25 }, (_, i) => part(1, 0, i));
    expect(
      planReleases({ kind: "conwip", wipCap: 25 }, view({ wipParts: floor }), [
        order(2),
      ]),
    ).toEqual([]);
  });

  it("returns [] on an empty backlog", () => {
    expect(planReleases({ kind: "conwip", wipCap: 25 }, view(), [])).toEqual([]);
  });
});

describe("planReleases: due_date", () => {
  const policy: ReleasePolicy = { kind: "due_date", leadTicks: 100 };

  it("releases exactly at the lead-window boundary, not one tick before", () => {
    const backlog = [order(1, { dueAtTick: 500 })];
    expect(planReleases(policy, view({ tickNum: 399 }), backlog)).toEqual([]);
    expect(planReleases(policy, view({ tickNum: 400 }), backlog)).toEqual([1]);
  });

  it("releases an already-late order immediately", () => {
    expect(
      planReleases(policy, view({ tickNum: 900 }), [order(1, { dueAtTick: 500 })]),
    ).toEqual([1]);
  });

  it("never releases an undated order — there is no date to lead", () => {
    expect(
      planReleases(policy, view({ tickNum: 1_000_000 }), [order(1)]),
    ).toEqual([]);
  });

  it("with zero lead, releases at the due tick itself", () => {
    const zeroLead: ReleasePolicy = { kind: "due_date", leadTicks: 0 };
    const backlog = [order(1, { dueAtTick: 500 })];
    expect(planReleases(zeroLead, view({ tickNum: 499 }), backlog)).toEqual([]);
    expect(planReleases(zeroLead, view({ tickNum: 500 }), backlog)).toEqual([1]);
  });
});

describe("planReleases: dbr", () => {
  const policy: ReleasePolicy = { kind: "dbr", drumWorkCenterId: 10, drumBuffer: 15 };

  it("counts only parts whose current step runs at the drum", () => {
    // 10 parts at the drum (step 0), 10 past it (step 1): drum WIP is 10, so
    // a 10-unit order still fits under the 15 buffer
    const floor = [
      ...Array.from({ length: 10 }, (_, i) => part(1, 0, i)),
      ...Array.from({ length: 10 }, (_, i) => part(1, 1, i + 10)),
    ];
    expect(
      planReleases(policy, view({ wipParts: floor }), [
        order(2, { dueAtTick: 1 }),
        order(3, { dueAtTick: 2 }),
      ]),
    ).toEqual([2]);
  });

  it("fills drum-visiting orders to the buffer, counting quantities", () => {
    const planned = planReleases(policy, view(), [
      order(1, { dueAtTick: 1 }),
      order(2, { dueAtTick: 2 }),
      order(3, { dueAtTick: 3 }),
    ]);
    // 0 -> 10 -> 10 < 15 so a second releases -> 20, the third stays back
    expect(planned).toEqual([1, 2]);
  });

  it("releases orders that never visit the drum immediately, buffer full or not", () => {
    const floor = Array.from({ length: 20 }, (_, i) => part(1, 0, i));
    const planned = planReleases(policy, view({ wipParts: floor }), [
      order(2, { dueAtTick: 1 }), // visits the drum; buffer already full
      order(3, { dueAtTick: 2, workCenterIds: new Set([20]) }), // free goods
    ]);
    expect(planned).toEqual([3]);
  });
});

describe("eligibleBacklogCount", () => {
  const backlog = [order(1, { dueAtTick: 100 }), order(2)];

  it("counts nothing under manual — the policy releases nothing", () => {
    expect(eligibleBacklogCount({ kind: "manual" }, backlog)).toBe(0);
  });

  it("excludes undated orders under due_date, so a jump can terminate", () => {
    expect(
      eligibleBacklogCount({ kind: "due_date", leadTicks: 0 }, backlog),
    ).toBe(1);
  });

  it("counts everything under conwip and dbr", () => {
    expect(eligibleBacklogCount({ kind: "conwip", wipCap: 1 }, backlog)).toBe(2);
    expect(
      eligibleBacklogCount(
        { kind: "dbr", drumWorkCenterId: 10, drumBuffer: 1 },
        backlog,
      ),
    ).toBe(2);
  });
});
