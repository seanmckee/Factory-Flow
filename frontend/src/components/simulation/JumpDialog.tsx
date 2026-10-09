import { useState } from "react";
import { FastForward, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Field } from "../ui/Field";
import {
  DEFAULT_HORIZON_INDEX,
  JUMP_CONDITIONS,
  JUMP_HORIZONS,
  alreadyMet,
  clampHorizon,
  horizonLabel,
  horizonTicks,
  type JumpCondition,
  type JumpConditionKind,
} from "../../simulation/jumpPlan";
import { TICKS_PER_DAY, formatTickTime } from "../../simulation/simTime";
import type { RunSummary } from "../../api/runs";

/**
 * How far to run, and what would make it stop sooner.
 *
 * A dialog rather than more buttons in the transport bar — the Capital and
 * Policy call — because choosing a horizon stopped being a three-button
 * question once the engine got fast enough to make sixty days as cheap as one.
 * The bar keeps the two jumps nobody needs a dialog for.
 *
 * The two halves compose rather than compete, which is why they are one
 * dialog: the scrubber is a **ceiling** and the condition an **early exit**. A
 * condition with no ceiling is a run that might never stop, and the horizon
 * alone is what the old presets already were.
 */
export function JumpDialog({
  open,
  onOpenChange,
  run,
  onRun,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: RunSummary | null;
  onRun: (ticks: number, condition: JumpCondition, label: string) => void;
  disabled: boolean;
}) {
  const [index, setIndex] = useState(DEFAULT_HORIZON_INDEX);
  const [kind, setKind] = useState<JumpConditionKind>("none");
  const [wipValue, setWipValue] = useState("200");
  const [scrapValue, setScrapValue] = useState("10");

  const dayTicks = run?.dayTicks ?? TICKS_PER_DAY;
  const ticks = horizonTicks(index, dayTicks);
  const label = horizonLabel(index);
  const row = JUMP_CONDITIONS.find((entry) => entry.kind === kind)!;
  const rawValue = kind === "scrapAtLeast" ? scrapValue : wipValue;
  const parsed = Number(rawValue);
  const valueOk = !row.needsValue || (Number.isFinite(parsed) && parsed >= 0);
  const condition = buildCondition(kind, parsed);

  const landsAt = run ? formatTickTime(run.tickNum + ticks, dayTicks) : null;
  const met = run && valueOk ? alreadyMet(condition, run) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Fast-forward</DialogTitle>
          <DialogDescription>
            {run
              ? `Running forward from ${formatTickTime(run.tickNum, dayTicks)}.`
              : "Pick a run first."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">Horizon</span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {label}
                {landsAt && ` · lands on ${landsAt}`}
              </span>
            </div>
            <Slider
              value={[index]}
              min={0}
              max={JUMP_HORIZONS.length - 1}
              step={1}
              onValueChange={([next]) => setIndex(clampHorizon(next ?? index))}
            />
            {/* the ends, so the track says what it spans without a drag */}
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{horizonLabel(0)}</span>
              <span>{horizonLabel(JUMP_HORIZONS.length - 1)}</span>
            </div>
          </div>

          <Field label="Stop early if">
            <Select value={kind} onValueChange={(value) => setKind(value as JumpConditionKind)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {JUMP_CONDITIONS.map((entry) => (
                  <SelectItem key={entry.kind} value={entry.kind}>{entry.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {row.needsValue && (
            <Field label={kind === "scrapAtLeast" ? "Units" : "Parts on the floor"}>
              <Input
                type="number"
                min={0}
                value={rawValue}
                onChange={(event) =>
                  kind === "scrapAtLeast"
                    ? setScrapValue(event.target.value)
                    : setWipValue(event.target.value)
                }
              />
            </Field>
          )}
          <p className="text-xs text-muted-foreground">{row.hint}</p>
          {kind !== "none" && (
            <p className="text-xs text-muted-foreground">
              Checked every simulated hour, so the run stops at the first hour
              boundary where it holds — the same boundary Stop lands on.
            </p>
          )}
          {met === true && (
            <p className="flex items-start gap-2 text-xs text-starved">
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              Already true of this run — the jump would stop after its first hour.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={disabled || run === null || !valueOk}
            onClick={() => {
              onRun(ticks, condition, label);
              onOpenChange(false);
            }}
          >
            <FastForward className="size-4" />
            Run {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildCondition(kind: JumpConditionKind, value: number): JumpCondition {
  switch (kind) {
    case "wipAbove":
    case "wipBelow":
    case "scrapAtLeast":
      return { kind, value };
    default:
      return { kind };
  }
}
