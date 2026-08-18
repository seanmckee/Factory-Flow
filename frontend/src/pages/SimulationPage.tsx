import { useState, useEffect, useRef } from "react";
import { simulateTick } from "../simulation/simulationTick";
import WorkCenterCard from "../components/WorkCenterCard";
import type { WorkCenter, WorkCenterView } from "../types/WorkCenter";
import type { WipPart } from "../types/WipPart.ts";
import type { Routing } from "../types/Routing";
import { sampleProcessTime } from "../simulation/sampleProcessTime.ts";
import type { WorkOrder } from "../types/WorkOrder.ts";
import ThroughputChart from "../components/ThroughputChart.tsx";
import type { SalesOrder } from "../types/SalesOrder.ts";
import type { Part } from "../types/Part.ts";
import { calculateThroughput } from "../simulation/calculateThroughput.ts";
import { cumulativeThroughput } from "../simulation/cumulativeThroughput.ts";
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

  const workOrdersRef = useRef(workOrders);
  useEffect(() => {
    workOrdersRef.current = workOrders;
  }, [workOrders]);

  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);

  const workCentersRef = useRef<Map<number, WorkCenter>>(new Map());

  useEffect(() => {
    workCentersRef.current = new Map(workCenters.map((wc) => [wc.id, wc]));
  }, [workCenters]);

  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [parts, setParts] = useState<Part[]>([]);

  const partsRef = useRef(parts);

  useEffect(() => {
    partsRef.current = parts;
  }, [parts]);

  const salesOrdersRef = useRef(salesOrders);

  useEffect(() => {
    salesOrdersRef.current = salesOrders;
  }, [salesOrders]);

  const [throughputHistory, setThroughputHistory] = useState<
    { tick: number; cents: number }[]
  >([]);

  const routingsRef = useRef(routings);

  useEffect(() => {
    routingsRef.current = routings;
  }, [routings]);

  // runs on every mount, and React Router remounts this page on navigation, so
  // work orders created in the order entry module show up without a reload
  useEffect(() => {
    async function loadWorkOrders() {
      try {
        const response = await fetch("http://localhost:3000/api/work-orders");

        if (!response.ok) throw new Error("Failed to load work orders");
        const data: WorkOrder[] = await response.json();
        setWorkOrders(data);
      } catch (error) {
        console.error("Failed fetching work orders", error);
      }
    }
    loadWorkOrders();
  }, []);

  useEffect(() => {
    async function loadSalesOrders() {
      try {
        const response = await fetch("http://localhost:3000/api/sales-orders");
        if (!response.ok) throw new Error("Failed to load salesOrders");
        const data: SalesOrder[] = await response.json();
        setSalesOrders(data);
      } catch (error) {
        console.error("Failed fetching sales order allocations", error);
      }
    }
    loadSalesOrders();
  }, []);

  // get parts list
  useEffect(() => {
    async function loadParts() {
      try {
        const response = await fetch("http://localhost:3000/api/parts");
        if (!response.ok) throw new Error("Failed to load parts");
        const data: Part[] = await response.json();
        setParts(data);
      } catch (error) {
        console.error("Failed to fetch parts", error);
      }
    }
    loadParts();
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
          workCentersRef.current,
        );

        setThroughputHistory((prev) => [
          ...prev,
          {
            tick: nextTick,
            cents: calculateThroughput(
              tickData.finishedParts,
              currentSimulation.finishedParts,
              workOrdersRef.current,
              partsRef.current,
              salesOrdersRef.current,
            ),
          },
        ]);

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
    setThroughputHistory([]);
  };
  const deriveWorkCenterView = (
    wipParts: WipPart[],
    routings: Map<number, Routing>,
    workCenters: Map<number, WorkCenter>,
  ): Map<number, WorkCenterView> => {
    // workCenterId -> every part whose current step is here (running + waiting)
    const countByWorkCenter = new Map<number, number>();
    // workCenterId -> percent complete of each part actually on a machine
    const progressByWorkCenter = new Map<number, number[]>();

    for (const wipPart of wipParts) {
      const partRouting = routings.get(wipPart.routingId);
      if (!partRouting) continue;
      const workCenterId = partRouting.steps[wipPart.stepIndex].workCenterId;

      countByWorkCenter.set(
        workCenterId,
        (countByWorkCenter.get(workCenterId) ?? 0) + 1,
      );

      if (wipPart.progressSeconds > 0) {
        const running = progressByWorkCenter.get(workCenterId) ?? [];
        running.push(
          Math.round(
            (wipPart.progressSeconds / wipPart.actualProcessTimeSeconds) * 100,
          ),
        );
        progressByWorkCenter.set(workCenterId, running);
      }
    }

    const views = new Map<number, WorkCenterView>();
    for (const workCenter of workCenters.values()) {
      // sorted so a part finishing doesn't shuffle the remaining bars between rows
      const running = (progressByWorkCenter.get(workCenter.id) ?? []).sort(
        (a, b) => b - a,
      );
      views.set(workCenter.id, {
        partsAtStation: countByWorkCenter.get(workCenter.id) ?? 0,
        slots: Array.from(
          { length: workCenter.capacity },
          (_, slotIndex) => running[slotIndex] ?? null,
        ),
        slotsInUse: running.length,
        utilization:
          workCenter.capacity > 0 ? running.length / workCenter.capacity : 0,
      });
    }
    return views;
  };

  const updateCapacity = async (id: number, capacity: number) => {
    if (!Number.isInteger(capacity) || capacity < 1) return;
    try {
      const response = await fetch(
        `http://localhost:3000/api/work-centers/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ capacity }),
        },
      );
      if (!response.ok) throw new Error("Failed to update capacity");
      const updated: WorkCenter = await response.json();
      setWorkCenters((prev) =>
        prev.map((wc) => (wc.id === updated.id ? updated : wc)),
      );
    } catch (error) {
      console.error("Failed to update work center capacity", error);
    }
  };
  const releaseOrder = async () => {
    const order = workOrders.find((wo) => wo.id === selectedOrderId);
    if (!order) {
      alert("Please Select a Work Order to Release");
      return;
    }
    let fetchedRouting: Routing | null;
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

  const workCenterById = new Map(workCenters.map((wc) => [wc.id, wc]));
  const view = deriveWorkCenterView(
    simulationState.wipParts,
    routings,
    workCenterById,
  );
  const cumulative = cumulativeThroughput(throughputHistory);
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

      <div className="grid grid-cols-3 gap-4 items-start">
        {isLoading ? (
          <p>Loading...</p>
        ) : (
          workCenters.map((workCenter) => {
            return (
              <WorkCenterCard
                key={workCenter.id}
                id={workCenter.id}
                name={workCenter.name}
                capacity={workCenter.capacity}
                workCenterData={
                  view.get(workCenter.id) ?? {
                    partsAtStation: 0,
                    slots: Array.from(
                      { length: workCenter.capacity },
                      () => null,
                    ),
                    slotsInUse: 0,
                    utilization: 0,
                  }
                }
                onCapacityChange={updateCapacity}
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
      <div className="w-full max-w-3xl h-80 shrink-0">
        <ThroughputChart data={cumulative} />
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
