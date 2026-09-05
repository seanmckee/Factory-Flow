import { GitFork, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "../ui/Field";
import { formatCents, formatSignedCents } from "../../orders/salesOrderMath";
import { formatTickTime } from "../../simulation/simTime";
import type { SimulationPageController } from "../../simulation/useSimulationPage";

function Stat({ label, value, negative = false }: { label: string; value: string; negative?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={negative ? "font-medium text-destructive" : "font-medium"}>{value}</span>
    </span>
  );
}

type Props = Pick<SimulationPageController,
  "forkName" | "forkOpen" | "jump" | "newRunName" | "newRunOpen" | "onCreateRun" |
  "onDeleteRun" | "onForkRun" |
  "pendingAction" | "run" | "runId" | "runs" | "selectRun" | "setForkName" |
  "setForkOpen" | "setNewRunName" | "setNewRunOpen"
>;

export function SimulationRunBar(props: Props) {
  const { forkName, forkOpen, jump, newRunName, newRunOpen, onCreateRun,
    onDeleteRun, onForkRun, pendingAction,
    run, runId, runs, selectRun, setForkName, setForkOpen, setNewRunName,
    setNewRunOpen } = props;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Select value={runId === null ? "" : String(runId)} onValueChange={(value) => selectRun(Number(value))} disabled={jump !== null}>
        <SelectTrigger className="w-64"><SelectValue placeholder="No run selected" /></SelectTrigger>
        <SelectContent>
          {runs.map((option) => (
            <SelectItem key={option.id} value={String(option.id)}>
              #{option.id} · {option.name} · tick {option.tickNum.toLocaleString()}
              {option.parentRunId !== null && ` · fork of #${option.parentRunId}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog open={newRunOpen} onOpenChange={setNewRunOpen}>
        <DialogTrigger asChild><Button variant="outline" disabled={jump !== null}><Plus className="size-4" /> New Run</Button></DialogTrigger>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={(event) => { event.preventDefault(); void onCreateRun(); }} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>New run</DialogTitle>
              <DialogDescription>
                Freezes today's work centers and cost rates, and draws its own seed — re-creating a run with the same seed reproduces it exactly.
              </DialogDescription>
            </DialogHeader>
            <Field label="Name">
              <Input value={newRunName} onChange={(event) => setNewRunName(event.target.value)} placeholder="e.g. release everything" />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={pendingAction === "create"}>
                {pendingAction === "create" && <LoaderCircle className="size-4 animate-spin" />}
                {pendingAction === "create" ? "Creating…" : "Create Run"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Forking creates a run, so it lives beside New Run rather than on the
          transport bar. The dialog opens with a derived name prefilled; an
          emptied field lets the server derive the same default. */}
      <Dialog
        open={forkOpen}
        onOpenChange={(open) => {
          if (open && run) {
            const day = Math.floor(run.tickNum / run.dayTicks) + 1;
            setForkName(`${run.name} · fork @ D${day}`);
          }
          setForkOpen(open);
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline" disabled={runId === null || jump !== null || pendingAction !== null}>
            <GitFork className="size-4" /> Fork
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={(event) => { event.preventDefault(); void onForkRun(); }} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Fork run</DialogTitle>
              <DialogDescription>
                Copies the run as it stands at{" "}
                {run ? formatTickTime(run.tickNum, run.dayTicks) : "its current tick"}. Both
                branches share this history and the same seed — only your
                decisions diverge them.
              </DialogDescription>
            </DialogHeader>
            <Field label="Name">
              <Input value={forkName} onChange={(event) => setForkName(event.target.value)} />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={pendingAction === "fork"}>
                {pendingAction === "fork" && <LoaderCircle className="size-4 animate-spin" />}
                {pendingAction === "fork" ? "Forking…" : "Fork Run"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Button variant="ghost" onClick={() => void onDeleteRun()} disabled={runId === null || jump !== null || pendingAction !== null} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
        {pendingAction === "delete" ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        {pendingAction === "delete" ? "Deleting…" : "Delete Run"}
      </Button>

      {run && (
        <div className="ml-auto flex flex-wrap items-center gap-4 tabular-nums">
          <Stat label="Time" value={formatTickTime(run.tickNum, run.dayTicks)} />
          <Stat label="Tick" value={run.tickNum.toLocaleString()} />
          <Stat label="WIP" value={run.wipCount.toLocaleString()} />
          <Stat label="Finished" value={run.finishedCount.toLocaleString()} />
          <Stat label="Throughput" value={formatCents(run.throughputCents)} />
          <Stat label="Net" value={formatSignedCents(run.netCents)} negative={run.netCents < 0} />
          <span className="text-xs text-muted-foreground">seed {run.rngSeed}</span>
          {run.parentRunId !== null && (
            <span className="text-xs text-muted-foreground">
              forked from #{run.parentRunId} at Day{" "}
              {Math.floor((run.forkedAtTick ?? 0) / run.dayTicks) + 1}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
