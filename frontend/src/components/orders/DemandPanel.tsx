import { formatCents } from "../../orders/salesOrderMath";
import type { PartDemand } from "../../orders/demand";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Part } from "../../types/Part";

type DemandPanelProps = {
  summaries: PartDemand[];
  partById: Map<number, Part>;
  /** partIds that have at least one routing - anything else can't be produced. */
  produciblePartIds: Set<number>;
  selectedPartId: number;
  onPickPart: (partId: number, suggestedQuantity: number) => void;
};

/**
 * What still needs making. Visible by default: this is the question you arrive
 * on the work orders page to answer, so it shouldn't be behind a toggle.
 */
export default function DemandPanel({
  summaries,
  partById,
  produciblePartIds,
  selectedPartId,
  onPickPart,
}: DemandPanelProps) {
  if (summaries.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No open demand</p>
        <p className="mt-1">
          Every sales order is fully allocated. Anything you build now is
          inventory.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="font-medium">Open demand</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Unfilled sales order quantity, net of work order units nobody has
          claimed yet. Pick a row to build it.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Part</TableHead>
            <TableHead>Unfilled sales orders</TableHead>
            <TableHead className="text-right">Open demand</TableHead>
            <TableHead className="text-right">Uncommitted supply</TableHead>
            <TableHead className="text-right">Net to make</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {summaries.map((entry) => {
            const part = partById.get(entry.partId);
            const producible = produciblePartIds.has(entry.partId);
            const isSelected = entry.partId === selectedPartId;
            return (
              <TableRow
                key={entry.partId}
                className={isSelected ? "bg-accent/50" : ""}
              >
                <TableCell>
                  <span className="font-medium">
                    {part ? part.partNumber : "—"}
                  </span>
                  <span className="text-muted-foreground"> · {part?.name}</span>
                  {!producible && (
                    <span className="block text-xs text-destructive">
                      no routing — can't be produced yet
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {entry.openOrders
                    .map(
                      (order) =>
                        `${order.orderNumber} (${order.remaining} @ ${formatCents(
                          order.unitPriceCents,
                        )})`,
                    )
                    .join(", ")}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {entry.openDemandUnits}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {entry.uncommittedSupplyUnits > 0
                    ? `−${entry.uncommittedSupplyUnits}`
                    : "—"}
                </TableCell>
                <TableCell
                  className={`text-right font-medium tabular-nums ${
                    entry.netToMakeUnits > 0
                      ? "text-foreground"
                      : "text-muted-foreground/60"
                  }`}
                >
                  {entry.netToMakeUnits}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={!producible}
                    onClick={() =>
                      onPickPart(
                        entry.partId,
                        entry.netToMakeUnits > 0
                          ? entry.netToMakeUnits
                          : entry.openDemandUnits,
                      )
                    }
                  >
                    Build
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
