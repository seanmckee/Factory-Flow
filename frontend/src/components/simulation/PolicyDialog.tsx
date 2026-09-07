import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Field } from "../ui/Field";
import {
  POLICY_HINTS,
  POLICY_LABELS,
  type PolicyChange,
  type ReleasePolicyKind,
} from "../../simulation/releasePolicy";
import type { FloorWorkCenter, Run } from "../../api/runs";

/**
 * The run's release policy, editable mid-run — the CapitalDialog pattern: a
 * dialog off the transport bar, because a policy is a run-level decision, and
 * what informs it (which centre is the constraint) lives on the same page.
 * Drafts seed from the run each time the dialog opens, so it always edits the
 * policy as it stands.
 */
export function PolicyDialog({
  open,
  onOpenChange,
  run,
  centers,
  onApply,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: Run | null;
  centers: FloorWorkCenter[];
  onApply: (change: PolicyChange) => void;
  pending: boolean;
}) {
  // null drafts show the run's own values (the settings-page pattern), so an
  // opened dialog always edits the policy as it stands with no seeding effect
  const [kindDraft, setKindDraft] = useState<ReleasePolicyKind | null>(null);
  const [capDraft, setCapDraft] = useState<string | null>(null);
  const [leadDraft, setLeadDraft] = useState<string | null>(null);
  const [drumDraft, setDrumDraft] = useState<string | null>(null);
  const [bufferDraft, setBufferDraft] = useState<string | null>(null);

  const kind = kindDraft ?? run?.releasePolicy ?? "manual";
  const cap = capDraft ?? String(run?.wipCap ?? 200);
  const leadDays = leadDraft ?? String(run?.releaseLeadDays ?? 1);
  const drumId =
    drumDraft ?? (run?.drumWorkCenterId != null ? String(run.drumWorkCenterId) : "");
  const buffer = bufferDraft ?? String(run?.drumBuffer ?? 50);

  const clearDrafts = () => {
    setKindDraft(null);
    setCapDraft(null);
    setLeadDraft(null);
    setDrumDraft(null);
    setBufferDraft(null);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const change: PolicyChange = { releasePolicy: kind };
    if (kind === "conwip") {
      const parsed = Number(cap);
      if (!Number.isInteger(parsed) || parsed < 1) return;
      change.wipCap = parsed;
    }
    if (kind === "due_date") {
      const parsed = Number(leadDays);
      if (!Number.isInteger(parsed) || parsed < 0) return;
      change.releaseLeadDays = parsed;
    }
    if (kind === "dbr") {
      if (drumId === "") return;
      const parsed = Number(buffer);
      if (!Number.isInteger(parsed) || parsed < 1) return;
      change.drumWorkCenterId = Number(drumId);
      change.drumBuffer = parsed;
    }
    onApply(change);
  };

  const applyDisabled =
    pending ||
    (kind === "conwip" && !(Number(cap) >= 1)) ||
    (kind === "due_date" && !(Number(leadDays) >= 0)) ||
    (kind === "dbr" && (drumId === "" || !(Number(buffer) >= 1)));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) clearDrafts();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Release policy</DialogTitle>
            <DialogDescription>
              How this run puts the next work order on the floor while it
              advances. The change is this run's alone — effective from the
              next advance, and a fork keeps the policy it was forked with.
            </DialogDescription>
          </DialogHeader>

          <Field label="Policy">
            <Select
              value={kind}
              onValueChange={(value) => setKindDraft(value as ReleasePolicyKind)}
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
          <p className="text-xs text-muted-foreground">{POLICY_HINTS[kind]}</p>

          {kind === "conwip" && (
            <Field label="WIP cap (parts on the floor)">
              <Input
                type="number"
                min={1}
                step={1}
                value={cap}
                onChange={(event) => setCapDraft(event.target.value)}
              />
            </Field>
          )}

          {kind === "due_date" && (
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

          {kind === "dbr" && (
            <>
              <Field label="Drum (the constraint work center)">
                <Select value={drumId} onValueChange={setDrumDraft}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pick the bottleneck" />
                  </SelectTrigger>
                  <SelectContent>
                    {centers.map((center) => (
                      <SelectItem
                        key={center.workCenterId}
                        value={String(center.workCenterId)}
                      >
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
                  value={buffer}
                  onChange={(event) => setBufferDraft(event.target.value)}
                />
              </Field>
            </>
          )}

          <DialogFooter>
            <Button type="submit" disabled={applyDisabled}>
              {pending && <LoaderCircle className="size-4 animate-spin" />}
              {pending ? "Applying…" : "Apply Policy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
