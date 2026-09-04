import { useState } from "react";
import { Plus } from "lucide-react";
import { deleteJson, patchJson, postJson } from "../../api/client";
import { useSetupData } from "../../setup/SetupDataContext";
import { useToast } from "../../toast/ToastContext";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Field } from "../../components/ui/Field";
import DeleteButton from "../../components/ui/DeleteButton";
import InlineInput from "../../components/ui/InlineInput";
import { dollarsToCents } from "../../orders/salesOrderMath";
import type { WorkCenter } from "../../types/WorkCenter";

/** The row being edited. Only one row is editable at a time. */
type Draft = { id: number; name: string; capacity: string; standingCost: string };

export default function WorkCentersPage() {
  const { workCenters, loading, error, refetchWorkCenters } = useSetupData();
  const { showToast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("1");
  const [standingCost, setStandingCost] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    // no strictNullChecks in this project, so guard the empty-field NaN explicitly
    const trimmed = name.trim();
    const parsedCapacity = Number(capacity);
    if (!trimmed) return showToast("Name is required", "error");
    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 1) {
      return showToast("Machines must be a whole number above zero", "error");
    }
    const parsedStandingCost = dollarsToCents(standingCost);
    if (parsedStandingCost === null || parsedStandingCost < 0) {
      return showToast("Standing cost must be zero or more", "error");
    }

    setSubmitting(true);
    try {
      const created = await postJson<WorkCenter>("/api/work-centers", {
        name: trimmed,
        capacity: parsedCapacity,
        standingCostCentsPerDay: parsedStandingCost,
      });

      await refetchWorkCenters();
      showToast(`Created ${created.name}`);
      setName("");
      setCapacity("1");
      setStandingCost("0");
      setCreateOpen(false);
    } catch (submitError) {
      showToast(
        submitError instanceof Error
          ? submitError.message
          : "Failed to create work center",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // seeded on focus rather than kept for every row, so a refetch can't clobber
  // text someone is mid-way through typing
  const beginEdit = (workCenter: WorkCenter) => {
    setDraft((current) =>
      current?.id === workCenter.id
        ? current
        : {
            id: workCenter.id,
            name: workCenter.name,
            capacity: String(workCenter.capacity),
            standingCost: (workCenter.standingCostCentsPerDay / 100).toString(),
          },
    );
  };

  /**
   * Commits on blur. Only changed fields are sent, so a capacity edit can't
   * collide with someone else's rename. Any failure drops the draft, which
   * reverts the inputs to the server values.
   */
  const commitEdit = async (workCenter: WorkCenter) => {
    if (!draft || draft.id !== workCenter.id) return;

    const nextName = draft.name.trim();
    const nextCapacity = Number(draft.capacity);
    const nextStandingCost = dollarsToCents(draft.standingCost);
    const renamed = nextName !== workCenter.name;
    const recapped = nextCapacity !== workCenter.capacity;
    const repriced = nextStandingCost !== workCenter.standingCostCentsPerDay;

    if (!renamed && !recapped && !repriced) return setDraft(null);

    if (!nextName) {
      setDraft(null);
      return showToast("Name is required", "error");
    }
    if (!Number.isInteger(nextCapacity) || nextCapacity < 1) {
      setDraft(null);
      return showToast("Machines must be a whole number above zero", "error");
    }
    if (repriced && (nextStandingCost === null || nextStandingCost < 0)) {
      setDraft(null);
      return showToast("Standing cost must be zero or more", "error");
    }

    const updates: {
      name?: string;
      capacity?: number;
      standingCostCentsPerDay?: number;
    } = {};
    if (renamed) updates.name = nextName;
    if (recapped) updates.capacity = nextCapacity;
    if (repriced && nextStandingCost !== null) {
      updates.standingCostCentsPerDay = nextStandingCost;
    }

    setBusyId(workCenter.id);
    try {
      await patchJson<WorkCenter>(`/api/work-centers/${workCenter.id}`, updates);
      setDraft(null);
      showToast(`Updated ${nextName}`);
      await refetchWorkCenters();
    } catch (editError) {
      setDraft(null);
      showToast(
        editError instanceof Error
          ? editError.message
          : "Failed to update work center",
        "error",
      );
    } finally {
      setBusyId(null);
    }
  };

  /**
   * No confirm dialog: routing_steps.work_center_id is ON DELETE RESTRICT, so
   * a referenced centre is refused by the API with a 409 whose message names
   * the routings. That payload omits requiresConfirmation, so deleteConflict()
   * ignores it and it lands here as a plain error toast.
   */
  const runDelete = async (workCenter: WorkCenter) => {
    setBusyId(workCenter.id);
    try {
      const result = await deleteJson<{ id: number; name: string }>(
        `/api/work-centers/${workCenter.id}`,
      );
      // toast before refetching: a refetch failure shouldn't report a delete
      // that actually succeeded as a failure
      showToast(`Deleted ${result.name}`);
      await refetchWorkCenters();
    } catch (deleteError) {
      showToast(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete work center",
        "error",
      );
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-destructive">{error}</p>;

  return (
    <div className="flex h-full min-h-0 max-w-5xl flex-col">
      <PageHeader
        title="Work Centers"
        description="Machines parts queue for. More machines at a center is the lever for elevating a bottleneck."
      >
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> New Work Center
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <form onSubmit={submit} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>New work center</DialogTitle>
                <DialogDescription>
                  Nothing routes to it until a routing step uses it, so it stays
                  idle on the simulator until then.
                </DialogDescription>
              </DialogHeader>

              <Field label="Name">
                <Input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Heat Treat"
                />
              </Field>

              <Field label="Machines">
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={capacity}
                  onChange={(event) => setCapacity(event.target.value)}
                />
              </Field>

              <Field label="Standing cost ($/day)">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={standingCost}
                  onChange={(event) => setStandingCost(event.target.value)}
                />
              </Field>

              <DialogFooter>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating…" : "Create Work Center"}
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
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Machines</TableHead>
              <TableHead className="text-right">Standing cost ($/day)</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {workCenters.map((workCenter) => {
              const editing = draft?.id === workCenter.id ? draft : null;
              return (
                <TableRow key={workCenter.id}>
                  <TableCell>
                    <InlineInput
                      type="text"
                      aria-label={`Rename ${workCenter.name}`}
                      disabled={busyId === workCenter.id}
                      value={editing ? editing.name : workCenter.name}
                      onFocus={() => beginEdit(workCenter)}
                      onChange={(event) =>
                        setDraft((current) =>
                          current && { ...current, name: event.target.value },
                        )
                      }
                      onBlur={() => commitEdit(workCenter)}
                      className="w-full"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <InlineInput
                      type="number"
                      numeric
                      min={1}
                      step={1}
                      aria-label={`Machines at ${workCenter.name}`}
                      disabled={busyId === workCenter.id}
                      value={editing ? editing.capacity : workCenter.capacity}
                      onFocus={() => beginEdit(workCenter)}
                      onChange={(event) =>
                        setDraft((current) =>
                          current && {
                            ...current,
                            capacity: event.target.value,
                          },
                        )
                      }
                      onBlur={() => commitEdit(workCenter)}
                      className="w-20"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <InlineInput
                      type="number"
                      numeric
                      min={0}
                      step="0.01"
                      aria-label={`Standing cost at ${workCenter.name}`}
                      disabled={busyId === workCenter.id}
                      value={
                        editing
                          ? editing.standingCost
                          : (workCenter.standingCostCentsPerDay / 100).toFixed(2)
                      }
                      onFocus={() => beginEdit(workCenter)}
                      onChange={(event) =>
                        setDraft((current) =>
                          current && {
                            ...current,
                            standingCost: event.target.value,
                          },
                        )
                      }
                      onBlur={() => commitEdit(workCenter)}
                      className="w-28"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <DeleteButton
                      label={workCenter.name}
                      busy={busyId === workCenter.id}
                      onClick={() => runDelete(workCenter)}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
