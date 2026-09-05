import { useState } from "react";
import { patchSettings } from "../../api/settings";
import PageHeader from "../../components/PageHeader";
import { Field } from "../../components/ui/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { dollarsToCents } from "../../orders/salesOrderMath";
import {
  POLICY_HINTS,
  POLICY_LABELS,
  type ReleasePolicyKind,
} from "../../simulation/releasePolicy";
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
  const { settings, loading, error, refetchSettings, workCenters } = useSetupData();
  const { showToast } = useToast();

  // drafts, like the setup tables: null shows the server value, so a refetch
  // can't clobber text mid-edit and a successful save falls back to the new
  // server values by clearing them
  const [overheadDraft, setOverheadDraft] = useState<string | null>(null);
  const [carryingPctDraft, setCarryingPctDraft] = useState<string | null>(null);
  const [shiftsDraft, setShiftsDraft] = useState<string | null>(null);
  const [policyDraft, setPolicyDraft] = useState<ReleasePolicyKind | null>(null);
  const [capDraft, setCapDraft] = useState<string | null>(null);
  const [leadDraft, setLeadDraft] = useState<string | null>(null);
  const [drumDraft, setDrumDraft] = useState<string | null>(null);
  const [bufferDraft, setBufferDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const overhead =
    overheadDraft ??
    (settings ? (settings.facilityOverheadCentsPerDay / 100).toFixed(2) : "");
  const carryingPct =
    carryingPctDraft ??
    (settings ? (settings.wipCarryingBpsPerDay / 100).toString() : "");
  const shifts = shiftsDraft ?? (settings ? String(settings.shifts) : "1");
  const policy = policyDraft ?? settings?.releasePolicy ?? "manual";
  const wipCap = capDraft ?? (settings ? String(settings.wipCap) : "200");
  const leadDays = leadDraft ?? (settings ? String(settings.releaseLeadDays) : "1");
  const drum =
    drumDraft ??
    (settings?.drumWorkCenterId != null ? String(settings.drumWorkCenterId) : "");
  const drumBuffer = bufferDraft ?? (settings ? String(settings.drumBuffer) : "50");

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

    const parsedCap = Number(wipCap);
    if (policy === "conwip" && (!Number.isInteger(parsedCap) || parsedCap < 1)) {
      return showToast("WIP cap must be a whole number above zero", "error");
    }
    const parsedLead = Number(leadDays);
    if (policy === "due_date" && (!Number.isInteger(parsedLead) || parsedLead < 0)) {
      return showToast("Lead days must be zero or more", "error");
    }
    if (policy === "dbr" && drum === "") {
      return showToast("Drum-buffer-rope needs a drum work center", "error");
    }
    const parsedBuffer = Number(drumBuffer);
    if (policy === "dbr" && (!Number.isInteger(parsedBuffer) || parsedBuffer < 1)) {
      return showToast("Drum buffer must be a whole number above zero", "error");
    }

    setSaving(true);
    try {
      await patchSettings({
        facilityOverheadCentsPerDay: overheadCents,
        wipCarryingBpsPerDay: carryingBps,
        shifts: parsedShifts,
        releasePolicy: policy,
        ...(Number.isInteger(parsedCap) && parsedCap >= 1
          ? { wipCap: parsedCap }
          : {}),
        ...(Number.isInteger(parsedLead) && parsedLead >= 0
          ? { releaseLeadDays: parsedLead }
          : {}),
        drumWorkCenterId: drum === "" ? null : Number(drum),
        ...(Number.isInteger(parsedBuffer) && parsedBuffer >= 1
          ? { drumBuffer: parsedBuffer }
          : {}),
      });
      await refetchSettings();
      setOverheadDraft(null);
      setCarryingPctDraft(null);
      setShiftsDraft(null);
      setPolicyDraft(null);
      setCapDraft(null);
      setLeadDraft(null);
      setDrumDraft(null);
      setBufferDraft(null);
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

          <Field label="Release policy (a new run freezes this default)">
            <Select
              value={policy}
              onValueChange={(value) => setPolicyDraft(value as ReleasePolicyKind)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(POLICY_LABELS) as ReleasePolicyKind[]).map(
                  (option) => (
                    <SelectItem key={option} value={option}>
                      {POLICY_LABELS[option]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </Field>
          <p className="text-xs text-muted-foreground">{POLICY_HINTS[policy]}</p>

          {policy === "conwip" && (
            <Field label="WIP cap (parts on the floor)">
              <Input
                type="number"
                min={1}
                step={1}
                value={wipCap}
                onChange={(event) => setCapDraft(event.target.value)}
              />
            </Field>
          )}

          {policy === "due_date" && (
            <Field label="Lead time (calendar days before due)">
              <Input
                type="number"
                min={0}
                step={1}
                value={leadDays}
                onChange={(event) => setLeadDraft(event.target.value)}
              />
            </Field>
          )}

          {policy === "dbr" && (
            <>
              <Field label="Drum (the constraint work center)">
                <Select value={drum} onValueChange={setDrumDraft}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pick the bottleneck" />
                  </SelectTrigger>
                  <SelectContent>
                    {workCenters.map((center) => (
                      <SelectItem key={center.id} value={String(center.id)}>
                        {center.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Buffer (parts at the drum)">
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={drumBuffer}
                  onChange={(event) => setBufferDraft(event.target.value)}
                />
              </Field>
            </>
          )}

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
