import { ChevronDown, ChevronUp } from "lucide-react";
import { Table, THead, Th, Tr, Td } from "../ui/Table";
import DeleteButton from "../ui/DeleteButton";
import { inputClass } from "../ui/Form";
import {
  emptyStep,
  moveStep,
  removeStep,
  type StepDraft,
} from "../../setup/routingSteps";
import type { WorkCenter } from "../../types/WorkCenter";

const iconButtonClass =
  "rounded px-1 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent";

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
      <Table>
        <THead>
          <Th>#</Th>
          <Th>Work center</Th>
          <Th numeric>Process (s)</Th>
          <Th numeric>Setup (s)</Th>
          <Th />
        </THead>
        <tbody>
          {steps.map((step, index) => (
            // index is the identity here: rows have no id until saved, and a
            // reorder swaps contents rather than keys
            <Tr key={index}>
              <Td className="text-slate-400 tabular-nums">{index + 1}</Td>
              <Td>
                <select
                  aria-label={`Work center for step ${index + 1}`}
                  disabled={disabled}
                  value={step.workCenterId}
                  onChange={(event) =>
                    update(index, { workCenterId: event.target.value })
                  }
                  className={`${inputClass} w-full`}
                >
                  <option value="">Select a work center</option>
                  {workCenters.map((workCenter) => (
                    <option key={workCenter.id} value={workCenter.id}>
                      {workCenter.name}
                    </option>
                  ))}
                </select>
              </Td>
              <Td className="text-right">
                <input
                  type="number"
                  min={1}
                  step={1}
                  aria-label={`Process time for step ${index + 1}`}
                  disabled={disabled}
                  value={step.processTimeSeconds}
                  onChange={(event) =>
                    update(index, { processTimeSeconds: event.target.value })
                  }
                  className={`${inputClass} w-24 text-right tabular-nums`}
                />
              </Td>
              <Td className="text-right">
                <input
                  type="number"
                  min={0}
                  step={1}
                  aria-label={`Setup time for step ${index + 1}`}
                  disabled={disabled}
                  value={step.setupTimeSeconds}
                  onChange={(event) =>
                    update(index, { setupTimeSeconds: event.target.value })
                  }
                  className={`${inputClass} w-24 text-right tabular-nums`}
                />
              </Td>
              <Td className="text-right">
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    aria-label={`Move step ${index + 1} up`}
                    disabled={disabled || index === 0}
                    onClick={() => onChange(moveStep(steps, index, -1))}
                    className={iconButtonClass}
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move step ${index + 1} down`}
                    disabled={disabled || index === steps.length - 1}
                    onClick={() => onChange(moveStep(steps, index, 1))}
                    className={iconButtonClass}
                  >
                    <ChevronDown size={16} />
                  </button>
                  {/* the last step can't be removed - a routing needs one */}
                  <DeleteButton
                    label={`step ${index + 1}`}
                    busy={disabled === true || steps.length === 1}
                    onClick={() => onChange(removeStep(steps, index))}
                  />
                </div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>

      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...steps, emptyStep()])}
        className="self-start rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        Add step
      </button>
    </div>
  );
}
