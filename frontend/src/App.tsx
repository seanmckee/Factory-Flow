import { useState, useEffect } from "react";
import { simulateTick } from "./simulation/simulationTick";
import WorkCenterCard from "./components/WorkCenterCard";
import type { WorkCenter, DbWorkCenter } from "./types/WorkCenter";
import type { Part } from "./types/Part.ts";
import PartsList from "./components/PartsList";
import type { WipPart } from "./types/WipPart.ts";
import type { Routing } from "./types/Routing";
import { sampleProcessTime } from "./simulation/sampleProcessTime.ts";
type SimulationState = {
  wipParts: WipPart[];
  finishedParts: number;
};

function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [partsList, setPartsList] = useState<Part[]>([]);
  const [simulationState, setSimulationState] = useState<SimulationState>({
    wipParts: [],
    finishedParts: 0,
  });
  const [routing, setRouting] = useState<Routing | null>(null);

  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  //  const productionOrder = [1, 2, 3, 4, 5, 6];
  useEffect(() => {
    async function loadRouting() {
      try {
        const response = await fetch("http://localhost:3000/api/routings/2");
        if (!response.ok) throw new Error("Failed to load routing");
        const data: Routing = await response.json();
        setRouting(data);
      } catch (error) {
        console.error("Failed fetching routing", error);
      }
    }
    loadRouting();
  }, []);
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      setSimulationState((currentSimulation) => {
        if (!routing) return currentSimulation;
        const tickData = simulateTick(currentSimulation.wipParts, routing);

        return {
          wipParts: tickData.wipParts,
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
    setSimulationState({ wipParts: [], finishedParts: 0 });
  };
  const deriveWorkCenterView = (
    wipParts: WipPart[],
    routing: Routing,
  ): Map<number, number> => {
    // workCenterId -> queueCount
    const counts = new Map<number, number>();

    for (const wipPart of wipParts) {
      const workCenterId = routing.steps[wipPart.stepIndex].workCenterId;
      const current = counts.get(workCenterId) ?? 0;
      counts.set(workCenterId, current + 1);
    }

    return counts;
  };
  const releaseOrder = () => {
    if (!routing) return;
    const newParts: WipPart[] = [];
    const firstStep = routing.steps[0];
    for (let i = 0; i < 10; i++) {
      newParts.push({
        id: Date.now() + i,
        workOrderId: 1,
        stepIndex: 0,
        progressSeconds: 0,
        actualProcessTimeSeconds: sampleProcessTime(
          firstStep.processTimeSeconds,
          0.3,
        ),
      });
    }
    setSimulationState((prev) => ({
      ...prev,
      wipParts: [...prev.wipParts, ...newParts],
    }));
  };
  useEffect(() => {
    async function loadWorkCenters() {
      try {
        const response = await fetch("http://localhost:3000/api/work-centers");

        if (!response.ok) {
          throw new Error("Failed to load work centers");
        }
        const data: WorkCenter[] = await response.json();
        setWorkCenters(data);
        setIsLoading(false);
      } catch (error) {
        console.error("Failed to load work centers. Error: ", error);
        setIsLoading(false);
      }
    }
    loadWorkCenters();
  }, []);
  const view = routing
    ? deriveWorkCenterView(simulationState.wipParts, routing)
    : new Map<number, number>();
  return (
    <div className="min-h-screen flex flex-col items-center gap-4 bg-slate-100 p-6">
      <h1 className="text-3xl font-bold">Factory Simulator</h1>

      <div className="grid grid-cols-3 gap-4">
        {isLoading ? (
          <p>Loading...</p>
        ) : (
          workCenters.map((workCenter) => {
            return (
              <WorkCenterCard
                key={workCenter.id}
                name={workCenter.name}
                queueCount={view.get(workCenter.id) ?? 0}
              />
            );
          })
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
