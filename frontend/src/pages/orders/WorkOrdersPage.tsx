import { useCallback, useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteConflict, deleteJson, postJson } from "../../api/client";
import { useOrdersData } from "../../orders/OrdersDataContext";
import { useToast } from "../../toast/ToastContext";
import CollapsibleSection from "../../components/orders/CollapsibleSection";
import ConfirmDialog from "../../components/orders/ConfirmDialog";
import DemandPanel from "../../components/orders/DemandPanel";
import { formatCents, isOpen, remainingQty } from "../../orders/salesOrderMath";
import { summarizeDemand } from "../../orders/demand";
import type { WorkOrder } from "../../types/WorkOrder";

type PendingDelete = {
  id: number;
  orderNumber: string;
  allocations: { orderNumber: string; quantity: number }[];
};

const inputClass = "border border-slate-300 rounded-lg p-2 bg-white";
const labelClass = "flex flex-col gap-1 text-sm text-slate-600";

export default function WorkOrdersPage() {
  const {
    parts,
    routings,
    salesOrders,
    workOrders,
    loading,
    error,
    refetchWorkOrders,
    refetchSalesOrders,
  } = useOrdersData();
  const { showToast } = useToast();

  const [partId, setPartId] = useState("");
  const [routingId, setRoutingId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [salesOrderId, setSalesOrderId] = useState("");
  const [allocationQuantity, setAllocationQuantity] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const selectedPartId = Number(partId);
  const partById = new Map(parts.map((part) => [part.id, part]));
  const routingById = new Map(routings.map((routing) => [routing.id, routing]));

  const partRoutings = routings.filter(
    (routing) => routing.partId === selectedPartId,
  );
  const openSalesOrders = salesOrders.filter(
    (salesOrder) => salesOrder.partId === selectedPartId && isOpen(salesOrder),
  );

  const demandSummaries = summarizeDemand(salesOrders, workOrders);
  const produciblePartIds = new Set(routings.map((routing) => routing.partId));

  // reset in the handler, not an effect, so a stale routing can never be submitted
  const changePart = (value: string) => {
    setPartId(value);
    setRoutingId("");
    setSalesOrderId("");
    setAllocationQuantity("");
  };

  /**
   * "Build" on a demand row fills the form in. The routing is only preselected
   * when the part has exactly one - picking for the user when there's a genuine
   * choice would hide that the choice exists.
   */
  const buildForPart = (targetPartId: number, suggestedQuantity: number) => {
    const candidates = routings.filter(
      (routing) => routing.partId === targetPartId,
    );
    setPartId(String(targetPartId));
    setRoutingId(candidates.length === 1 ? String(candidates[0].id) : "");
    setQuantity(String(suggestedQuantity));
    // leave allocation on auto: it fills the same open orders oldest-first
    setSalesOrderId("");
    setAllocationQuantity("");
  };

  const changeSalesOrder = (value: string) => {
    setSalesOrderId(value);
    if (!value) {
      setAllocationQuantity("");
      return;
    }
    const target = salesOrders.find(
      (salesOrder) => salesOrder.id === Number(value),
    );
    const parsedQuantity = Number(quantity);
    if (target && Number.isInteger(parsedQuantity) && parsedQuantity > 0) {
      setAllocationQuantity(
        String(Math.min(parsedQuantity, remainingQty(target))),
      );
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const parsedQuantity = Number(quantity);
    if (!partId) return showToast("Select a part", "error");
    if (!routingId) return showToast("Select a routing", "error");
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1) {
      return showToast("Quantity must be a whole number above zero", "error");
    }

    setSubmitting(true);
    try {
      const created = await postJson<WorkOrder>("/api/work-orders", {
        partId: selectedPartId,
        routingId: Number(routingId),
        quantity: parsedQuantity,
        salesOrderId: salesOrderId ? Number(salesOrderId) : null,
        allocationQuantity:
          salesOrderId && allocationQuantity
            ? Number(allocationQuantity)
            : null,
      });

      // creating a work order consumes demand, so the sales order list moves too
      await Promise.all([refetchWorkOrders(), refetchSalesOrders()]);

      const allocated = created.allocations.reduce(
        (total, allocation) => total + allocation.quantity,
        0,
      );
      showToast(
        `Created ${created.orderNumber} · allocated ${allocated} of ${created.quantity}`,
      );
      setRoutingId("");
      setQuantity("");
      setSalesOrderId("");
      setAllocationQuantity("");
    } catch (submitError) {
      showToast(
        submitError instanceof Error
          ? submitError.message
          : "Failed to create work order",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const runDelete = async (
    workOrder: { id: number; orderNumber: string },
    force: boolean,
  ) => {
    setDeletingId(workOrder.id);
    try {
      const result = await deleteJson<{
        orderNumber: string;
        deletedAllocations: number;
      }>(`/api/work-orders/${workOrder.id}${force ? "?force=true" : ""}`);

      setPendingDelete(null);
      // toast before refetching: a refetch failure shouldn't report a delete
      // that actually succeeded as a failure
      showToast(
        result.deletedAllocations > 0
          ? `Deleted ${result.orderNumber} and reopened ${result.deletedAllocations} allocation(s)`
          : `Deleted ${result.orderNumber}`,
      );
      // the cascade reopens demand, so the sales orders page moves too
      await Promise.all([refetchWorkOrders(), refetchSalesOrders()]);
    } catch (deleteError) {
      const conflict = deleteConflict(deleteError);
      if (conflict) {
        setPendingDelete({
          id: workOrder.id,
          orderNumber: workOrder.orderNumber,
          allocations: conflict.allocations ?? [],
        });
        return;
      }
      setPendingDelete(null);
      showToast(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete work order",
        "error",
      );
    } finally {
      setDeletingId(null);
    }
  };

  // stable identity so ConfirmDialog's Escape listener doesn't re-register
  const cancelDelete = useCallback(() => setPendingDelete(null), []);

  if (loading) return <p className="text-slate-500">Loading…</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold">Work Orders</h1>
      <p className="mt-1 text-sm text-slate-500">
        Work orders produce parts. Unallocated quantity becomes inventory.
      </p>

      <DemandPanel
        summaries={demandSummaries}
        partById={partById}
        produciblePartIds={produciblePartIds}
        selectedPartId={selectedPartId}
        onPickPart={buildForPart}
      />

      <form
        onSubmit={submit}
        className="mt-6 flex max-w-3xl flex-col gap-4 rounded-lg border border-slate-300 bg-white p-6"
      >
        <label className={labelClass}>
          Part
          <select
            value={partId}
            onChange={(event) => changePart(event.target.value)}
            className={inputClass}
          >
            <option value="">Select a part</option>
            {parts.map((part) => (
              <option key={part.id} value={part.id}>
                {part.partNumber} · {part.name} · material{" "}
                {formatCents(part.materialCostCents)}
              </option>
            ))}
          </select>
        </label>

        <label className={labelClass}>
          Routing
          <select
            value={routingId}
            onChange={(event) => setRoutingId(event.target.value)}
            disabled={!partId || partRoutings.length === 0}
            className={`${inputClass} disabled:bg-slate-100`}
          >
            <option value="">Select a routing</option>
            {partRoutings.map((routing) => (
              <option key={routing.id} value={routing.id}>
                {routing.name} (rev {routing.revision})
              </option>
            ))}
          </select>
          {partId && partRoutings.length === 0 && (
            <span className="text-red-600">
              This part has no routing, so it can't be produced yet.
            </span>
          )}
        </label>

        <label className={labelClass}>
          Quantity
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          Allocate to sales order
          <select
            value={salesOrderId}
            onChange={(event) => changeSalesOrder(event.target.value)}
            disabled={!partId}
            className={`${inputClass} disabled:bg-slate-100`}
          >
            <option value="">Auto-allocate to open demand</option>
            {openSalesOrders.map((salesOrder) => (
              <option key={salesOrder.id} value={salesOrder.id}>
                {salesOrder.orderNumber} · {salesOrder.quantity} ordered ·{" "}
                {remainingQty(salesOrder)} remaining
              </option>
            ))}
          </select>
          {partId && openSalesOrders.length === 0 && (
            <span className="text-slate-500">
              No open demand for this part — the whole order becomes inventory.
            </span>
          )}
        </label>

        {salesOrderId && (
          <label className={labelClass}>
            Allocation quantity
            <input
              type="number"
              min={1}
              step={1}
              value={allocationQuantity}
              onChange={(event) => setAllocationQuantity(event.target.value)}
              className={inputClass}
            />
          </label>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="self-start bg-blue-500 text-white p-2 rounded-lg disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create Work Order"}
        </button>
      </form>

      <CollapsibleSection title="work orders" count={workOrders.length}>
        <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left text-slate-600">
              <tr>
                <th className="p-2">Order</th>
                <th className="p-2">Part</th>
                <th className="p-2">Routing</th>
                <th className="p-2 text-right">Quantity</th>
                <th className="p-2">Status</th>
                <th className="p-2">Allocated to</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {workOrders.map((workOrder) => {
                const routing = routingById.get(workOrder.routingId);
                const part = partById.get(workOrder.partId);
                const allocated = workOrder.allocations.reduce(
                  (total, allocation) => total + allocation.quantity,
                  0,
                );
                const inventory = workOrder.quantity - allocated;
                return (
                  <tr key={workOrder.id} className="border-t border-slate-200">
                    <td className="p-2 font-medium">{workOrder.orderNumber}</td>
                    <td className="p-2">
                      {part ? `${part.partNumber} · ${part.name}` : "—"}
                    </td>
                    <td className="p-2">{routing?.name ?? "—"}</td>
                    <td className="p-2 text-right tabular-nums">
                      {workOrder.quantity}
                    </td>
                    <td className="p-2">{workOrder.status}</td>
                    <td className="p-2">
                      {workOrder.allocations.length === 0 ? (
                        <span className="text-slate-400">unallocated</span>
                      ) : (
                        workOrder.allocations
                          .map(
                            (allocation) =>
                              `${allocation.salesOrderNumber} (${allocation.quantity})`,
                          )
                          .join(", ")
                      )}
                      {inventory > 0 && workOrder.allocations.length > 0 && (
                        <span className="text-slate-400">
                          {" "}
                          · {inventory} inventory
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-right">
                      <button
                        type="button"
                        aria-label={`Delete ${workOrder.orderNumber}`}
                        disabled={deletingId === workOrder.id}
                        onClick={() => runDelete(workOrder, false)}
                        className="rounded px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.orderNumber}?`}
          confirmLabel="Delete"
          busy={deletingId === pendingDelete.id}
          onCancel={cancelDelete}
          onConfirm={() =>
            runDelete(
              { id: pendingDelete.id, orderNumber: pendingDelete.orderNumber },
              true,
            )
          }
          body={
            <>
              <p>
                {pendingDelete.allocations.reduce(
                  (total, link) => total + link.quantity,
                  0,
                )}{" "}
                units are allocated to:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {pendingDelete.allocations.map((link) => (
                  <li key={link.orderNumber}>
                    {link.orderNumber} ({link.quantity})
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                Those allocations are removed and that demand becomes unfilled
                again.
              </p>
            </>
          }
        />
      )}
    </div>
  );
}
