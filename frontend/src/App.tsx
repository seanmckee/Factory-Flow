import { useState } from "react";

import WorkCenterCard from "./components/WorkCenterCard";
import type { WorkCenter } from "./types/WorkCenter";

function App() {
  const [workCenterData, setWorkCenterData] = useState<WorkCenter[]>([
    { name: "Raw Material", queueCount: 10, status: "Idle" },
    { name: "Cutter", queueCount: 5, status: "Busy" },
    { name: "Finisher", queueCount: 0, status: "Idle" },
    { name: "Test", queueCount: 100, status: "Blocked" },
  ]);

  const startSimulation = () => {
    console.log("Simulation started");
    const newWorkCenterData = workCenterData.map((workCenter) => {
      return {
        ...workCenter,
        queueCount: Math.max(0, workCenter.queueCount - 1),
      };
    });
    setWorkCenterData(newWorkCenterData);
  };
  return (
    <>
      <div className="min-h-screen flex flex-col items-center gap-4 bg-slate-100 p-6">
        <h1 className="text-3xl font-bold">Factory Simulator</h1>
        <div className="flex gap-4">
          {workCenterData.map((workCenter) => {
            return <WorkCenterCard key={workCenter.name} {...workCenter} />;
          })}
        </div>
        <button
          className="bg-blue-500 text-white p-2 rounded-lg"
          onClick={startSimulation}
        >
          Start Simulation
        </button>
      </div>
    </>
  );
}

export default App;
