import { useCallback, useState } from "react";
import {
  deleteConflict,
  deleteJson,
  patchJson,
  postJson,
} from "../../api/client";
import { useSetupData } from "../../setup/SetupDataContext";
import { useToast } from "../../toast/ToastContext";
import ConfirmDialog from "../../components/orders/ConfirmDialog";
import {
  Field,
  FormCard,
  SubmitButton,
  inputClass,
} from "../../components/ui/Form";
import { Table, THead, Th, Tr, Td } from "../../components/ui/Table";
import DeleteButton from "../../components/ui/DeleteButton";
import InlineInput from "../../components/ui/InlineInput";
import { dollarsToCents } from "../../orders/salesOrderMath";
import type { Part } from "../../types/Part";

/** The row being edited. Only one row is editable at a time. */
type Draft = {
  id: number;
  partNumber: string;
  name: string;
  materialCost: string;
};

type PendingDelete = { id: number; partNumber: string; routings: string[] };

/** Cents to the dollars string the inline input edits. */
function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export default function PartsPage() {
  const { parts, routings, loading, error, refetchParts } = useSetupData();
  const { showToast } = useToast();

  const [partNumber, setPartNumber] = useState("");
  const [name, setName] = useState("");
  const [materialCost, setMaterialCost] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  // a part with no routing can't be built, so the count is worth surfacing
  const routingCount = new Map<number, number>();
  for (const routing of routings) {
    routingCount.set(routing.partId, (routingCount.get(routing.partId) ?? 0) + 1);
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    // no strictNullChecks in this project, so guard the empty-field NaN explicitly
    const trimmedNumber = partNumber.trim();
    const trimmedName = name.trim();
    const costCents = dollarsToCents(materialCost);

    if (!trimmedNumber) return showToast("Part number is required", "error");
    if (!trimmedName) return showToast("Name is required", "error");
    if (costCents === null || costCents < 0) {
      return showToast("Material cost must be zero or more", "error");
    }

    setSubmitting(true);
    try {
      const created = await postJson<Part>("/api/parts", {
        partNumber: trimmedNumber,
        name: trimmedName,
        materialCostCents: costCents,
      });

      await refetchParts();
      showToast(`Created ${created.partNumber}`);
      setPartNumber("");
      setName("");
      setMaterialCost("");
    } catch (submitError) {
      showToast(
        submitError instanceof Error
          ? submitError.message
          : "Failed to create part",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // seeded on focus rather than kept for every row, so a refetch can't clobber
  // text someone is mid-way through typing
  const beginEdit = (part: Part) => {
    setDraft((current) =>
      current?.id === part.id
        ? current
        : {
            id: part.id,
            partNumber: part.partNumber,
            name: part.name,
            materialCost: centsToDollars(part.materialCostCents),
          },
    );
  };

  /**
   * Commits on blur. Only changed fields are sent, so editing the cost can't
   * collide with a rename. Any failure drops the draft, which reverts the
   * inputs to the server values.
   */
  const commitEdit = async (part: Part) => {
    if (!draft || draft.id !== part.id) return;

    const nextNumber = draft.partNumber.trim();
    const nextName = draft.name.trim();
    const nextCost = dollarsToCents(draft.materialCost);

    const numberChanged = nextNumber !== part.partNumber;
    const nameChanged = nextName !== part.name;
    const costChanged = nextCost !== null && nextCost !== part.materialCostCents;

    if (!numberChanged && !nameChanged && !costChanged) return setDraft(null);

    if (!nextNumber) {
      setDraft(null);
      return showToast("Part number is required", "error");
    }
    if (!nextName) {
      setDraft(null);
      return showToast("Name is required", "error");
    }
    if (nextCost === null || nextCost < 0) {
      setDraft(null);
      return showToast("Material cost must be zero or more", "error");
    }

    const updates: {
      partNumber?: string;
      name?: string;
      materialCostCents?: number;
    } = {};
    if (numberChanged) updates.partNumber = nextNumber;
    if (nameChanged) updates.name = nextName;
    if (costChanged) updates.materialCostCents = nextCost;

    setBusyId(part.id);
    try {
      await patchJson<Part>(`/api/parts/${part.id}`, updates);
      setDraft(null);
      showToast(`Updated ${nextNumber}`);
      await refetchParts();
    } catch (editError) {
      setDraft(null);
      showToast(
        editError instanceof Error ? editError.message : "Failed to update part",
        "error",
      );
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Two failure modes, and they are not the same. A part held by work or sales
   * orders is refused outright (ON DELETE RESTRICT) with a 409 that omits
   * requiresConfirmation, so deleteConflict() returns null and it falls through
   * to an error toast. A part with routings can be deleted, but the routings and
   * their steps go too - that 409 sets the flag and opens the dialog.
   */
  const runDelete = async (
    part: { id: number; partNumber: string },
    force: boolean,
  ) => {
    setBusyId(part.id);
    try {
      const result = await deleteJson<{
        partNumber: string;
        deletedRoutings: number;
      }>(`/api/parts/${part.id}${force ? "?force=true" : ""}`);

      setPendingDelete(null);
      // toast before refetching: a refetch failure shouldn't report a delete
      // that actually succeeded as a failure
      showToast(
        result.deletedRoutings > 0
          ? `Deleted ${result.partNumber} and ${result.deletedRoutings} routing(s)`
          : `Deleted ${result.partNumber}`,
      );
      await refetchParts();
    } catch (deleteError) {
      const conflict = deleteConflict(deleteError);
      if (conflict) {
        setPendingDelete({
          id: part.id,
          partNumber: part.partNumber,
          routings: conflict.routings ?? [],
        });
        return;
      }
      setPendingDelete(null);
      showToast(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete part",
        "error",
      );
    } finally {
      setBusyId(null);
    }
  };

  // stable identity so ConfirmDialog's Escape listener doesn't re-register
  const cancelDelete = useCallback(() => setPendingDelete(null), []);

  if (loading) return <p className="text-slate-500">Loading…</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold">Parts</h1>
      <p className="mt-1 text-sm text-slate-500">
        What the factory makes. Material cost is subtracted from the sale price
        to give throughput, so it is the only variable cost in the model.
      </p>

      <FormCard onSubmit={submit}>
        <Field label="Part number">
          <input
            type="text"
            value={partNumber}
            onChange={(event) => setPartNumber(event.target.value)}
            placeholder="300-001"
            className={inputClass}
          />
        </Field>

        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Bushing"
            className={inputClass}
          />
        </Field>

        <Field label="Material cost (USD)">
          <input
            type="number"
            min="0"
            step="0.01"
            value={materialCost}
            onChange={(event) => setMaterialCost(event.target.value)}
            className={inputClass}
          />
        </Field>

        <SubmitButton busy={submitting} busyLabel="Creating…">
          Create Part
        </SubmitButton>
      </FormCard>

      <p className="mt-6 text-sm text-slate-500">
        A part with no routing can't be built — no work order can be created for
        it until one exists.
      </p>

      <div className="mt-2">
        <Table>
          <THead>
            <Th>Part number</Th>
            <Th>Name</Th>
            <Th numeric>Material cost</Th>
            <Th numeric>Routings</Th>
            <Th />
          </THead>
          <tbody>
            {parts.map((part) => {
              const editing = draft?.id === part.id ? draft : null;
              const count = routingCount.get(part.id) ?? 0;
              return (
                <Tr key={part.id}>
                  <Td>
                    <InlineInput
                      type="text"
                      aria-label={`Part number for ${part.name}`}
                      disabled={busyId === part.id}
                      value={editing ? editing.partNumber : part.partNumber}
                      onFocus={() => beginEdit(part)}
                      onChange={(event) =>
                        setDraft(
                          (current) =>
                            current && {
                              ...current,
                              partNumber: event.target.value,
                            },
                        )
                      }
                      onBlur={() => commitEdit(part)}
                      className="w-full"
                    />
                  </Td>
                  <Td>
                    <InlineInput
                      type="text"
                      aria-label={`Name for ${part.partNumber}`}
                      disabled={busyId === part.id}
                      value={editing ? editing.name : part.name}
                      onFocus={() => beginEdit(part)}
                      onChange={(event) =>
                        setDraft(
                          (current) =>
                            current && { ...current, name: event.target.value },
                        )
                      }
                      onBlur={() => commitEdit(part)}
                      className="w-full"
                    />
                  </Td>
                  <Td className="text-right">
                    <InlineInput
                      type="number"
                      numeric
                      min="0"
                      step="0.01"
                      aria-label={`Material cost for ${part.partNumber}`}
                      disabled={busyId === part.id}
                      value={
                        editing
                          ? editing.materialCost
                          : centsToDollars(part.materialCostCents)
                      }
                      onFocus={() => beginEdit(part)}
                      onChange={(event) =>
                        setDraft(
                          (current) =>
                            current && {
                              ...current,
                              materialCost: event.target.value,
                            },
                        )
                      }
                      onBlur={() => commitEdit(part)}
                      className="w-24"
                    />
                  </Td>
                  <Td
                    numeric
                    className={count === 0 ? "text-red-600" : "text-slate-500"}
                  >
                    {count}
                  </Td>
                  <Td className="text-right">
                    <DeleteButton
                      label={part.partNumber}
                      busy={busyId === part.id}
                      onClick={() => runDelete(part, false)}
                    />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.partNumber}?`}
          confirmLabel="Delete"
          busy={busyId === pendingDelete.id}
          onCancel={cancelDelete}
          onConfirm={() =>
            runDelete(
              { id: pendingDelete.id, partNumber: pendingDelete.partNumber },
              true,
            )
          }
          body={
            <>
              <p>These routings are deleted with it:</p>
              <ul className="mt-1 list-disc pl-5">
                {pendingDelete.routings.map((routing) => (
                  <li key={routing}>{routing}</li>
                ))}
              </ul>
              <p className="mt-2">
                Every step inside them goes too. This can't be undone.
              </p>
            </>
          }
        />
      )}
    </div>
  );
}
