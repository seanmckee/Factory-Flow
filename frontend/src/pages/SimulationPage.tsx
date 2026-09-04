import { SimulationRunBar } from "../components/simulation/SimulationRunBar";
import { SimulationTransportBar } from "../components/simulation/SimulationTransportBar";
import { SimulationViews } from "../components/simulation/SimulationViews";
import { useSimulationPage } from "../simulation/useSimulationPage";

/** Drives and visualizes a server-side factory simulation run. */
function SimulationPage() {
  const simulation = useSimulationPage();
  const { isLoading, isRunLoading, run } = simulation;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-6">
      <SimulationRunBar {...simulation} />
      <SimulationTransportBar {...simulation} />
      {run ? (
        <SimulationViews {...simulation} />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">
            {isLoading || isRunLoading ? "Loading…" : "Create a run to put this factory to work."}
          </p>
        </div>
      )}
    </div>
  );
}

export default SimulationPage;
