import { useState, useEffect } from "react";
import { simulateTick } from "./simulation/simulationTick";
import WorkCenterCard from "./components/WorkCenterCard";
import type { WorkCenter, DbWorkCenter } from "./types/WorkCenter";
import type { Part } from "./types/Part.ts";
import PartsList from "./components/PartsList";
type SimulationState = {
  workCenters: WorkCenter[];
  finishedParts: number;
};

function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [partsList, setPartsList] = useState<Part[]>([]);
  const [simulationState, setSimulationState] = useState<SimulationState>({
    workCenters: [],
    finishedParts: 0,
  });

  const productionOrder = [1, 2, 3, 4, 5, 6];

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      setSimulationState((currentSimulation) => {
        const tickData = simulateTick(
          currentSimulation.workCenters,
          productionOrder,
        );

        return {
          workCenters: tickData.updatedWorkCenters,
          finishedParts:
            currentSimulation.finishedParts + tickData.finishedParts,
        };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning]);

  useEffect(() => {
    async function loadParts() {
      try {
        const response = await fetch("http://localhost:3000/api/parts");
        if (!response.ok) {
          throw new Error("Failed to load parts");
        }

        const data: Part[] = await response.json();
        setPartsList(data);
      } catch (error) {
        console.error("Failed fetching Parts List", error);
      }
    }
    loadParts();
  }, []);

  const toggleSimulation = () => {
    setIsRunning((prev) => !prev);
  };

  const resetSimulation = () => {
    setIsRunning(false);
    setSimulationState((prev) => ({
      ...prev,
      workCenters: prev.workCenters.map((wc) => ({
        ...wc,
        queueCount: 0,
        status: "Idle",
        progressSeconds: 0,
      })),
      finishedParts: 0,
    }));
  };
  const releaseOrder = () => {
    setSimulationState((prev) => ({
      ...prev,
      workCenters: prev.workCenters.map((wc) =>
        wc.id === 1 ? { ...wc, queueCount: 50 } : wc,
      ),
    }));
  };
  useEffect(() => {
    async function loadWorkCenters() {
      try {
        const response = await fetch("http://localhost:3000/api/work-centers");

        if (!response.ok) {
          throw new Error("Failed to load work centers");
        }
        const data: DbWorkCenter[] = await response.json();
        const workCentersWithState: WorkCenter[] = data.map((wc) => ({
          ...wc,
          queueCount: 0,
          status: "Idle",
          progressSeconds: 0,
          processTimeSeconds: 3,
        }));
        setSimulationState((prev) => ({
          ...prev,
          workCenters: workCentersWithState,
        }));
        setIsLoading(false);
      } catch (error) {
        console.error("Failed to load work centers. Error: ", error);
        setIsLoading(false);
      }
    }
    loadWorkCenters();
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center gap-4 bg-slate-100 p-6">
      <h1 className="text-3xl font-bold">Factory Simulator</h1>

      <div className="grid grid-cols-3 gap-4">
        {isLoading ? (
          <p>Loading...</p>
        ) : (
          simulationState.workCenters.map((workCenter) => (
            <WorkCenterCard key={workCenter.id} {...workCenter} />
          ))
        )}
      </div>

      <div>Completed Parts: {simulationState.finishedParts}</div>

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

        <button
          className="bg-green-500 text-white p-2 rounded-lg"
          onClick={releaseOrder}
        >
          Release Order
        </button>
      </div>
      <div className="flex gap-4">
        <PartsList parts={partsList} />
      </div>
    </div>
  );
}

export default App;
