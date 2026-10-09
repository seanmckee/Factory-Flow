import { TICKS_PER_DAY, formatTickTime } from "./simTime";

/** A staffed hour, and the granularity every decision below is made at. */
export const TICKS_PER_HOUR = 3_600;

/**
 * The stops on the horizon scrubber.
 *
 * A **stepped** scale rather than a free range, because the useful span is
 * three orders of magnitude: a linear slider from one hour to sixty days gives
 * the whole first day 1.6% of its track, which is not a control, it is a dare.
 * The steps are the scrubber — every position is a horizon somebody would
 * actually ask for, and the readout says where it lands.
 *
 * Hours are staffed hours; days are the **run's** own `day_ticks`, so a
 * two-shift run's "1 day" is twice the ticks of a one-shift run's and both
 * land on the same calendar boundary. That is the only honest reading of a
 * day on a page whose clock is staffed time.
 *
 * Which is why the hour stops end at **6**, not 8 or 12: a one-shift day is
 * 8 staffed hours, so an "8 hours" stop would land on exactly the same tick as
 * "1 day" for that run, and a "12 hours" stop would sort *after* it. Two
 * positions that mean one thing — or that run backwards — is a broken track,
 * and the scale cannot change shape per run without the labels lying.
 */
export const JUMP_HORIZONS = [
  { label: "1 hour", hours: 1 },
  { label: "2 hours", hours: 2 },
  { label: "4 hours", hours: 4 },
  { label: "6 hours", hours: 6 },
  { label: "1 day", days: 1 },
  { label: "2 days", days: 2 },
  { label: "3 days", days: 3 },
  { label: "5 days", days: 5 },
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "3 weeks", days: 21 },
  { label: "30 days", days: 30 },
  { label: "45 days", days: 45 },
  { label: "60 days", days: 60 },
] as const satisfies readonly { label: string; hours?: number; days?: number }[];

/** The default position: one day, the horizon the old presets topped out at. */
export const DEFAULT_HORIZON_INDEX = JUMP_HORIZONS.findIndex(
  (horizon) => horizon.label === "1 day",
);

export function horizonTicks(index: number, dayTicks: number): number {
  const horizon = JUMP_HORIZONS[clampHorizon(index)]!;
  return "days" in horizon
    ? horizon.days * (dayTicks > 0 ? dayTicks : TICKS_PER_DAY)
    : horizon.hours * TICKS_PER_HOUR;
}

export function horizonLabel(index: number): string {
  return JUMP_HORIZONS[clampHorizon(index)]!.label;
}

export const clampHorizon = (index: number): number =>
  Math.min(JUMP_HORIZONS.length - 1, Math.max(0, Math.round(index)));

/**
 * What the run looks like at a committed hour boundary — the only moments a
 * jump can see, since it advances in `TICKS_PER_BATCH` chunks and a stop lands
 * on a boundary the server has already committed rather than aborting in
 * flight. Everything here comes off the advance's own answer, so nothing below
 * costs a request.
 */
export type JumpProbe = {
  tickNum: number;
  wipCount: number;
  /** orders the run's policy could still release; always 0 under `manual` */
  backlogCount: number;
  /** units ruined since the jump began, not over the run */
  scrappedSoFar: number;
  /**
   * The run's net cents as of this boundary. Accumulated client-side from each
   * advance's four money lines, which is **exact** rather than an estimate: a
   * capital action is the only other term in the net, and it cannot land
   * mid-jump because the jump holds the run's lock for its whole duration.
   */
  netCents: number;
};

/**
 * What the jump watches for besides its horizon — an **early exit**, never the
 * only bound. A condition with no horizon is a run that might never stop, and
 * "it is still going" is not an answer a factory question has; the scrubber
 * supplies the ceiling and this supplies the reason to land sooner.
 */
export type JumpCondition =
  | { kind: "none" }
  | { kind: "floorDrained" }
  | { kind: "backlogClear" }
  | { kind: "wipAbove"; value: number }
  | { kind: "wipBelow"; value: number }
  | { kind: "netPositive" }
  | { kind: "scrapAtLeast"; value: number };

export type JumpConditionKind = JumpCondition["kind"];

/** The picker's rows: what each condition means, and whether it takes a number. */
export const JUMP_CONDITIONS: {
  kind: JumpConditionKind;
  label: string;
  hint: string;
  needsValue: boolean;
}[] = [
  {
    kind: "none",
    label: "Run the whole horizon",
    hint: "Stops only at the horizon, or when the floor can no longer be fed.",
    needsValue: false,
  },
  {
    kind: "floorDrained",
    label: "The floor empties",
    hint: "Nothing left in process and nothing the policy could still release. An idle factory still pays rent, so this is a stopping point, not a goal.",
    needsValue: false,
  },
  {
    kind: "backlogClear",
    label: "The backlog clears",
    hint: "The policy has released everything it can. Work is still on the floor.",
    needsValue: false,
  },
  {
    kind: "wipAbove",
    label: "WIP rises above",
    hint: "The floor is filling faster than the constraint drains it.",
    needsValue: true,
  },
  {
    kind: "wipBelow",
    label: "WIP falls below",
    hint: "The floor is draining — the constraint is about to starve.",
    needsValue: true,
  },
  {
    kind: "netPositive",
    label: "Net profit turns positive",
    hint: "The run has earned back what it has spent. Payback, read off the score itself.",
    needsValue: false,
  },
  {
    kind: "scrapAtLeast",
    label: "Units scrapped reaches",
    hint: "Counted from the start of this jump, not over the run.",
    needsValue: true,
  },
];

/**
 * Whether the condition holds, at one boundary.
 *
 * Checked at each committed hour, so a jump stops at the **first hour boundary
 * where it holds** rather than the tick it became true — the same granularity
 * Stop already lands on, and the same reason: the server commits a batch
 * whether or not anyone is still listening.
 *
 * The dialog runs this against the run as it stands too, which is how it can
 * say a condition is already met before you spend a jump discovering it.
 */
export function conditionMet(condition: JumpCondition, probe: JumpProbe): boolean {
  switch (condition.kind) {
    case "none":
      return false;
    case "floorDrained":
      return probe.wipCount === 0 && probe.backlogCount === 0;
    case "backlogClear":
      return probe.backlogCount === 0;
    case "wipAbove":
      return probe.wipCount > condition.value;
    case "wipBelow":
      return probe.wipCount < condition.value;
    case "netPositive":
      return probe.netCents > 0;
    case "scrapAtLeast":
      return probe.scrappedSoFar >= condition.value;
  }
}

/** As much of a probe as a run summary can answer on its own. */
export type RunSnapshot = { wipCount: number; netCents: number };

/**
 * Whether the condition already holds of the run as it stands — and `null`
 * when the summary cannot say.
 *
 * `backlogCount` is reported only by an advance, so the two backlog-shaped
 * conditions are genuinely unknown until the jump runs; a dialog that guessed
 * would be guessing about the very thing it was asked to watch. Scrap is
 * counted from the start of the jump, so it is never already met. The rest are
 * answerable, and worth answering: "run until WIP falls below 200" on a floor
 * of 120 stops at the first hour, and finding that out before spending a jump
 * is the point.
 */
export function alreadyMet(
  condition: JumpCondition,
  run: RunSnapshot,
): boolean | null {
  switch (condition.kind) {
    case "none":
    case "scrapAtLeast":
      return false;
    case "floorDrained":
    case "backlogClear":
      return null;
    case "wipAbove":
    case "wipBelow":
    case "netPositive":
      return conditionMet(condition, {
        tickNum: 0,
        wipCount: run.wipCount,
        backlogCount: 0,
        scrappedSoFar: 0,
        netCents: run.netCents,
      });
  }
}

/** Why a jump ended. `stopped` is the person; the rest are the run. */
export type JumpOutcome =
  | { kind: "horizon" }
  | { kind: "stopped" }
  | { kind: "drained" }
  | { kind: "condition"; condition: JumpCondition };

/**
 * One sentence naming where the run landed and what put it there. Every ending
 * says the Day · time, because "it stopped" without a when is not a result.
 */
export function describeStop(
  outcome: JumpOutcome,
  probe: JumpProbe,
  dayTicks: number,
): string {
  const at = formatTickTime(probe.tickNum, dayTicks);
  switch (outcome.kind) {
    case "horizon":
      return `Reached the horizon at ${at}`;
    case "stopped":
      return `Stopped at ${at}`;
    case "drained":
      return `Floor emptied at ${at} — nothing left to release`;
    case "condition":
      return `${conditionSentence(outcome.condition, probe)} at ${at}`;
  }
}

function conditionSentence(condition: JumpCondition, probe: JumpProbe): string {
  switch (condition.kind) {
    case "none":
      return "Stopped";
    case "floorDrained":
      return "Floor emptied";
    case "backlogClear":
      return "Backlog cleared";
    case "wipAbove":
      return `WIP rose to ${probe.wipCount}, above ${condition.value},`;
    case "wipBelow":
      return `WIP fell to ${probe.wipCount}, below ${condition.value},`;
    case "netPositive":
      return "Net profit turned positive";
    case "scrapAtLeast":
      return `${probe.scrappedSoFar} units scrapped`;
  }
}
