import { Factory } from "lucide-react";
import type { WorkCenterView } from "../types/WorkCenter";

type WorkCenterCardProps = {
  id: number;
  name: string;
  capacity: number;
  workCenterData: WorkCenterView;
  onCapacityChange: (id: number, capacity: number) => void;
};

function WorkCenterCard({
  id,
  name,
  capacity,
  workCenterData,
  onCapacityChange,
}: WorkCenterCardProps) {
  const { partsAtStation, slots, slotsInUse, utilization } = workCenterData;
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
          {Math.round(utilization * 100)}% utilized
        </span>
      </div>

      <div className="text-sm text-slate-500 tabular-nums">
        {partsAtStation} at station · {waiting} waiting
      </div>

      <label className="flex gap-2 items-center text-sm text-slate-600">
        Machines
        <input
          type="number"
          min={1}
          value={capacity}
          onChange={(e) => onCapacityChange(id, Number(e.target.value))}
          className="w-16 border border-slate-300 rounded-lg p-1 bg-white tabular-nums"
        />
      </label>
    </div>
  );
}

export default WorkCenterCard;
