/**
 * A binary min-heap of numbers.
 *
 * Numbers rather than objects with a comparator, because both things the
 * engine schedules fit in one: a work center's queue holds **ordinals** (a
 * part's position in the run's WIP list, which is what admission order means),
 * and the completion schedule holds `(tick, ordinal)` packed by `scheduleKey`
 * — so popping the minimum gives the earliest tick and, within a tick, the
 * lowest list position. That is the tie-break the tick-stepped engine got for
 * free by iterating the WIP array, and it decides who pays a changeover and
 * which sales order a unit is credited to, so it is not a detail.
 *
 * No delete and no decrease-key: a part has at most one scheduled completion
 * at a time, and a queued part is popped only when a machine takes it.
 */
export class MinHeap {
  private readonly items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  /** The minimum, or `undefined` when empty — 0 and negatives are legal items. */
  peek(): number | undefined {
    return this.items[0];
  }

  push(value: number): void {
    const items = this.items;
    items.push(value);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent]! <= items[index]!) break;
      const swap = items[parent]!;
      items[parent] = items[index]!;
      items[index] = swap;
      index = parent;
    }
  }

  /** The minimum, removed. Throws when empty: popping nothing is a bug here. */
  pop(): number {
    const items = this.items;
    const top = items[0];
    if (top === undefined) throw new Error("Cannot pop an empty heap");

    const last = items.pop()!;
    if (items.length === 0) return top;

    items[0] = last;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < items.length && items[left]! < items[smallest]!) smallest = left;
      if (right < items.length && items[right]! < items[smallest]!) smallest = right;
      if (smallest === index) break;
      const swap = items[smallest]!;
      items[smallest] = items[index]!;
      items[index] = swap;
      index = smallest;
    }
    return top;
  }
}

/**
 * How many ordinals a packed schedule key reserves. A run's WIP list is
 * thousands of parts at its worst; a million is headroom the packing can
 * afford, since `tick · 2²⁰` stays an exact integer past 8·10⁹ ticks — some
 * 290,000 staffed days.
 */
const ORDINAL_SPACE = 1 << 20;

/** `(tick, ordinal)` as one number, ordered by tick and then by list position. */
export function scheduleKey(tickNum: number, ordinal: number): number {
  if (ordinal < 0 || ordinal >= ORDINAL_SPACE) {
    throw new Error(
      `WIP ordinal ${ordinal} does not fit a schedule key (limit ${ORDINAL_SPACE})`,
    );
  }
  return tickNum * ORDINAL_SPACE + ordinal;
}

export const keyTick = (key: number): number => Math.floor(key / ORDINAL_SPACE);

export const keyOrdinal = (key: number): number => key % ORDINAL_SPACE;
