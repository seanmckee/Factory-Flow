import { useCallback, useState } from "react";
import { deleteConflict, deleteJson, postJson } from "../../api/client";
import { useOrdersData } from "../../orders/OrdersDataContext";
import { useToast } from "../../toast/ToastContext";
import CollapsibleSection from "../../components/orders/CollapsibleSection";
import ConfirmDialog from "../../components/orders/ConfirmDialog";
import {
  Field,
  FormCard,
  SubmitButton,
  inputClass,
} from "../../components/ui/Form";
import { Table, THead, Th, Tr, Td } from "../../components/ui/Table";
import DeleteButton from "../../components/ui/DeleteButton";
import {
  allocatedQty,
  dollarsToCents,
  formatCents,
  formatSignedCents,
  remainingQty,
  throughputPerUnitCents,
} from "../../orders/salesOrderMath";
import type { SalesOrder } from "../../types/SalesOrder";

type PendingDelete = {
  id: number;
  orderNumber: string;
  allocations: { orderNumber: string; quantity: number }[];
};

export default function SalesOrdersPage() {
  const {
    parts,
    salesOrders,
    loading,
    error,
    refetchSalesOrders,
    refetchWorkOrders,
  } = useOrdersData();
  const { showToast } = useToast();

  const [partId, setPartId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const partById = new Map(parts.map((part) => [part.id, part]));

  // Number("") is 0, and without strictNullChecks nothing would flag the miss
  const selectedPart = partId ? partById.get(Number(partId)) : undefined;
  const priceCents = dollarsToCents(unitPrice);
  const parsedQuantity = Number(quantity);
  const hasQuantity = Number.isInteger(parsedQuantity) && parsedQuantity > 0;

  const perUnitCents =
    selectedPart && priceCents !== null
      ? throughputPerUnitCents(priceCents, selectedPart.materialCostCents)
      : null;
  const orderTotalCents =
    perUnitCents !== null && hasQuantity ? perUnitCents * parsedQuantity : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    // no strictNullChecks here, so guard the empty-field NaN explicitly
    if (!partId) return showToast("Select a part", "error");
    if (!hasQuantity) {
      return showToast("Quantity must be a whole number above zero", "error");
    }
    if (priceCents === null || priceCents < 1) {
      return showToast("Unit price must be greater than zero", "error");
    }

    setSubmitting(true);
    try {
      const created = await postJson<SalesOrder>("/api/sales-orders", {
        partId: Number(partId),
        quantity: parsedQuantity,
        unitPriceCents: priceCents,
      });

      await refetchSalesOrders();
      showToast(`Created ${created.orderNumber}`);
      setPartId("");
      setQuantity("");
      setUnitPrice("");
    } catch (submitError) {
      showToast(
        submitError instanceof Error
          ? submitError.message
          : "Failed to create sales order",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const runDelete = async (
    salesOrder: { id: number; orderNumber: string },
    force: boolean,
  ) => {
    setDeletingId(salesOrder.id);
    try {
      const result = await deleteJson<{
        orderNumber: string;
        deletedAllocations: number;
      }>(`/api/sales-orders/${salesOrder.id}${force ? "?force=true" : ""}`);

      setPendingDelete(null);
      // toast before refetching: a refetch failure shouldn't report a delete
      // that actually succeeded as a failure
      showToast(
        result.deletedAllocations > 0
          ? `Deleted ${result.orderNumber} and freed ${result.deletedAllocations} allocation(s)`
          : `Deleted ${result.orderNumber}`,
      );
      // the cascade changes the work orders page too
      await Promise.all([refetchSalesOrders(), refetchWorkOrders()]);
    } catch (deleteError) {
      const conflict = deleteConflict(deleteError);
      if (conflict) {
        setPendingDelete({
          id: salesOrder.id,
          orderNumber: salesOrder.orderNumber,
          allocations: conflict.allocations ?? [],
        });
        return;
      }
      setPendingDelete(null);
      showToast(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete sales order",
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
      <h1 className="text-2xl font-bold">Sales Orders</h1>
      <p className="mt-1 text-sm text-slate-500">
        Sales orders record customer demand. They don't create work orders.
      </p>

      <FormCard onSubmit={submit}>
        <Field label="Part">
          <select
            value={partId}
            onChange={(event) => setPartId(event.target.value)}
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
        </Field>

        <Field label="Quantity">
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Unit price (USD)">
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={unitPrice}
            onChange={(event) => setUnitPrice(event.target.value)}
            className={inputClass}
          />
        </Field>

        {/* Shown as soon as a part is picked - the most useful moment is
            "part chosen, price blank", when you need to know what to beat. */}
        {selectedPart && (
          <div
            className={`rounded-lg border p-4 text-sm ${
              perUnitCents !== null && perUnitCents <= 0
                ? "border-red-300 bg-red-50 text-red-700"
                : "border-slate-200 bg-slate-50 text-slate-600"
            }`}
          >
            <p className="font-medium">Throughput</p>
            <dl className="mt-2 flex flex-col gap-1">
              <div className="flex justify-between gap-4">
                <dt>Unit price</dt>
                <dd className="tabular-nums">
                  {priceCents === null ? "—" : formatCents(priceCents)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Material cost</dt>
                <dd className="tabular-nums">
                  −{formatCents(selectedPart.materialCostCents)}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-slate-200 pt-1 font-medium">
                <dt>Per unit</dt>
                <dd className="tabular-nums">
                  {perUnitCents === null ? "—" : formatSignedCents(perUnitCents)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Order total{hasQuantity ? ` (${parsedQuantity})` : ""}</dt>
                <dd className="tabular-nums">
                  {orderTotalCents === null
                    ? "—"
                    : formatSignedCents(orderTotalCents)}
                </dd>
              </div>
            </dl>
            {perUnitCents !== null && perUnitCents <= 0 && (
              <p className="mt-2">
                At or below material cost — each unit earns $0 or less. You can
                still create this order.
              </p>
            )}
          </div>
        )}

        <SubmitButton busy={submitting} busyLabel="Creating…">
          Create Sales Order
        </SubmitButton>
      </FormCard>

      <CollapsibleSection title="sales orders" count={salesOrders.length}>
        <Table>
          <THead>
            <Th>Order</Th>
            <Th>Part</Th>
            <Th numeric>Ordered</Th>
            <Th numeric>Allocated</Th>
            <Th numeric>Remaining</Th>
            <Th numeric>Unit price</Th>
            <Th numeric>Throughput/unit</Th>
            <Th />
          </THead>
          <tbody>
            {salesOrders.map((salesOrder) => {
              const part = partById.get(salesOrder.partId);
              const remaining = remainingQty(salesOrder);
              // realized only on allocated, finished units - not "profit"
              const perUnit = part
                ? throughputPerUnitCents(
                    salesOrder.unitPriceCents,
                    part.materialCostCents,
                  )
                : null;
              return (
                <Tr key={salesOrder.id}>
                  <Td className="font-medium">{salesOrder.orderNumber}</Td>
                  <Td>{part ? `${part.partNumber} · ${part.name}` : "—"}</Td>
                  <Td numeric>{salesOrder.quantity}</Td>
                  <Td numeric>{allocatedQty(salesOrder)}</Td>
                  <Td
                    numeric
                    className={
                      remaining > 0 ? "text-slate-900" : "text-slate-400"
                    }
                  >
                    {remaining}
                  </Td>
                  <Td numeric>{formatCents(salesOrder.unitPriceCents)}</Td>
                  <Td
                    numeric
                    className={
                      perUnit !== null && perUnit <= 0 ? "text-red-600" : ""
                    }
                  >
                    {perUnit === null ? "—" : formatSignedCents(perUnit)}
                  </Td>
                  <Td className="text-right">
                    <DeleteButton
                      label={salesOrder.orderNumber}
                      busy={deletingId === salesOrder.id}
                      onClick={() => runDelete(salesOrder, false)}
                    />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
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
                units are allocated from:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {pendingDelete.allocations.map((link) => (
                  <li key={link.orderNumber}>
                    {link.orderNumber} ({link.quantity})
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                Those allocations are removed and the units become inventory.
              </p>
            </>
          }
        />
      )}
    </div>
  );
}
