import { useState, useEffect } from "react";
import { simulateTick } from "./simulation/simulationTick";
import WorkCenterCard from "./components/WorkCenterCard";
import type { WorkCenter } from "./types/WorkCenter";
import { initialWorkCenters } from "./data/workCenters";
function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [workCenterData, setWorkCenterData] =
    useState<WorkCenter[]>(initialWorkCenters);
  const productionOrder = [1, 2, 3, 4, 5, 6];
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      // setWorkCenterData((currentWorkCenters) =>
      //   currentWorkCenters.map((workCenter) => ({
      //     ...workCenter,
      //     queueCount: Math.max(0, workCenter.queueCount - 1),
      //   })),
      // );
      setWorkCenterData((workCenterData) =>
        simulateTick(workCenterData, productionOrder),
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning]);
  const toggleSimulation = () => {
    setIsRunning((prev) => !prev);
  };
  const resetSimulation = () => {
    setWorkCenterData(initialWorkCenters);
  };
  return (
    <>
      <div className="min-h-screen flex flex-col items-center gap-4 bg-slate-100 p-6">
        <h1 className="text-3xl font-bold">Factory Simulator</h1>
        <div className="grid grid-cols-3 gap-4">
          {workCenterData.map((workCenter) => {
            return <WorkCenterCard key={workCenter.name} {...workCenter} />;
          })}
        </div>
        <div className="flex gap-4">
          <button
            className="bg-blue-500 text-white p-2 rounded-lg"
            onClick={toggleSimulation}
          >
            {isRunning ? "Stop Simulation" : "Start Simulation"}
          </button>
          <button
            className="bg-slate-500 text-white p-2 rounded-lg"
            onClick={resetSimulation}
          >
            Reset Simulation
          </button>
        </div>
      </div>
    </>
  );
}

export default App;
