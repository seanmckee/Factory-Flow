import { useState } from "react";
import { Factory } from "lucide-react";
import type { WorkCenter, WorkCenterStatus } from "../types/WorkCenter";

function WorkCenterCard({
  name,
  queueCount,
  status,
  processTimeSeconds,
  progressSeconds,
}: WorkCenter) {
  let statusColor =
    status === "Running"
      ? "text-yellow-500"
      : status === "Idle"
        ? "text-green-500"
        : status === "Blocked"
          ? "text-red-500"
          : status === "Starved"
            ? "text-blue-500"
            : "text-slate-500";
  const progressPercent = (progressSeconds / processTimeSeconds) * 100;

  return (
    <div>
      <div className="flex flex-col gap-2 border-2 border-black rounded-lg p-6 items-center w-72 h-45">
        <p className="flex gap-2 items-center">
          <Factory /> {name}
        </p>
        <div className="flex flex-col gap-2 p-6">
          <p className="flex gap-2 items-center">Queue Count: {queueCount}</p>
          <p className={statusColor}>Status: {status}</p>
          <div className="h-2 w-full bg-slate-200 rounded">
            <div
              className="h-2 bg-blue-500 rounded transition-all duration-300 ease_linear"
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WorkCenterCard;
