import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CapitalActionKind, FloorWorkCenter } from "../../api/runs";

const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * The capital decisions, all of the factory at once rather than one centre at
 * a time: buying is a constraint question, so the table that answers it has to
 * show which centre *is* the constraint alongside what changing it costs.
 *
 * Machines, operators and every price come from the run's own frozen config
 * off `/floor` — a price edited in setup after the run started must not change
 * what this run is quoted, and the server charges its frozen copy regardless.
 */
export function CapitalDialog({
  open,
  onOpenChange,
  centers,
  dayTicks,
  capitalSpendCents,
  onAction,
  pending,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  centers: FloorWorkCenter[];
  /** the run's frozen day, so a per-day rate can be read as a day's money */
  dayTicks: number;
  /** what the run has spent so far, so a purchase is seen in context */
  capitalSpendCents: number;
  onAction: (kind: CapitalActionKind, workCenterId: number) => void;
  pending: boolean;
  /** true while a jump holds the run: the server would 409 anyway */
  disabled: boolean;
}) {
  const shiftsPerDay = dayTicks / 28_800;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Capital actions</DialogTitle>
          <DialogDescription>
            Charged as a lump the moment you act, against this run's frozen
            prices — so the net curve steps down and the extra output has to
            climb back out. Retiring returns salvage, which is less than the
            machine cost: churn is not free. Letting an operator go costs
            nothing.
            {capitalSpendCents !== 0 && (
              <> Spent so far: {formatCents(capitalSpendCents)}.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead>Work Center</TableHead>
                <TableHead className="text-right">Machines</TableHead>
                <TableHead className="text-right">Operators</TableHead>
                <TableHead className="text-right">Rent / day</TableHead>
                <TableHead className="text-right">Wages / day</TableHead>
                <TableHead className="text-right">Machine</TableHead>
                <TableHead className="text-right">Operator</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {centers.map((center) => {
                const idle = center.machines !== center.operators;
                return (
                  <TableRow key={center.workCenterId}>
                    <TableCell className="font-medium">{center.name}</TableCell>
                    {/* the pair, not the min: which of the two is short is
                        exactly what the next action should fix */}
                    <TableCell className="text-right tabular-nums">
                      {center.machines}
                    </TableCell>
                    <TableCell
                      className={
                        idle
                          ? "text-right tabular-nums font-medium text-starved"
                          : "text-right tabular-nums"
                      }
                    >
                      {center.operators}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatCents(
                        center.machines * center.standingCostCentsPerDay,
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatCents(
                        center.operators * center.wageCentsPerHour * 8 * shiftsPerDay,
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="tabular-nums"
                          disabled={pending || disabled}
                          onClick={() =>
                            onAction("buy_machine", center.workCenterId)
                          }
                        >
                          Buy {formatCents(center.machinePurchaseCents)}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="tabular-nums"
                          disabled={pending || disabled || center.machines === 0}
                          onClick={() =>
                            onAction("retire_machine", center.workCenterId)
                          }
                        >
                          Retire +{formatCents(center.machineSalvageCents)}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="tabular-nums"
                          disabled={pending || disabled}
                          onClick={() =>
                            onAction("hire_operator", center.workCenterId)
                          }
                        >
                          Hire {formatCents(center.operatorHireCents)}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending || disabled || center.operators === 0}
                          onClick={() =>
                            onAction("fire_operator", center.workCenterId)
                          }
                        >
                          Let go
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground">
          A centre runs <span className="font-medium">min(machines, operators)</span> parts at
          once, so a machine nobody stands at is rent with no output — and an
          operator with no machine is a wage with no output.
          {pending && (
            <span className="ml-2 inline-flex items-center gap-1">
              <LoaderCircle className="size-3 animate-spin" /> applying…
            </span>
          )}
        </p>
      </DialogContent>
    </Dialog>
  );
}
