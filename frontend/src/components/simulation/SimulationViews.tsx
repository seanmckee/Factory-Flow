import { lazy, Suspense } from "react";
import { ChevronRight, Info, LoaderCircle } from "lucide-react";
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
            <ReleasedOrders released={run.releasedOrders} workOrderById={workOrderById} />
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

/**
 * What has been released, as one line that stays one line.
 *
 * It used to list every order with its routing and revision, wrapped across the
 * bottom of the floor. That is fine for the three orders a hand-built book has
 * and unreadable for the twenty-nine the playground seed releases: five lines
 * of near-identical text under the one table that is supposed to be the page.
 * The count and the unit total are what a glance actually wants — the floor's
 * own rows say where the work *is* — and the pinned routing per order is a
 * question asked rarely and precisely, so it belongs one click away rather than
 * permanently on screen.
 *
 * Units are summed only when every released order resolved against the loaded
 * work orders; a partial sum stated as a total would be a quietly wrong number.
 */
function ReleasedOrders({
  released,
  workOrderById,
}: {
  released: NonNullable<SimulationPageController["run"]>["releasedOrders"];
  workOrderById: SimulationPageController["workOrderById"];
}) {
  const orders = released.map((row) => workOrderById.get(row.workOrderId));
  const units = orders.every((order) => order !== undefined)
    ? orders.reduce((total, order) => total + order.quantity, 0)
    : null;

  return (
    <details className="group">
      <summary className="flex w-fit cursor-pointer items-center gap-1 hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
        {released.length.toLocaleString()} order{released.length === 1 ? "" : "s"} released
        {units !== null && <> · {units.toLocaleString()} unit{units === 1 ? "" : "s"}</>}
      </summary>
      <div className="mt-1 flex max-h-20 flex-wrap gap-x-4 gap-y-0.5 overflow-auto pl-4">
        {released.map((row) => {
          const order = workOrderById.get(row.workOrderId);
          return (
            <span key={row.workOrderId}>
              {order?.orderNumber ?? `WO ${row.workOrderId}`}
              {order?.partName ? ` (${order.partName})` : ""} · routing {row.routingId} rev{" "}
              {row.routingRevision}
            </span>
          );
        })}
      </div>
    </details>
  );
}

function Loading({ label }: { label: string }) {
  return <div className="flex h-full flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> {label}</div>;
}
