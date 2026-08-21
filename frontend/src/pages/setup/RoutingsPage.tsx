import { Fragment, useState } from "react";
import { deleteJson, getJson, patchJson, postJson, putJson } from "../../api/client";
import { useSetupData } from "../../setup/SetupDataContext";
import { useToast } from "../../toast/ToastContext";
import {
  Field,
  FormCard,
  SubmitButton,
  inputClass,
} from "../../components/ui/Form";
import { Table, THead, Th, Tr, Td } from "../../components/ui/Table";
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

  if (loading) return <p className="text-slate-500">Loading…</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold">Routings</h1>
      <p className="mt-1 text-sm text-slate-500">
        The ordered operations a part goes through. Step order is the route
        through the factory, and the slowest step is what constrains it.
      </p>

      {workCenters.length === 0 && (
        <p className="mt-4 text-sm text-red-600">
          There are no work centers yet — create one before building a routing.
        </p>
      )}

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
                {part.partNumber} · {part.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Standard Rail Process"
            className={inputClass}
          />
        </Field>

        <Field label="Revision">
          <input
            type="text"
            value={revision}
            onChange={(event) => setRevision(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Steps">
          <StepEditor
            steps={newSteps}
            workCenters={workCenters}
            disabled={submitting}
            onChange={setNewSteps}
          />
        </Field>

        <SubmitButton busy={submitting} busyLabel="Creating…">
          Create Routing
        </SubmitButton>
      </FormCard>

      <div className="mt-6">
        <Table>
          <THead>
            <Th>Part</Th>
            <Th>Name</Th>
            <Th>Revision</Th>
            <Th numeric>Steps</Th>
            <Th />
          </THead>
          <tbody>
            {routings.map((routing) => {
              const editing = draft?.id === routing.id ? draft : null;
              const part = partById.get(routing.partId);
              const open = editingId === routing.id;
              return (
                // Fragment, not an array: the expanded editor is a second row
                // and React wants one key for the pair
                <Fragment key={routing.id}>
                  <Tr>
                    <Td>{part ? `${part.partNumber} · ${part.name}` : "—"}</Td>
                    <Td>
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
                    </Td>
                    <Td>
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
                    </Td>
                    <Td
                      numeric
                      className={
                        routing.stepCount === 0
                          ? "text-red-600"
                          : "text-slate-500"
                      }
                    >
                      {routing.stepCount}
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          aria-expanded={open}
                          disabled={busyId === routing.id}
                          onClick={() => toggleSteps(routing)}
                          className="rounded px-2 py-1 text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                        >
                          {open ? "Close" : "Edit steps"}
                        </button>
                        <DeleteButton
                          label={routing.name}
                          busy={busyId === routing.id}
                          onClick={() => runDelete(routing)}
                        />
                      </div>
                    </Td>
                  </Tr>

                  {open && (
                    <Tr>
                      <Td className="bg-slate-50" colSpan={5}>
                        {loadingSteps ? (
                          <p className="text-slate-500">Loading steps…</p>
                        ) : (
                          <div className="flex flex-col gap-3">
                            <StepEditor
                              steps={editSteps}
                              workCenters={workCenters}
                              disabled={busyId === routing.id}
                              onChange={setEditSteps}
                            />
                            <button
                              type="button"
                              disabled={busyId === routing.id}
                              onClick={() => saveSteps(routing)}
                              className="self-start bg-blue-500 text-white p-2 rounded-lg disabled:opacity-50"
                            >
                              {busyId === routing.id ? "Saving…" : "Save steps"}
                            </button>
                          </div>
                        )}
                      </Td>
                    </Tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
