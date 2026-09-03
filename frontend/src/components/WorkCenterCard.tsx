import { Factory } from "lucide-react";
import type { FloorWorkCenter } from "../api/runs";

/**
 * One work center on the floor of the run being watched.
 *
 * Capacity is read-only here. A run freezes the capacities it was created
 * with, so editing the live work center would change nothing about the run on
 * screen — the number shown is the run's own. Change it in Factory Setup and
 * it applies to the next run created.
 *
 * There is no "% utilized" any more either. It used to show
 * `slotsInUse / capacity`, which for one machine can only read 0% or 100% and
 * flickers between them every few ticks; utilization is a rate over a window
 * and lives on the run's metrics, not on a snapshot of one instant.
 */
function WorkCenterCard({ center }: { center: FloorWorkCenter }) {
  const { name, capacity, partsAtStation, slots, slotsInUse } = center;
  const isRunning = slotsInUse > 0;
  const waiting = Math.max(0, partsAtStation - slotsInUse);

  return (
    <div className="flex flex-col gap-3 items-center border-2 border-black rounded-lg p-6 w-72">
      <p className="flex gap-2 items-center font-medium">
        <Factory size={20} /> {name}
      </p>

      <div className="w-full flex flex-col gap-1.5">
        {slots.map((percentFinished, slotIndex) => (
          <div
            key={slotIndex}
            className="w-full h-3 bg-slate-200 rounded-full overflow-hidden"
          >
            <div
              className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                percentFinished === null ? "bg-slate-300" : "bg-blue-500"
              }`}
              style={{ width: `${percentFinished ?? 0}%` }}
            />
          </div>
        ))}
      </div>

      <div className="flex gap-3 text-sm">
        <span className={isRunning ? "text-green-600" : "text-slate-400"}>
          {isRunning ? "Running" : "Starved"}
        </span>
        <span className="text-slate-500 tabular-nums">
          {slotsInUse}/{capacity} machines
        </span>
      </div>

      <div className="text-sm text-slate-500 tabular-nums">
        {partsAtStation} at station · {waiting} waiting
      </div>
    </div>
  );
}

export default WorkCenterCard;
