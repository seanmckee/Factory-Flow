import { Trash2 } from "lucide-react";

/** The trash button in the last column of every list table. */
export default function DeleteButton({
  label,
  busy,
  onClick,
}: {
  /** What is being deleted, e.g. "SO-2001" - becomes the aria-label. */
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Delete ${label}`}
      disabled={busy}
      onClick={onClick}
      className="rounded px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      <Trash2 size={16} />
    </button>
  );
}
