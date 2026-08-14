import { useState, useEffect, useRef } from "react";
import { simulateTick } from "../simulation/simulationTick";
import WorkCenterCard from "../components/WorkCenterCard";
import type { WorkCenter, WorkCenterView } from "../types/WorkCenter";
import type { WipPart } from "../types/WipPart.ts";
import type { Routing } from "../types/Routing";
import { sampleProcessTime } from "../simulation/sampleProcessTime.ts";
import type { WorkOrder } from "../types/WorkOrder.ts";
import ThroughputChart from "../components/ThroughputChart.tsx";
type SimulationState = {
  wipParts: WipPart[];
  finishedParts: WipPart[];
  tickNum: number;
};

function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [simulationState, setSimulationState] = useState<SimulationState>({
    wipParts: [],
    finishedParts: [],
    tickNum: 0,  
  });
  const [routings, setRoutings] = useState<Map<number, Routing>>(new Map());
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);

  const [throughputHistory, setThroughputHistory] = useState<
    { tick: number; cents: number }[]
  >([]);


  const routingsRef = useRef(routings);
  useEffect(() => {
    routingsRef.current = routings;
  }, [routings]);
  useEffect(() => {
    async function loadWorkOrders() {
      try {
        const response = await fetch("http://localhost:3000/api/work-orders");

        if (!response.ok) throw new Error("Failed to load work orders");
        const data: WorkOrder[] = await response.json();
        setWorkOrders(data);
        console.log(data);
      } catch (error) {
        console.error("Failed fetching work orders", error);
      }
    }
    loadWorkOrders();
  }, []);
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      setSimulationState((currentSimulation) => {
        const nextTick = currentSimulation.tickNum + 1;
        const tickData = simulateTick(
          currentSimulation.wipParts,
          routingsRef.current,
          nextTick,
        );
    
        setThroughputHistory((prev) =>
          [...prev, { tick: nextTick, cents: tickData.finishedParts.length * 3000 }]
            .slice(-120),
        );
    
        return {
          wipParts: tickData.wipParts,
          finishedParts: [
            ...currentSimulation.finishedParts,
            ...tickData.finishedParts,
          ],
          tickNum: nextTick,
        };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning]);

  const toggleSimulation = () => {
    setIsRunning((prev) => !prev);
  };

  const resetSimulation = () => {
    setIsRunning(false);
    setSimulationState({ wipParts: [], finishedParts: [], tickNum: 0 });
  };
  const deriveWorkCenterView = (
    wipParts: WipPart[],
    routings: Map<number, Routing>,
  ): Map<number, WorkCenterView> => {
    // workCenterId -> partsAtStation
    // workCenterId -> WorkCenterView (partsAtStation, percentFinished)
    const counts = new Map<number, WorkCenterView>();

    for (const wipPart of wipParts) {
      const partRouting = routings.get(wipPart.routingId);
      if (!partRouting) continue;
      const workCenterId = partRouting.steps[wipPart.stepIndex].workCenterId;
      const existing = counts.get(workCenterId);
      counts.set(workCenterId, {
        partsAtStation: (existing?.partsAtStation ?? 0) + 1,
        percentFinished:
          wipPart.progressSeconds > 0
            ? Math.round(
                (wipPart.progressSeconds / wipPart.actualProcessTimeSeconds) *
                  100,
              )
            : (existing?.percentFinished ?? 0),
      });
    }
    return counts;
  };
  const releaseOrder = async () => {
    const order = workOrders.find((wo) => wo.id === selectedOrderId);
    if (!order) {
      alert("Please Select a Work Order to Release");
      return;
    }
    let fetchedRouting: Routing | null = null;
    try {
      const response = await fetch(
        `http://localhost:3000/api/routings/${order.routingId}`,
      );
      if (!response.ok) throw new Error("Failed to load routing");
      const data: Routing = await response.json();
      setRoutings((prev) => new Map(prev).set(order.routingId, data));
      fetchedRouting = data;
    } catch (error) {
      console.error("Failed fetching routing", error);
      return;
    }
    const newParts: WipPart[] = [];
    const firstStep = fetchedRouting.steps[0];
    for (let i = 0; i < order.quantity; i++) {
      newParts.push({
        id: crypto.randomUUID(),
        workOrderId: order.id,
        routingId: order.routingId,
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

  const view = deriveWorkCenterView(simulationState.wipParts, routings);
  const workOrderById = new Map(workOrders.map((wo) => [wo.id, wo]));
  const finishedByWorkOrder = new Map<number, number>();
  for (const fp of simulationState.finishedParts) {
    finishedByWorkOrder.set(
      fp.workOrderId,
      (finishedByWorkOrder.get(fp.workOrderId) ?? 0) + 1,
    );
  }
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
                workCenterData={
                  view.get(workCenter.id) ?? {
                    partsAtStation: 0,
                    percentFinished: 0,
                  }
                }
              />
            );
          })
        )}
      </div>

      <div>
        {[...finishedByWorkOrder].map(([workOrderId, qty]) => {
          const wo = workOrderById.get(workOrderId);
          return (
            <div key={workOrderId}>
              {wo?.orderNumber} ({wo?.partName}): {qty}
            </div>
          );
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

        <button
          className="bg-green-500 text-white p-2 rounded-lg"
          onClick={releaseOrder}
        >
          Release Order
        </button>
      </div>
      <div>TickNum: {simulationState.tickNum}</div>
      <div className="w-full max-w-3xl">
      <ThroughputChart data={throughputHistory} />
</div>
      <div>
        <div className="flex gap-4 items-center">
          <select
            value={selectedOrderId ?? ""}
            onChange={(e) =>
              setSelectedOrderId(e.target.value ? Number(e.target.value) : null)
            }
            className="border border-slate-300 rounded-lg p-2 bg-white"
          >
            <option value="">Select a work order</option>
            {workOrders.map((workOrder) => (
              <option key={workOrder.id} value={workOrder.id}>
                {workOrder.orderNumber} · {workOrder.partName} · qty{" "}
                {workOrder.quantity}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

export default App;
