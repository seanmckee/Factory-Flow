import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ConfirmDialogProps = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The destructive-action confirm. A thin wrapper over the shared Dialog so
 * callers keep the old prop shape; rendered only while a delete is pending, so
 * it is always open when mounted. Escape/overlay close is refused while the
 * delete is in flight - a request that is already running can't be cancelled
 * by closing the box that started it.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm text-muted-foreground [&_ul]:mt-1 [&_ul]:list-disc [&_ul]:pl-5 [&_p+p]:mt-2">
              {body}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? "Deleting…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
