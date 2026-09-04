import { lazy, Suspense } from "react";
import { Info, LoaderCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import WorkCenterTable from "../WorkCenterTable";
import RunDashboard from "../RunDashboard";
import type { ActiveTab, SimulationPageController } from "../../simulation/useSimulationPage";

const TrendsChart = lazy(() => import("../TrendsChart"));

function ChartCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border bg-card p-4">
      <div className="flex shrink-0 items-center gap-1.5 pb-2">
        <span className="text-sm font-medium">Trends</span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger className="text-muted-foreground hover:text-foreground" aria-label={'What "Trends" shows'}><Info className="size-3.5" /></TooltipTrigger>
            <TooltipContent className="max-w-72">The run's vitals on one clock. WIP climbing while the rate is flat means parts are piling at a constraint; net falling while throughput climbs means the doors cost more than the flow earns.</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

type Props = Pick<SimulationPageController,
  "actions" | "activeTab" | "changeTab" | "floor" | "loadMetrics" | "metrics" |
  "metricsLoading" | "run" | "salesOrders" | "seriesLoading" | "trend" | "workOrderById"
>;

export function SimulationViews(props: Props) {
  const { actions, activeTab, changeTab, floor, loadMetrics, metrics, metricsLoading, run, salesOrders, seriesLoading, trend, workOrderById } = props;
  if (!run) return null;
  return (
    <Tabs value={activeTab} onValueChange={(value) => changeTab(value as ActiveTab)} className="flex min-h-0 flex-1 flex-col gap-3">
      <TabsList className="shrink-0 self-start"><TabsTrigger value="floor">Floor</TabsTrigger><TabsTrigger value="trends">Trends</TabsTrigger><TabsTrigger value="dashboard">Dashboard</TabsTrigger></TabsList>
      <TabsContent value="floor" className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">{floor && <WorkCenterTable centers={floor.workCenters} />}</div>
        <div className="shrink-0 text-xs text-muted-foreground">
          {run.releasedOrders.length === 0 ? <p>Nothing released yet — pick a work order in the bar above and release it onto the floor.</p> : (
            <div className="flex flex-wrap gap-x-4 gap-y-0.5">{run.releasedOrders.map((released) => {
              const order = workOrderById.get(released.workOrderId);
              return <span key={released.workOrderId}>{order?.orderNumber ?? `WO ${released.workOrderId}`}{order?.partName ? ` (${order.partName})` : ""} · routing {released.routingId} rev {released.routingRevision}</span>;
            })}</div>
          )}
          <p className="mt-1 text-muted-foreground/70">Machine counts are frozen when a run is created. Change them in Factory Setup and they apply to the next run.</p>
        </div>
      </TabsContent>
      <TabsContent value="trends" className="min-h-0 flex-1 overflow-auto">
        <div className="h-full min-h-[28rem]"><ChartCard>{seriesLoading ? <Loading label="Loading trends…" /> : <Suspense fallback={<Loading label="Loading chart…" />}><TrendsChart data={trend} dayTicks={run.dayTicks} /></Suspense>}</ChartCard></div>
      </TabsContent>
      <TabsContent value="dashboard" className="flex min-h-0 flex-1 flex-col">
        {metricsLoading ? <Loading label="Loading dashboard…" /> : metrics ? (
          <RunDashboard metrics={metrics} centers={floor?.workCenters ?? []} actions={actions} salesOrders={salesOrders} tickNum={run.tickNum} dayTicks={run.dayTicks} onWindow={(fromTick, toTick) => loadMetrics(run.id, fromTick, toTick)} />
        ) : <p className="text-sm text-muted-foreground">No metrics yet — advance the run to observe some ticks.</p>}
      </TabsContent>
    </Tabs>
  );
}

function Loading({ label }: { label: string }) {
  return <div className="flex h-full flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> {label}</div>;
}
