import { Factory, LoaderCircle, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { JUMP_PRESETS, type SimulationPageController } from "../../simulation/useSimulationPage";
import { TICKS_PER_DAY } from "../../simulation/simTime";
import { CapitalDialog } from "./CapitalDialog";

type Props = Pick<SimulationPageController,
  "capitalOpen" | "floor" | "isRunning" | "jump" | "onCapitalAction" |
  "onRelease" | "pendingAction" | "releasableOrders" |
  "run" | "runId" | "runJump" | "selectedOrderId" | "setCapitalOpen" |
  "setIsRunning" | "setSelectedOrderId" |
  "setStopping" | "stopping" | "stopJumpRef"
>;

export function SimulationTransportBar(props: Props) {
  const { capitalOpen, floor, isRunning, jump, onCapitalAction, onRelease,
    pendingAction, releasableOrders, run, runId,
    runJump, selectedOrderId, setCapitalOpen, setIsRunning, setSelectedOrderId,
    setStopping, stopping, stopJumpRef } = props;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <Button size="sm" variant={isRunning ? "secondary" : "default"} onClick={() => setIsRunning((previous) => !previous)} disabled={runId === null || jump !== null}>
        {isRunning ? <><Square className="size-4" /> Stop</> : <><Play className="size-4" /> Start</>}
      </Button>
      <div className="h-6 w-px bg-border" />
      <Select value={selectedOrderId === null ? "" : String(selectedOrderId)} onValueChange={(value) => setSelectedOrderId(Number(value))}>
        <SelectTrigger size="sm" className="w-72"><SelectValue placeholder="Select a work order" /></SelectTrigger>
        <SelectContent>
          {releasableOrders.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">Every work order is released into this run</p>}
          {releasableOrders.map((order) => (
            <SelectItem key={order.id} value={String(order.id)}>{order.orderNumber} · {order.partName} · qty {order.quantity}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="secondary" onClick={() => void onRelease()} disabled={runId === null || selectedOrderId === null || jump !== null || pendingAction !== null}>
        {pendingAction === "release" && <LoaderCircle className="size-4 animate-spin" />}
        {pendingAction === "release" ? "Releasing…" : "Release Order"}
      </Button>
      <div className="h-6 w-px bg-border" />
      {/* a dialog, not more controls in the bar: buying is a whole-factory
          question, so it needs the table that shows which centre is short */}
      <Button size="sm" variant="secondary" onClick={() => setCapitalOpen(true)} disabled={runId === null || jump !== null}>
        {pendingAction === "capital" ? <LoaderCircle className="size-4 animate-spin" /> : <Factory className="size-4" />}
        Capital
      </Button>
      <div className="h-6 w-px bg-border" />
      <span className="text-xs text-muted-foreground">Fast-forward</span>
      {JUMP_PRESETS.map((preset) => (
        <Button key={preset.label} size="sm" variant="outline" className="tabular-nums" onClick={() => void runJump(preset.ticks, preset.label.slice(1))} disabled={runId === null || jump !== null}>
          {preset.label}
        </Button>
      ))}
      {jump && (
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{jump.label}</span>
          <Progress value={Math.min(100, (jump.ticksDone / jump.ticksTotal) * 100)} className="w-32" />
          <span className="text-xs tabular-nums text-muted-foreground">{Math.round((jump.ticksDone / jump.ticksTotal) * 100)}%</span>
          <Button size="sm" variant="secondary" disabled={stopping} onClick={() => { stopJumpRef.current = true; setStopping(true); }}>
            <Square className="size-3.5" /> {stopping ? "Stopping…" : "Stop"}
          </Button>
        </div>
      )}
      <CapitalDialog
        open={capitalOpen}
        onOpenChange={setCapitalOpen}
        centers={floor?.workCenters ?? []}
        dayTicks={run?.dayTicks ?? TICKS_PER_DAY}
        capitalSpendCents={run?.capitalSpendCents ?? 0}
        onAction={(kind, workCenterId) => void onCapitalAction(kind, workCenterId)}
        pending={pendingAction === "capital"}
        disabled={jump !== null}
      />
    </div>
  );
}
