import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import DeleteButton from "../ui/DeleteButton";
import {
  emptyStep,
  moveStep,
  removeStep,
  type StepDraft,
} from "../../setup/routingSteps";
import type { WorkCenter } from "../../types/WorkCenter";

/**
 * The ordered list of operations, shared by the create form and the inline
 * editor. Position is the whole point, so rows move rather than carrying a
 * sequence field - the server numbers them from array order on save.
 */
export default function StepEditor({
  steps,
  workCenters,
  disabled,
  onChange,
}: {
  steps: StepDraft[];
  workCenters: WorkCenter[];
  disabled?: boolean;
  onChange: (steps: StepDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<StepDraft>) => {
    onChange(
      steps.map((step, position) =>
        position === index ? { ...step, ...patch } : step,
      ),
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Work center</TableHead>
              <TableHead className="text-right">Process (s)</TableHead>
              <TableHead className="text-right">Setup (s)</TableHead>
              <TableHead className="text-right">Scrap (%)</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {steps.map((step, index) => (
              // index is the identity here: rows have no id until saved, and a
              // reorder swaps contents rather than keys
              <TableRow key={index}>
                <TableCell className="tabular-nums text-muted-foreground">
                  {index + 1}
                </TableCell>
                <TableCell>
                  <Select
                    disabled={disabled}
                    value={step.workCenterId}
                    onValueChange={(value) =>
                      update(index, { workCenterId: value })
                    }
                  >
                    <SelectTrigger
                      aria-label={`Work center for step ${index + 1}`}
                      className="w-full min-w-44"
                    >
                      <SelectValue placeholder="Select a work center" />
                    </SelectTrigger>
                    <SelectContent>
                      {workCenters.map((workCenter) => (
                        <SelectItem
                          key={workCenter.id}
                          value={String(workCenter.id)}
                        >
                          {workCenter.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    aria-label={`Process time for step ${index + 1}`}
                    disabled={disabled}
                    value={step.processTimeSeconds}
                    onChange={(event) =>
                      update(index, { processTimeSeconds: event.target.value })
                    }
                    className="ml-auto w-24 text-right tabular-nums"
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    aria-label={`Setup time for step ${index + 1}`}
                    disabled={disabled}
                    value={step.setupTimeSeconds}
                    onChange={(event) =>
                      update(index, { setupTimeSeconds: event.target.value })
                    }
                    className="ml-auto w-24 text-right tabular-nums"
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    aria-label={`Scrap rate for step ${index + 1}`}
                    disabled={disabled}
                    value={step.scrapPercent}
                    onChange={(event) =>
                      update(index, { scrapPercent: event.target.value })
                    }
                    className="ml-auto w-20 text-right tabular-nums"
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move step ${index + 1} up`}
                      disabled={disabled || index === 0}
                      onClick={() => onChange(moveStep(steps, index, -1))}
                    >
                      <ChevronUp className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move step ${index + 1} down`}
                      disabled={disabled || index === steps.length - 1}
                      onClick={() => onChange(moveStep(steps, index, 1))}
                    >
                      <ChevronDown className="size-4" />
                    </Button>
                    {/* the last step can't be removed - a routing needs one */}
                    <DeleteButton
                      label={`step ${index + 1}`}
                      busy={disabled === true || steps.length === 1}
                      onClick={() => onChange(removeStep(steps, index))}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...steps, emptyStep()])}
        className="self-start"
      >
        <Plus className="size-4" /> Add step
      </Button>
    </div>
  );
}
