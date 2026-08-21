import type { RoutingStep } from "../types/Routing";

/**
 * A step being edited. Every field is a string because it comes straight from
 * an input; parseSteps turns a list into the payload or explains what's wrong.
 */
export type StepDraft = {
  workCenterId: string;
  processTimeSeconds: string;
  setupTimeSeconds: string;
};

export type StepPayload = {
  workCenterId: number;
  processTimeSeconds: number;
  setupTimeSeconds: number;
};

export function emptyStep(): StepDraft {
  return { workCenterId: "", processTimeSeconds: "", setupTimeSeconds: "0" };
}

/** Existing steps arrive sequenced; the editor works in array order instead. */
export function toDrafts(steps: RoutingStep[]): StepDraft[] {
  return steps.map((step) => ({
    workCenterId: String(step.workCenterId),
    processTimeSeconds: String(step.processTimeSeconds),
    setupTimeSeconds: String(step.setupTimeSeconds),
  }));
}

/**
 * Move one step by `offset`. Out-of-range moves return the list unchanged, so
 * the caller can wire up/down buttons without bounds-checking at the call site.
 */
export function moveStep(
  steps: StepDraft[],
  index: number,
  offset: number,
): StepDraft[] {
  const target = index + offset;
  if (index < 0 || index >= steps.length) return steps;
  if (target < 0 || target >= steps.length) return steps;

  const next = [...steps];
  const moved = next[index];
  const displaced = next[target];
  if (!moved || !displaced) return steps;
  next[index] = displaced;
  next[target] = moved;
  return next;
}

export function removeStep(steps: StepDraft[], index: number): StepDraft[] {
  return steps.filter((_step, position) => position !== index);
}

export type ParseResult =
  | { ok: true; steps: StepPayload[] }
  | { ok: false; message: string };

/**
 * Validate the whole list before submitting. Reports by 1-based position,
 * matching what the editor shows, so the message points at a visible row.
 * Sequence numbers are never sent - the server derives them from array order.
 */
export function parseSteps(drafts: StepDraft[]): ParseResult {
  if (drafts.length === 0) {
    return { ok: false, message: "A routing needs at least one step" };
  }

  const steps: StepPayload[] = [];

  for (let index = 0; index < drafts.length; index++) {
    const draft = drafts[index];
    if (!draft) continue;
    const position = index + 1;

    const workCenterId = Number(draft.workCenterId);
    if (!draft.workCenterId || !Number.isInteger(workCenterId)) {
      return { ok: false, message: `Step ${position}: choose a work center` };
    }

    const processTimeSeconds = Number(draft.processTimeSeconds);
    if (
      !Number.isInteger(processTimeSeconds) ||
      processTimeSeconds < 1 ||
      draft.processTimeSeconds === ""
    ) {
      return {
        ok: false,
        message: `Step ${position}: process time must be a whole number above zero`,
      };
    }

    const setupTimeSeconds = Number(draft.setupTimeSeconds);
    if (
      !Number.isInteger(setupTimeSeconds) ||
      setupTimeSeconds < 0 ||
      draft.setupTimeSeconds === ""
    ) {
      return {
        ok: false,
        message: `Step ${position}: setup time must be zero or a whole number above it`,
      };
    }

    steps.push({ workCenterId, processTimeSeconds, setupTimeSeconds });
  }

  return { ok: true, steps };
}
