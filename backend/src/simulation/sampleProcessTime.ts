/**
 * The statistical variation that is the point of the model: every operation
 * takes a little more or less time than its routing says, so a balanced line
 * still starves and blocks.
 *
 * Unlike the frontend original this draws no randomness at call time. The value
 * is a pure function of `(seed, workOrderId, unitIndex, stepIndex)`, so a run
 * persists a single `rng_seed` and nothing else: replaying it, or forking it at
 * a checkpoint, reproduces every draw exactly with no cursor to restore. A
 * comparison between runs then measures the decision that changed rather than a
 * different noise stream.
 */

/** No operation ever takes less than a second. */
const MIN_DURATION = 1;

/** ±30% around the routing's nominal time, the value the engine has always used. */
export const PROCESS_TIME_DEVIATION = 0.3;

/**
 * Identifies one draw: the nth unit of a work order, at one step of its route.
 *
 * Deliberately *not* the part's uuid, which the engine used until it turned out
 * to defeat the seed — uuids are minted fresh at every release, so two runs
 * created with the same seed drew different noise and a comparison between them
 * measured the dice rather than the decision. A work order can only be released
 * once into a run, so this names exactly one part within a run, and two runs
 * agree on it by construction.
 *
 * The run id is *not* part of the key, and must not be: two runs agreeing on
 * their noise is the whole point.
 */
export type DrawKey = {
  seed: number;
  workOrderId: number;
  /** 0-based position of this part within its work order's quantity */
  unitIndex: number;
  stepIndex: number;
};

/** FNV-1a, 32-bit. Cheap, and mixes short ASCII keys well enough to then avalanche. */
function fnv1a(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * murmur3's finalizer. FNV alone leaves neighbouring keys correlated in the low
 * bits, which matters here because consecutive step indices differ by one; this
 * spreads a single bit change across the whole word.
 */
function avalanche(hash: number): number {
  let h = hash;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform in [0, 1), the drop-in replacement for `Math.random()`. */
export function unitDraw({
  seed,
  workOrderId,
  unitIndex,
  stepIndex,
}: DrawKey): number {
  return (
    avalanche(fnv1a(`${seed}:${workOrderId}:${unitIndex}:${stepIndex}`)) /
    2 ** 32
  );
}

/**
 * The actual time this part will spend on this step: `nominalSeconds` scaled by
 * a uniform factor in `1 ± deviation`, rounded, and floored at one second.
 */
export function sampleProcessTime(
  nominalSeconds: number,
  deviation: number,
  key: DrawKey,
): number {
  const factor = 1 + (unitDraw(key) * 2 - 1) * deviation;
  return Math.max(MIN_DURATION, Math.round(nominalSeconds * factor));
}
