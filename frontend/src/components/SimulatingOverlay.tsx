/**
 * Covers the page while a fast-forward runs.
 *
 * A jump is the one thing here that takes long enough to need a wait state:
 * the server advances at roughly 500 ticks a second and holds the run's lock
 * while it does, so releasing an order or switching runs mid-jump is either a
 * 409 or a write the next batch overwrites. The scrim blocks all of it, and
 * Stop is deliberately the only live control — an until-idle jump can run to
 * its ceiling, and a reload would strand the run's lock instead of ending it.
 *
 * Progress only, no metrics. It is on screen for a second or two, and a figure
 * that appears and vanishes cannot be read, let alone checked. The numbers
 * belong to the strip that appears when the jump lands.
 */
function SimulatingOverlay({
  label,
  ticksDone,
  ticksTotal,
  tickNum,
  determinate,
  stopping,
  onStop,
}: {
  label: string;
  ticksDone: number;
  /** null while running until idle — there is no total to be a fraction of. */
  ticksTotal: number | null;
  tickNum: number | null;
  /** A one-chunk jump has nothing to report until it is already done. */
  determinate: boolean;
  stopping: boolean;
  onStop: () => void;
}) {
  const percent =
    ticksTotal && ticksTotal > 0
      ? Math.min(100, Math.round((ticksDone / ticksTotal) * 100))
      : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Simulating"
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm"
    >
      <div className="flex w-80 flex-col gap-4 rounded-xl bg-white p-6 shadow-xl">
        <div className="flex flex-col gap-1">
          <p className="font-medium">Simulating</p>
          <p className="text-sm text-slate-500">{label}</p>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
          {determinate ? (
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-200 ease-linear"
              style={{ width: `${percent}%` }}
            />
          ) : (
            <div className="h-full w-full animate-pulse rounded-full bg-blue-500" />
          )}
        </div>

        <p className="text-sm text-slate-600 tabular-nums" aria-live="polite">
          {determinate
            ? `${ticksDone.toLocaleString()} of ${ticksTotal?.toLocaleString()} ticks`
            : `${ticksDone.toLocaleString()} ticks`}
          {tickNum === null ? "" : ` · now at tick ${tickNum.toLocaleString()}`}
        </p>

        <button
          className="rounded-lg bg-slate-700 p-2 text-white disabled:opacity-40"
          onClick={onStop}
          disabled={stopping}
        >
          {stopping ? "Stopping after this batch..." : "Stop"}
        </button>
      </div>
    </div>
  );
}

export default SimulatingOverlay;
