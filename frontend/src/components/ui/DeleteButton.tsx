import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={`Delete ${label}`}
      disabled={busy}
      onClick={onClick}
      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
    >
      <Trash2 className="size-4" />
    </Button>
  );
}
