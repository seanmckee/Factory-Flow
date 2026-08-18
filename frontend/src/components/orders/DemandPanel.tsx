import { formatCents } from "../../orders/salesOrderMath";
import type { PartDemand } from "../../orders/demand";
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
      <div className="mt-6 rounded-lg border border-slate-300 bg-white p-6 text-sm text-slate-500">
        <p className="font-medium text-slate-700">No open demand</p>
        <p className="mt-1">
          Every sales order is fully allocated. Anything you build now is
          inventory.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-lg border border-slate-300 bg-white">
      <div className="border-b border-slate-200 p-4">
        <h2 className="font-medium">Open demand</h2>
        <p className="mt-1 text-sm text-slate-500">
          Unfilled sales order quantity, net of work order units nobody has
          claimed yet. Pick a row to build it.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-slate-600">
            <tr>
              <th className="p-2">Part</th>
              <th className="p-2">Unfilled sales orders</th>
              <th className="p-2 text-right">Open demand</th>
              <th className="p-2 text-right">Uncommitted supply</th>
              <th className="p-2 text-right">Net to make</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((entry) => {
              const part = partById.get(entry.partId);
              const producible = produciblePartIds.has(entry.partId);
              const isSelected = entry.partId === selectedPartId;
              return (
                <tr
                  key={entry.partId}
                  className={`border-t border-slate-200 ${
                    isSelected ? "bg-blue-50" : ""
                  }`}
                >
                  <td className="p-2">
                    <span className="font-medium">
                      {part ? part.partNumber : "—"}
                    </span>
                    <span className="text-slate-500"> · {part?.name}</span>
                    {!producible && (
                      <span className="block text-xs text-red-600">
                        no routing — can't be produced yet
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-slate-600">
                    {entry.openOrders
                      .map(
                        (order) =>
                          `${order.orderNumber} (${order.remaining} @ ${formatCents(
                            order.unitPriceCents,
                          )})`,
                      )
                      .join(", ")}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {entry.openDemandUnits}
                  </td>
                  <td className="p-2 text-right tabular-nums text-slate-500">
                    {entry.uncommittedSupplyUnits > 0
                      ? `−${entry.uncommittedSupplyUnits}`
                      : "—"}
                  </td>
                  <td
                    className={`p-2 text-right font-medium tabular-nums ${
                      entry.netToMakeUnits > 0
                        ? "text-slate-900"
                        : "text-slate-400"
                    }`}
                  >
                    {entry.netToMakeUnits}
                  </td>
                  <td className="p-2 text-right">
                    <button
                      type="button"
                      disabled={!producible}
                      onClick={() =>
                        onPickPart(
                          entry.partId,
                          entry.netToMakeUnits > 0
                            ? entry.netToMakeUnits
                            : entry.openDemandUnits,
                        )
                      }
                      className="rounded-lg px-2 py-1 text-blue-600 hover:bg-blue-50 disabled:text-slate-300 disabled:hover:bg-transparent"
                    >
                      Build
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
