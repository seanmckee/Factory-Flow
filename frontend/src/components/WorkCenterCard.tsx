import { useState, useEffect, useRef } from "react";
import { Factory } from "lucide-react";
import type { WorkCenterView } from "../types/WorkCenter";

type WorkCenterCardProps = {
  name: string;
  workCenterData: WorkCenterView;
};

type Phase = "normal" | "flash" | "resetting";

function WorkCenterCard({ name, workCenterData }: WorkCenterCardProps) {
  const { partsAtStation, percentFinished } = workCenterData;
  const isRunning = partsAtStation > 0;
  const waiting = Math.max(0, partsAtStation - 1);

  const [phase, setPhase] = useState<Phase>("normal");
  const [width, setWidth] = useState(percentFinished);
  const prev = useRef(percentFinished);

  useEffect(() => {
    const dropped = percentFinished < prev.current;
    prev.current = percentFinished;

    if (!dropped) {
      setPhase("normal");
      setWidth(percentFinished);
      return;
    }

    setPhase("flash");
    setWidth(100);

    const fill = setTimeout(() => {
      setPhase("resetting");
      setWidth(percentFinished);
    }, 300);
    const done = setTimeout(() => setPhase("normal"), 360);

    return () => {
      clearTimeout(fill);
      clearTimeout(done);
    };
  }, [percentFinished]);

  const barTransition =
    phase === "normal" ? "transition-all duration-1000 ease-linear" : "";

  const barColor =
    phase === "flash"
      ? "bg-green-500"
      : isRunning
        ? "bg-blue-500"
        : "bg-slate-300";

  return (
    <div className="flex flex-col gap-3 items-center border-2 border-black rounded-lg p-6 w-72">
      <p className="flex gap-2 items-center font-medium">
        <Factory size={20} /> {name}
      </p>

      <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${barTransition} ${barColor}`}
          style={{ width: `${width}%` }}
        />
      </div>

      <div className="flex gap-3 text-sm">
        <span className={isRunning ? "text-green-600" : "text-slate-400"}>
          {isRunning ? "Running" : "Starved"}
        </span>
        <span className="text-slate-500 tabular-nums">
          {partsAtStation} at station · {waiting} waiting
        </span>
      </div>
    </div>
  );
}

export default WorkCenterCard;
