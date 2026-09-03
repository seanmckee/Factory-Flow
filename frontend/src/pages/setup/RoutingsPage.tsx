import { Fragment, useState } from "react";
import { Plus } from "lucide-react";
import { deleteJson, getJson, patchJson, postJson, putJson } from "../../api/client";
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
import InlineInput from "../../components/ui/InlineInput";
import StepEditor from "../../components/setup/StepEditor";
import {
  emptyStep,
  parseSteps,
  toDrafts,
  type StepDraft,
} from "../../setup/routingSteps";
import type { Routing, RoutingSummary } from "../../types/Routing";

/** The routing whose name/revision is being edited. One row at a time. */
type Draft = { id: number; name: string; revision: string };

export default function RoutingsPage() {
  const { parts, routings, workCenters, loading, error, refetchRoutings } =
    useSetupData();
  const { showToast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [partId, setPartId] = useState("");
  const [name, setName] = useState("");
  const [revision, setRevision] = useState("A");
  const [newSteps, setNewSteps] = useState<StepDraft[]>([emptyStep()]);
  const [submitting, setSubmitting] = useState(false);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // steps aren't on the list response, so the editor fetches them on open
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editSteps, setEditSteps] = useState<StepDraft[]>([]);
  const [loadingSteps, setLoadingSteps] = useState(false);

  const partById = new Map(parts.map((part) => [part.id, part]));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    // no strictNullChecks in this project, so guard the empty-field NaN explicitly
    if (!partId) return showToast("Select a part", "error");
    const trimmedName = name.trim();
    if (!trimmedName) return showToast("Name is required", "error");
    const trimmedRevision = revision.trim();
    if (!trimmedRevision) return showToast("Revision is required", "error");

    const parsed = parseSteps(newSteps);
    if (!parsed.ok) return showToast(parsed.message, "error");

    setSubmitting(true);
    try {
      const created = await postJson<Routing>("/api/routings", {
        partId: Number(partId),
        name: trimmedName,
        revision: trimmedRevision,
        steps: parsed.steps,
      });

      await refetchRoutings();
      showToast(`Created ${created.name}`);
      setPartId("");
      setName("");
      setRevision("A");
      setNewSteps([emptyStep()]);
      setCreateOpen(false);
    } catch (submitError) {
      showToast(
        submitError instanceof Error
          ? submitError.message
          : "Failed to create routing",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const beginEdit = (routing: RoutingSummary) => {
    setDraft((current) =>
      current?.id === routing.id
        ? current
        : { id: routing.id, name: routing.name, revision: routing.revision },
    );
  };

  /** Commits name/revision on blur; steps go through their own Save button. */
  const commitEdit = async (routing: RoutingSummary) => {
    if (!draft || draft.id !== routing.id) return;

    const nextName = draft.name.trim();
    const nextRevision = draft.revision.trim();
    const renamed = nextName !== routing.name;
    const revised = nextRevision !== routing.revision;

    if (!renamed && !revised) return setDraft(null);
    if (!nextName || !nextRevision) {
      setDraft(null);
      return showToast("Name and revision are required", "error");
    }

    const updates: { name?: string; revision?: string } = {};
    if (renamed) updates.name = nextName;
    if (revised) updates.revision = nextRevision;

    setBusyId(routing.id);
    try {
      await patchJson<RoutingSummary>(`/api/routings/${routing.id}`, updates);
      setDraft(null);
      showToast(`Updated ${nextName}`);
      await refetchRoutings();
    } catch (editError) {
      setDraft(null);
      showToast(
        editError instanceof Error
          ? editError.message
          : "Failed to update routing",
        "error",
      );
    } finally {
      setBusyId(null);
    }
  };

  const toggleSteps = async (routing: RoutingSummary) => {
    if (editingId === routing.id) {
      setEditingId(null);
      return;
    }

    setEditingId(routing.id);
    setLoadingSteps(true);
    try {
      const full = await getJson<Routing>(`/api/routings/${routing.id}`);
      setEditSteps(toDrafts(full.steps));
    } catch (loadError) {
      setEditingId(null);
      showToast(
        loadError instanceof Error ? loadError.message : "Failed to load steps",
        "error",
      );
    } finally {
      setLoadingSteps(false);
    }
  };

  /**
   * Steps are replaced wholesale rather than patched individually, because
   * UNIQUE(routing_id, sequence) makes an incremental reorder collide halfway
   * through. The server renumbers from array order.
   */
  const saveSteps = async (routing: RoutingSummary) => {
    const parsed = parseSteps(editSteps);
    if (!parsed.ok) return showToast(parsed.message, "error");

    setBusyId(routing.id);
    try {
      await putJson<Routing>(`/api/routings/${routing.id}/steps`, {
        steps: parsed.steps,
      });
      showToast(`Saved ${parsed.steps.length} step(s) for ${routing.name}`);
      setEditingId(null);
      await refetchRoutings();
    } catch (saveError) {
      showToast(
        saveError instanceof Error ? saveError.message : "Failed to save steps",
        "error",
      );
    } finally {
      setBusyId(null);
    }
  };

  /**
   * No confirm dialog. Steps cascade away with the routing and are its own
   * content, not records to warn about; a routing held by a work order is
   * refused outright by the API with a 409 that omits requiresConfirmation, so
   * it lands here as an error toast.
   */
  const runDelete = async (routing: RoutingSummary) => {
    setBusyId(routing.id);
    try {
      const result = await deleteJson<{ name: string; deletedSteps: number }>(
        `/api/routings/${routing.id}`,
      );
      if (editingId === routing.id) setEditingId(null);
      // toast before refetching: a refetch failure shouldn't report a delete
      // that actually succeeded as a failure
      showToast(`Deleted ${result.name} and ${result.deletedSteps} step(s)`);
      await refetchRoutings();
    } catch (deleteError) {
      showToast(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete routing",
        "error",
      );
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-destructive">{error}</p>;

  return (
    <div className="flex h-full min-h-0 max-w-6xl flex-col">
      <PageHeader
        title="Routings"
        description="The ordered operations a part goes through. The slowest step is what constrains the route."
      >
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button disabled={workCenters.length === 0}>
              <Plus className="size-4" /> New Routing
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
            <form onSubmit={submit} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>New routing</DialogTitle>
                <DialogDescription>
                  Step order is the route through the factory. The server
                  numbers steps from the order below.
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                          {part.partNumber} · {part.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Name">
                  <Input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Standard Rail Process"
                  />
                </Field>

                <Field label="Revision">
                  <Input
                    type="text"
                    value={revision}
                    onChange={(event) => setRevision(event.target.value)}
                  />
                </Field>
              </div>

              <Field label="Steps">
                <StepEditor
                  steps={newSteps}
                  workCenters={workCenters}
                  disabled={submitting}
                  onChange={setNewSteps}
                />
              </Field>

              <DialogFooter>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating…" : "Create Routing"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {workCenters.length === 0 && (
        <p className="pb-4 text-sm text-destructive">
          There are no work centers yet — create one before building a routing.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Part</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Revision</TableHead>
              <TableHead className="text-right">Steps</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {routings.map((routing) => {
              const editing = draft?.id === routing.id ? draft : null;
              const part = partById.get(routing.partId);
              const open = editingId === routing.id;
              return (
                // Fragment, not an array: the expanded editor is a second row
                // and React wants one key for the pair
                <Fragment key={routing.id}>
                  <TableRow>
                    <TableCell>
                      {part ? `${part.partNumber} · ${part.name}` : "—"}
                    </TableCell>
                    <TableCell>
                      <InlineInput
                        type="text"
                        aria-label={`Rename ${routing.name}`}
                        disabled={busyId === routing.id}
                        value={editing ? editing.name : routing.name}
                        onFocus={() => beginEdit(routing)}
                        onChange={(event) =>
                          setDraft(
                            (current) =>
                              current && {
                                ...current,
                                name: event.target.value,
                              },
                          )
                        }
                        onBlur={() => commitEdit(routing)}
                        className="w-full"
                      />
                    </TableCell>
                    <TableCell>
                      <InlineInput
                        type="text"
                        aria-label={`Revision for ${routing.name}`}
                        disabled={busyId === routing.id}
                        value={editing ? editing.revision : routing.revision}
                        onFocus={() => beginEdit(routing)}
                        onChange={(event) =>
                          setDraft(
                            (current) =>
                              current && {
                                ...current,
                                revision: event.target.value,
                              },
                          )
                        }
                        onBlur={() => commitEdit(routing)}
                        className="w-20"
                      />
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        routing.stepCount === 0
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {routing.stepCount}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={open}
                          disabled={busyId === routing.id}
                          onClick={() => toggleSteps(routing)}
                        >
                          {open ? "Close" : "Edit steps"}
                        </Button>
                        <DeleteButton
                          label={routing.name}
                          busy={busyId === routing.id}
                          onClick={() => runDelete(routing)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>

                  {open && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell className="bg-muted/30 p-4" colSpan={5}>
                        {loadingSteps ? (
                          <p className="text-muted-foreground">Loading steps…</p>
                        ) : (
                          <div className="flex flex-col gap-3">
                            <StepEditor
                              steps={editSteps}
                              workCenters={workCenters}
                              disabled={busyId === routing.id}
                              onChange={setEditSteps}
                            />
                            <Button
                              type="button"
                              size="sm"
                              disabled={busyId === routing.id}
                              onClick={() => saveSteps(routing)}
                              className="self-start"
                            >
                              {busyId === routing.id ? "Saving…" : "Save steps"}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
