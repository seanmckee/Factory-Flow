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
import {
  blankDraftFields,
  changedColumns,
  fieldText,
  parseFields,
  toDraftFields,
  WORK_CENTER_FIELDS,
  type WorkCenterField,
} from "../../setup/workCenterFields";
import type { WorkCenter } from "../../types/WorkCenter";

/**
 * The row being edited. Only one row is editable at a time, and the numeric
 * fields live in one bag keyed by the spec in `workCenterFields.ts` — eight
 * separately-declared fields is how a column ends up editable but never
 * committed.
 */
type Draft = {
  id: number;
  name: string;
  fields: Record<string, string>;
};

export default function WorkCentersPage() {
  const { workCenters, loading, error, refetchWorkCenters } = useSetupData();
  const { showToast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [newFields, setNewFields] = useState(blankDraftFields);
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const trimmed = name.trim();
    if (!trimmed) return showToast("Name is required", "error");

    const parsed = parseFields(newFields);
    if (!parsed.ok) return showToast(parsed.message, "error");

    setSubmitting(true);
    try {
      const body: Record<string, string | number> = { name: trimmed };
      for (const field of WORK_CENTER_FIELDS) {
        const value = parsed.values[field.key];
        if (value !== undefined) body[field.column] = value;
      }
      const created = await postJson<WorkCenter>("/api/work-centers", body);

      await refetchWorkCenters();
      showToast(`Created ${created.name}`);
      setName("");
      setNewFields(blankDraftFields());
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
            fields: toDraftFields(workCenter),
          },
    );
  };

  const editField = (key: string, value: string) => {
    setDraft(
      (current) =>
        current && { ...current, fields: { ...current.fields, [key]: value } },
    );
  };

  /**
   * Commits on blur. Only changed columns are sent, so one person's capacity
   * edit can't collide with another's rename. Any failure drops the draft,
   * which reverts the inputs to the server values.
   */
  const commitEdit = async (workCenter: WorkCenter) => {
    if (!draft || draft.id !== workCenter.id) return;

    const nextName = draft.name.trim();
    const renamed = nextName !== workCenter.name;

    const parsed = parseFields(draft.fields);
    if (!parsed.ok) {
      setDraft(null);
      return showToast(parsed.message, "error");
    }

    const updates: Record<string, string | number> = changedColumns(
      parsed.values,
      workCenter,
    );
    if (renamed) {
      if (!nextName) {
        setDraft(null);
        return showToast("Name is required", "error");
      }
      updates.name = nextName;
    }
    if (Object.keys(updates).length === 0) return setDraft(null);

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

  /** One editable numeric cell, bound to the draft. */
  const NumberCell = ({
    field,
    workCenter,
  }: {
    field: WorkCenterField;
    workCenter: WorkCenter;
  }) => {
    const editing = draft?.id === workCenter.id ? draft : null;
    return (
      <TableCell className="text-right">
        <InlineInput
          type="number"
          numeric
          min={field.min}
          step={field.kind === "money" ? "0.01" : 1}
          aria-label={`${field.label} at ${workCenter.name}`}
          disabled={busyId === workCenter.id}
          value={
            editing
              ? (editing.fields[field.key] ?? "")
              : fieldText(field, workCenter[field.column])
          }
          onFocus={() => beginEdit(workCenter)}
          onChange={(event) => editField(field.key, event.target.value)}
          onBlur={() => commitEdit(workCenter)}
          className={field.width}
        />
      </TableCell>
    );
  };

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-destructive">{error}</p>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Work Centers"
        description="Machines parts queue for, and the people who run them. A centre runs min(machines, operators) parts at once, so both halves are levers — and both cost money."
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

              {WORK_CENTER_FIELDS.map((field) => (
                <Field
                  key={field.key}
                  label={
                    field.unit ? `${field.label} (${field.unit})` : field.label
                  }
                >
                  <Input
                    type="number"
                    min={field.min}
                    step={field.kind === "money" ? "0.01" : 1}
                    value={newFields[field.key] ?? ""}
                    onChange={(event) =>
                      setNewFields((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                  />
                </Field>
              ))}

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
              {WORK_CENTER_FIELDS.map((field) => (
                <TableHead key={field.key} className="text-right">
                  {field.label}
                  {field.kind === "money" && (
                    <span className="font-normal text-muted-foreground"> $</span>
                  )}
                </TableHead>
              ))}
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
                        setDraft(
                          (current) =>
                            current && { ...current, name: event.target.value },
                        )
                      }
                      onBlur={() => commitEdit(workCenter)}
                      className="w-full"
                    />
                  </TableCell>
                  {WORK_CENTER_FIELDS.map((field) => (
                    <NumberCell
                      key={field.key}
                      field={field}
                      workCenter={workCenter}
                    />
                  ))}
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
