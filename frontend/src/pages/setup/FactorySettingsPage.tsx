import { useState } from "react";
import { patchSettings } from "../../api/settings";
import PageHeader from "../../components/PageHeader";
import { Field } from "../../components/ui/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dollarsToCents } from "../../orders/salesOrderMath";
import { useSetupData } from "../../setup/SetupDataContext";
import { useToast } from "../../toast/ToastContext";

/**
 * The facility-level cost rates — a singleton form with an explicit Save, not
 * an InlineInput table: the tables-are-their-own-edit-surface convention is
 * about rows, and this page is the future home of calendar/shift settings too.
 *
 * Rates are per calendar day and freeze onto a run at creation, so an edit
 * here changes the next run, never one already created.
 */
export default function FactorySettingsPage() {
  const { settings, loading, error, refetchSettings } = useSetupData();
  const { showToast } = useToast();

  // drafts, like the setup tables: null shows the server value, so a refetch
  // can't clobber text mid-edit and a successful save falls back to the new
  // server values by clearing them
  const [overheadDraft, setOverheadDraft] = useState<string | null>(null);
  const [carryingPctDraft, setCarryingPctDraft] = useState<string | null>(null);
  const [shiftsDraft, setShiftsDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const overhead =
    overheadDraft ??
    (settings ? (settings.facilityOverheadCentsPerDay / 100).toFixed(2) : "");
  const carryingPct =
    carryingPctDraft ??
    (settings ? (settings.wipCarryingBpsPerDay / 100).toString() : "");
  const shifts = shiftsDraft ?? (settings ? String(settings.shifts) : "1");

  const save = async (event: React.FormEvent) => {
    event.preventDefault();

    const overheadCents = dollarsToCents(overhead);
    if (overheadCents === null || overheadCents < 0) {
      return showToast("Facility overhead must be zero or more", "error");
    }
    const parsedPct = Number.parseFloat(carryingPct);
    if (!Number.isFinite(parsedPct) || parsedPct < 0) {
      return showToast("Carrying rate must be zero or more", "error");
    }
    // percent to basis points is the one conversion; rounding keeps it integer
    const carryingBps = Math.round(parsedPct * 100);
    const parsedShifts = Number(shifts);
    if (!Number.isInteger(parsedShifts) || parsedShifts < 1 || parsedShifts > 3) {
      return showToast("Shifts must be 1, 2 or 3", "error");
    }

    setSaving(true);
    try {
      await patchSettings({
        facilityOverheadCentsPerDay: overheadCents,
        wipCarryingBpsPerDay: carryingBps,
        shifts: parsedShifts,
      });
      await refetchSettings();
      setOverheadDraft(null);
      setCarryingPctDraft(null);
      setShiftsDraft(null);
      showToast("Saved factory settings");
    } catch (saveError) {
      showToast(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save factory settings",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-destructive">{error}</p>;

  return (
    <div className="flex h-full min-h-0 max-w-5xl flex-col">
      <PageHeader
        title="Factory Settings"
        description="Facility-level cost rates, per calendar day. A run freezes these at creation, so edits apply to the next run."
      />

      <div className="min-h-0 flex-1 overflow-auto">
        <form
          onSubmit={save}
          className="flex max-w-md flex-col gap-4 rounded-lg border bg-card p-6"
        >
          <Field label="Facility overhead ($/day)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={overhead}
              onChange={(event) => setOverheadDraft(event.target.value)}
            />
          </Field>

          <Field label="WIP carrying rate (%/day of material value on the floor)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={carryingPct}
              onChange={(event) => setCarryingPctDraft(event.target.value)}
            />
          </Field>

          <Field label="Shifts per day (8 staffed hours each)">
            <Input
              type="number"
              min={1}
              max={3}
              step={1}
              value={shifts}
              onChange={(event) => setShiftsDraft(event.target.value)}
            />
          </Field>

          <div>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
