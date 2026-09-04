import { describe, it, expect } from "vitest";
import {
  TICKS_PER_BUCKET,
  bucketLastTick,
  bucketTicks,
} from "./observationBuckets.js";
import type { TickMetrics } from "./simulationTick.js";

/** One tick's observations; `at` is `[busy, queued, capacity]` per center. */
const makeTick = (
  tickNum: number,
  wipCount: number,
  at: Record<number, [busy: number, queued: number, capacity?: number]> = {},
): TickMetrics => ({
  tickNum,
  wipCount,
  workCenters: Object.entries(at).map(([id, [busy, queued, capacity = 1]]) => ({
    workCenterId: Number(id),
    busy,
    queued,
    capacity,
  })),
});

const centerIn = (
  buckets: ReturnType<typeof bucketTicks>,
  index: number,
  workCenterId: number,
) => buckets[index]?.workCenters.find((wc) => wc.workCenterId === workCenterId);

describe("bucketTicks", () => {
  it("groups a tick per bucket at width 1, mirroring each tick", () => {
    const buckets = bucketTicks(
      [makeTick(1, 5, { 10: [1, 2] }), makeTick(2, 3, { 10: [0, 1] })],
      1,
    );

    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({
      startTick: 1,
      tickCount: 1,
      wipPartTicks: 5,
      maxWip: 5,
      endWip: 5,
    });
    expect(centerIn(buckets, 0, 10)).toMatchObject({
      observedTicks: 1,
      busyMachineTicks: 1,
      capacityTicks: 1,
      queuedPartTicks: 2,
      maxQueueDepth: 2,
    });
    expect(buckets[1]?.startTick).toBe(2);
  });

  it("aligns buckets to an absolute grid, ticks numbering from 1", () => {
    // width 60: ticks 1..60 are the first bucket, 61 starts the second
    const buckets = bucketTicks(
      [makeTick(1, 0), makeTick(60, 0), makeTick(61, 0), makeTick(120, 0)],
      60,
    );

    expect(buckets.map((b) => b.startTick)).toEqual([1, 61]);
    expect(buckets[0]?.tickCount).toBe(2);
    expect(buckets[1]?.tickCount).toBe(2);
  });

  it("sums flows, keeps the peak and the closing level of WIP", () => {
    const buckets = bucketTicks(
      [makeTick(1, 4), makeTick(2, 9), makeTick(3, 6)],
      60,
    );

    expect(buckets).toHaveLength(1);
    // the three WIP fields answer three different questions and no one of them
    // can be recovered from another
    expect(buckets[0]?.wipPartTicks).toBe(19);
    expect(buckets[0]?.maxWip).toBe(9);
    expect(buckets[0]?.endWip).toBe(6);
  });

  it("carries a tick count below the width for a bucket still being filled", () => {
    const buckets = bucketTicks([makeTick(1, 1), makeTick(2, 1)], 60);

    expect(buckets[0]?.tickCount).toBe(2);
    // and its last observed tick is the second, not the end of its slot
    expect(bucketLastTick(buckets[0]!)).toBe(2);
  });

  it("counts observed ticks per center, not per bucket", () => {
    // center 20 appears for one of the two ticks — a center created mid-bucket
    const buckets = bucketTicks(
      [makeTick(1, 0, { 10: [1, 0] }), makeTick(2, 0, { 10: [1, 0], 20: [1, 3] })],
      60,
    );

    expect(centerIn(buckets, 0, 10)?.observedTicks).toBe(2);
    expect(centerIn(buckets, 0, 20)?.observedTicks).toBe(1);
    expect(centerIn(buckets, 0, 20)?.maxQueueDepth).toBe(3);
  });

  it("sums each observation's own capacity, so a bucket can span a purchase", () => {
    // 6E: capacity moves mid-run, and a bucket is 60 ticks wide
    const buckets = bucketTicks(
      [makeTick(1, 0, { 10: [1, 0, 1] }), makeTick(2, 0, { 10: [2, 0, 2] })],
      60,
    );

    expect(centerIn(buckets, 0, 10)?.capacityTicks).toBe(3);
    expect(centerIn(buckets, 0, 10)?.busyMachineTicks).toBe(3);
  });

  it("returns nothing for an empty series", () => {
    expect(bucketTicks([], TICKS_PER_BUCKET)).toEqual([]);
  });

  it("throws on a series that goes backwards", () => {
    expect(() => bucketTicks([makeTick(2, 0), makeTick(1, 0)], 60)).toThrow(
      /out of order/,
    );
  });

  it("throws on a repeated tick, which is the same corruption", () => {
    expect(() => bucketTicks([makeTick(1, 0), makeTick(1, 0)], 60)).toThrow(
      /out of order/,
    );
  });

  it("throws on a width that is not a positive whole number", () => {
    expect(() => bucketTicks([], 0)).toThrow(/positive whole number/);
    expect(() => bucketTicks([], -60)).toThrow(/positive whole number/);
    expect(() => bucketTicks([], 1.5)).toThrow(/positive whole number/);
  });

  it("buckets a simulated minute at the stored width", () => {
    const series = Array.from({ length: TICKS_PER_BUCKET + 1 }, (_, i) =>
      makeTick(i + 1, 1),
    );

    const buckets = bucketTicks(series, TICKS_PER_BUCKET);

    expect(buckets).toHaveLength(2);
    expect(buckets[0]?.tickCount).toBe(TICKS_PER_BUCKET);
    expect(buckets[1]).toMatchObject({ startTick: 61, tickCount: 1 });
  });
});
