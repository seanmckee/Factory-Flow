import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { FloorWorkCenter } from "../api/runs";

/**
 * The floor as a table — one row per work center, so twenty centers read as a
 * list instead of a wall of cards. The parent owns the scroll region; this
 * stays a plain table with a sticky header.
 *
 * Three states, because /floor can honestly distinguish only three: Starved
 * (no machine busy), Running, and Saturated (every machine busy AND a queue —
 * a free machine always takes a waiting part, so waiting > 0 implies full).
 * "Blocked" is not representable here and is deliberately absent.
 *
 * Row order is stable (by name): the floor redraws every tick, and rows that
 * jump around under a live clock can't be watched. The queue signal lives in
 * the badge and the Waiting column, not in the ordering.
 * Capacity is the run's own frozen copy — **effective** capacity, so a centre
 * with two machines and one operator shows one slot, with the unstaffed
 * machine called out beside it: it is rent with no output, which is a mistake
 * worth seeing rather than hiding behind a smaller number. There is no
 * "% utilized" — an instantaneous slotsInUse/capacity reads only 0, ½ or 1;
 * utilization is a rate over a window and lives on the dashboard.
 */

type CenterState = "starved" | "running" | "saturated";

function stateOf(center: FloorWorkCenter): CenterState {
  if (center.slotsInUse === 0) return "starved";
  if (center.partsAtStation > center.slotsInUse) return "saturated";
  return "running";
}

const STATE_LABEL: Record<CenterState, string> = {
  starved: "Starved",
  running: "Running",
  saturated: "Saturated",
};

const STATE_CLASS: Record<CenterState, string> = {
  starved: "border-starved/40 bg-starved/10 text-starved",
  running: "border-running/40 bg-running/10 text-running",
  saturated: "border-saturated/40 bg-saturated/10 text-saturated",
};

/**
 * One full-width bar per machine, stacked. Side-by-side each bar would get
 * 1/capacity of the cell, so the same "60% done" would be a different length
 * on every row — a fill fraction is only readable against a constant width —
 * and a segmented row reads as one bar split into parts, not N machines.
 */
function SlotBars({ slots }: { slots: (number | null)[] }) {
  return (
    <div className="flex min-w-24 flex-col justify-center gap-1">
      {slots.map((percentFinished, slotIndex) => (
        <div
          key={slotIndex}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full transition-all duration-1000 ease-linear",
              percentFinished !== null && "bg-running",
            )}
            style={{ width: `${percentFinished ?? 0}%` }}
          />
        </div>
      ))}
    </div>
  );
}

export default function WorkCenterTable({
  centers,
}: {
  centers: FloorWorkCenter[];
}) {
  const sorted = [...centers].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-card">
        <TableRow>
          <TableHead>Work center</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Machines</TableHead>
          <TableHead className="w-1/4">Progress</TableHead>
          <TableHead className="text-right">At station</TableHead>
          <TableHead className="text-right">Waiting</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((center) => {
          const state = stateOf(center);
          const waiting = Math.max(0, center.partsAtStation - center.slotsInUse);
          return (
            <TableRow key={center.workCenterId}>
              <TableCell className="font-medium">{center.name}</TableCell>
              <TableCell>
                <Badge variant="outline" className={STATE_CLASS[state]}>
                  {STATE_LABEL[state]}
                </Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {center.slotsInUse}/{center.capacity}
                {center.machines !== center.operators && (
                  <span className="ml-1 text-starved">
                    {center.machines > center.operators
                      ? `+${center.machines - center.operators} unstaffed`
                      : `+${center.operators - center.machines} idle`}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <SlotBars slots={center.slots} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {center.partsAtStation}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  waiting > 0 ? "font-medium text-saturated" : "text-muted-foreground/60",
                )}
              >
                {waiting}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
