"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addLocationAction } from "@/lib/anbar/actions";
import { NAME_MAX_LENGTH } from "@/lib/anbar/constants";
import { useT } from "@/lib/i18n/useT";
import ActionMessage from "./action-message";
import { useAction } from "./use-action";

function LocationForm({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const { t } = useT();
  const copy = t.anbar.addLocation;
  const { pending, result, onSubmit } = useAction(addLocationAction, { onSuccess: onDone });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="add-location-name">{copy.name}</Label>
        <Input id="add-location-name" name="name" required maxLength={NAME_MAX_LENGTH} />
      </div>
      <ActionMessage result={result} />
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel}>
          {t.anbar.addProduct.cancel}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t.anbar.working : copy.submit}
        </Button>
      </div>
    </form>
  );
}

export default function AddLocationDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useT();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t.anbar.addLocation.title}
      closeLabel={t.anbar.addProduct.cancel}
    >
      <LocationForm onCancel={onClose} onDone={onDone} />
    </Dialog>
  );
}
