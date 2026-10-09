import { describe, expect, it } from "vitest";
import { MinHeap, keyOrdinal, keyTick, scheduleKey } from "./minHeap.js";

const drain = (heap: MinHeap): number[] => {
  const out: number[] = [];
  while (heap.size > 0) out.push(heap.pop());
  return out;
};

const seeded = (values: number[]): MinHeap => {
  const heap = new MinHeap();
  for (const value of values) heap.push(value);
  return heap;
};

describe("MinHeap", () => {
  it("pops in ascending order whatever order things went in", () => {
    expect(drain(seeded([5, 1, 9, 3, 3, 0, 7]))).toEqual([0, 1, 3, 3, 5, 7, 9]);
  });

  it("peeks the minimum without removing it", () => {
    const heap = seeded([4, 2, 8]);
    expect(heap.peek()).toBe(2);
    expect(heap.size).toBe(3);
  });

  it("reports an empty heap as undefined rather than a sentinel", () => {
    // 0 and negatives are legal items, so -1 could not have said "empty"
    expect(new MinHeap().peek()).toBeUndefined();
    expect(seeded([0]).peek()).toBe(0);
  });

  it("throws rather than inventing a value for an empty pop", () => {
    expect(() => new MinHeap().pop()).toThrow(/empty heap/);
  });

  it("stays ordered when pushes and pops interleave", () => {
    // the engine never drains the schedule: it pops one tick's completions and
    // pushes the next admissions straight back in
    const heap = new MinHeap();
    const popped: number[] = [];
    for (const value of [8, 3, 6]) heap.push(value);
    popped.push(heap.pop());
    for (const value of [1, 9, 4]) heap.push(value);
    popped.push(heap.pop(), heap.pop());
    heap.push(2);
    popped.push(...drain(heap));
    expect(popped).toEqual([3, 1, 4, 2, 6, 8, 9]);
  });

  it("agrees with a sort over a large random push order", () => {
    let state = 12345;
    const values = Array.from({ length: 2_000 }, () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state % 100_000;
    });
    expect(drain(seeded(values))).toEqual([...values].sort((a, b) => a - b));
  });
});

describe("scheduleKey", () => {
  it("round-trips a tick and an ordinal", () => {
    const key = scheduleKey(43_600, 554);
    expect(keyTick(key)).toBe(43_600);
    expect(keyOrdinal(key)).toBe(554);
  });

  it("orders by tick first, then by list position", () => {
    // the whole tie-break: the earliest tick wins, and within a tick the part
    // earliest in the WIP list does — which is who pays a changeover
    const keys = [
      scheduleKey(10, 7),
      scheduleKey(9, 999),
      scheduleKey(10, 2),
      scheduleKey(11, 0),
    ];
    expect(drain(seeded(keys)).map((key) => [keyTick(key), keyOrdinal(key)])).toEqual([
      [9, 999],
      [10, 2],
      [10, 7],
      [11, 0],
    ]);
  });

  it("stays exact at a tick count no run will reach", () => {
    // ~290,000 staffed days: the packing must not start losing low bits
    const key = scheduleKey(8_000_000_000, 1_048_575);
    expect(keyTick(key)).toBe(8_000_000_000);
    expect(keyOrdinal(key)).toBe(1_048_575);
  });

  it("refuses an ordinal that would collide with the next tick", () => {
    expect(() => scheduleKey(1, 1 << 20)).toThrow(/does not fit/);
    expect(() => scheduleKey(1, -1)).toThrow(/does not fit/);
  });
});
