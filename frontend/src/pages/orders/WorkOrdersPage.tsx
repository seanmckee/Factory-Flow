import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { deleteConflict, deleteJson, postJson } from "../../api/client";
import { useOrdersData } from "../../orders/OrdersDataContext";
import { useToast } from "../../toast/ToastContext";
import ConfirmDialog from "../../components/orders/ConfirmDialog";
import DemandPanel from "../../components/orders/DemandPanel";
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
import { formatCents, isOpen, remainingQty } from "../../orders/salesOrderMath";
import { summarizeDemand } from "../../orders/demand";
import type { WorkOrder } from "../../types/WorkOrder";

type PendingDelete = {
  id: number;
  orderNumber: string;
  allocations: { orderNumber: string; quantity: number }[];
};

/** Radix Select can't carry an empty-string item, so "auto" stands in for it. */
const AUTO_ALLOCATE = "auto";

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

  const [createOpen, setCreateOpen] = useState(false);
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
   * "Build" on a demand row fills the form in and opens it. The routing is
   * only preselected when the part has exactly one - picking for the user when
   * there's a genuine choice would hide that the choice exists.
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
    setCreateOpen(true);
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
      setCreateOpen(false);
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

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-destructive">{error}</p>;

  return (
    <div className="flex h-full min-h-0 max-w-6xl flex-col">
      <PageHeader
        title="Work Orders"
        description="Work orders produce parts. Unallocated quantity becomes inventory."
      >
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> New Work Order
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <form onSubmit={submit} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>New work order</DialogTitle>
                <DialogDescription>
                  Releases into a run come later — this only creates the order.
                </DialogDescription>
              </DialogHeader>

              <Field label="Part">
                <Select
                  value={partId}
                  onValueChange={(value) => changePart(value)}
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

              <Field label="Routing">
                <Select
                  value={routingId}
                  onValueChange={(value) => setRoutingId(value)}
                  disabled={!partId || partRoutings.length === 0}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a routing" />
                  </SelectTrigger>
                  <SelectContent>
                    {partRoutings.map((routing) => (
                      <SelectItem key={routing.id} value={String(routing.id)}>
                        {routing.name} (rev {routing.revision})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {partId && partRoutings.length === 0 && (
                  <span className="text-xs text-destructive">
                    This part has no routing, so it can't be produced yet.
                  </span>
                )}
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

              <Field label="Allocate to sales order">
                <Select
                  value={salesOrderId || AUTO_ALLOCATE}
                  onValueChange={(value) =>
                    changeSalesOrder(value === AUTO_ALLOCATE ? "" : value)
                  }
                  disabled={!partId}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO_ALLOCATE}>
                      Auto-allocate to open demand
                    </SelectItem>
                    {openSalesOrders.map((salesOrder) => (
                      <SelectItem
                        key={salesOrder.id}
                        value={String(salesOrder.id)}
                      >
                        {salesOrder.orderNumber} · {salesOrder.quantity} ordered
                        · {remainingQty(salesOrder)} remaining
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {partId && openSalesOrders.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    No open demand for this part — the whole order becomes
                    inventory.
                  </span>
                )}
              </Field>

              {salesOrderId && (
                <Field label="Allocation quantity">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={allocationQuantity}
                    onChange={(event) =>
                      setAllocationQuantity(event.target.value)
                    }
                  />
                </Field>
              )}

              <DialogFooter>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating…" : "Create Work Order"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
        <DemandPanel
          summaries={demandSummaries}
          partById={partById}
          produciblePartIds={produciblePartIds}
          selectedPartId={selectedPartId}
          onPickPart={buildForPart}
        />

        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Part</TableHead>
                <TableHead>Routing</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Allocated to</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {workOrders.map((workOrder) => {
                const routing = routingById.get(workOrder.routingId);
                const part = partById.get(workOrder.partId);
                const allocated = workOrder.allocations.reduce(
                  (total, allocation) => total + allocation.quantity,
                  0,
                );
                const inventory = workOrder.quantity - allocated;
                return (
                  <TableRow key={workOrder.id}>
                    <TableCell className="font-medium">
                      {workOrder.orderNumber}
                    </TableCell>
                    <TableCell>
                      {part ? `${part.partNumber} · ${part.name}` : "—"}
                    </TableCell>
                    <TableCell>{routing?.name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {workOrder.quantity}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {workOrder.status}
                    </TableCell>
                    <TableCell>
                      {workOrder.allocations.length === 0 ? (
                        <span className="text-muted-foreground/60">
                          unallocated
                        </span>
                      ) : (
                        workOrder.allocations
                          .map(
                            (allocation) =>
                              `${allocation.salesOrderNumber} (${allocation.quantity})`,
                          )
                          .join(", ")
                      )}
                      {inventory > 0 && workOrder.allocations.length > 0 && (
                        <span className="text-muted-foreground/60">
                          {" "}
                          · {inventory} inventory
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DeleteButton
                        label={workOrder.orderNumber}
                        busy={deletingId === workOrder.id}
                        onClick={() => runDelete(workOrder, false)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
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
                units are allocated to:
              </p>
              <ul>
                {pendingDelete.allocations.map((link) => (
                  <li key={link.orderNumber}>
                    {link.orderNumber} ({link.quantity})
                  </li>
                ))}
              </ul>
              <p>
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
