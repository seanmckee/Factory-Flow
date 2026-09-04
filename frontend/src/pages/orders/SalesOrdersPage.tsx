import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { deleteConflict, deleteJson, postJson } from "../../api/client";
import { useOrdersData } from "../../orders/OrdersDataContext";
import { useToast } from "../../toast/ToastContext";
import ConfirmDialog from "../../components/orders/ConfirmDialog";
import PageHeader from "../../components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Field } from "../../components/ui/Field";
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

  const [createOpen, setCreateOpen] = useState(false);
  const [partId, setPartId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const partById = new Map(parts.map((part) => [part.id, part]));

  // Number("") is 0, and without strictNullChecks nothing would flag the miss
  const selectedPart = partId ? partById.get(Number(partId)) : undefined;
  const priceCents = dollarsToCents(unitPrice);
  const parsedQuantity = Number(quantity);
  const hasQuantity = Number.isInteger(parsedQuantity) && parsedQuantity > 0;
  const parsedDueDay = Number(dueDay);
  const hasDueDay = Number.isInteger(parsedDueDay) && parsedDueDay > 0;

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
    if (dueDay !== "" && !hasDueDay) {
      return showToast("Due day must be a whole day, 1 or later", "error");
    }

    setSubmitting(true);
    try {
      const created = await postJson<SalesOrder>("/api/sales-orders", {
        partId: Number(partId),
        quantity: parsedQuantity,
        unitPriceCents: priceCents,
        dueDay: hasDueDay ? parsedDueDay : null,
      });

      await refetchSalesOrders();
      showToast(`Created ${created.orderNumber}`);
      setPartId("");
      setQuantity("");
      setUnitPrice("");
      setDueDay("");
      setCreateOpen(false);
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

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-destructive">{error}</p>;

  return (
    <div className="flex h-full min-h-0 max-w-6xl flex-col">
      <PageHeader
        title="Sales Orders"
        description="Customer demand. Sales orders don't create work orders — they are what finished units get credited against."
      >
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> New Sales Order
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <form onSubmit={submit} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>New sales order</DialogTitle>
                <DialogDescription>
                  Demand at a price. Throughput is earned when allocated units
                  finish.
                </DialogDescription>
              </DialogHeader>

              <Field label="Part">
                <Select
                  value={partId}
                  onValueChange={(value) => setPartId(value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a part" />
                  </SelectTrigger>
                  <SelectContent>
                    {parts.map((part) => (
                      <SelectItem key={part.id} value={String(part.id)}>
                        {part.partNumber} · {part.name} · material{" "}
                        {formatCents(part.materialCostCents)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Quantity">
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </Field>

              <Field label="Unit price (USD)">
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={unitPrice}
                  onChange={(event) => setUnitPrice(event.target.value)}
                />
              </Field>

              <Field label="Due day (optional)">
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={dueDay}
                  onChange={(event) => setDueDay(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Day N of a run — on time means finished by the end of that
                  staffed day.
                </p>
              </Field>

              {/* Shown as soon as a part is picked - the most useful moment is
                  "part chosen, price blank", when you need to know what to beat. */}
              {selectedPart && (
                <div
                  className={`rounded-lg border p-4 text-sm ${
                    perUnitCents !== null && perUnitCents <= 0
                      ? "border-destructive/50 bg-destructive/10 text-destructive"
                      : "bg-muted/50 text-muted-foreground"
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
                    <div className="flex justify-between gap-4 border-t pt-1 font-medium">
                      <dt>Per unit</dt>
                      <dd className="tabular-nums">
                        {perUnitCents === null
                          ? "—"
                          : formatSignedCents(perUnitCents)}
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
                      At or below material cost — each unit earns $0 or less.
                      You can still create this order.
                    </p>
                  )}
                </div>
              )}

              <DialogFooter>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating…" : "Create Sales Order"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Part</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Allocated</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead className="text-right">Due</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead className="text-right">Throughput/unit</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
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
                <TableRow key={salesOrder.id}>
                  <TableCell className="font-medium">
                    {salesOrder.orderNumber}
                  </TableCell>
                  <TableCell>
                    {part ? `${part.partNumber} · ${part.name}` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {salesOrder.quantity}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {allocatedQty(salesOrder)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      remaining > 0 ? "" : "text-muted-foreground/60"
                    }`}
                  >
                    {remaining}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      salesOrder.dueDay === null ? "text-muted-foreground/60" : ""
                    }`}
                  >
                    {salesOrder.dueDay === null
                      ? "—"
                      : `Day ${salesOrder.dueDay}`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(salesOrder.unitPriceCents)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      perUnit !== null && perUnit <= 0 ? "text-destructive" : ""
                    }`}
                  >
                    {perUnit === null ? "—" : formatSignedCents(perUnit)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DeleteButton
                      label={salesOrder.orderNumber}
                      busy={deletingId === salesOrder.id}
                      onClick={() => runDelete(salesOrder, false)}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

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
              <ul>
                {pendingDelete.allocations.map((link) => (
                  <li key={link.orderNumber}>
                    {link.orderNumber} ({link.quantity})
                  </li>
                ))}
              </ul>
              <p>Those allocations are removed and the units become inventory.</p>
            </>
          }
        />
      )}
    </div>
  );
}
