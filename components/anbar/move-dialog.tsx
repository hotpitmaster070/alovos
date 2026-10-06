"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { moveStockAction } from "@/lib/anbar/actions";
import type { Location, Product } from "@/lib/anbar/types";
import { validateMoveInput } from "@/lib/anbar/validation";
import { useT } from "@/lib/i18n/useT";
import ActionMessage from "./action-message";
import { useAction } from "./use-action";

type MoveDialogProps = {
  product: Product | null;
  locations: Location[];
  onClose: () => void;
  onMoved: () => void;
};

function MoveForm({
  product,
  locations,
  onCancel,
  onMoved,
}: {
  product: Product;
  locations: Location[];
  onCancel: () => void;
  onMoved: () => void;
}) {
  const { t } = useT();
  const copy = t.anbar.move;
  const { pending, result, onSubmit } = useAction(moveStockAction, {
    validate: (data) => {
      const check = validateMoveInput(data, product.qty);
      return check.ok ? null : check.error;
    },
    onSuccess: onMoved,
  });
  const targets = locations.filter((location) => location.id !== product.locationId);
  const unitLabel = t.anbar.units[product.unit as keyof typeof t.anbar.units] ?? product.unit;

  if (!product.locationId) {
    return <p className="text-sm text-white/60">{copy.needsLocation}</p>;
  }
  if (targets.length === 0) {
    return <p className="text-sm text-white/60">{copy.noTargets}</p>;
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="productId" value={product.id} />
      <input type="hidden" name="fromLocationId" value={product.locationId} />
      <div>
        <Label htmlFor="move-target">{copy.target}</Label>
        <Select id="move-target" name="toLocationId" required defaultValue="">
          <option value="" disabled>
            {copy.choose}
          </option>
          {targets.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="move-qty">{copy.qty}</Label>
        <Input
          id="move-qty"
          name="qty"
          type="number"
          inputMode="decimal"
          required
          min="0.001"
          max={product.qty}
          step="any"
          aria-describedby="move-qty-hint"
        />
        <p id="move-qty-hint" className="mt-1.5 text-xs text-white/50">
          {copy.available(product.qty, unitLabel)}
        </p>
      </div>
      <ActionMessage result={result} />
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel}>
          {copy.cancel}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? copy.working : copy.submit}
        </Button>
      </div>
    </form>
  );
}

export default function MoveDialog({ product, locations, onClose, onMoved }: MoveDialogProps) {
  const { t } = useT();
  const fromName = locations.find((location) => location.id === product?.locationId)?.name ?? "";

  return (
    <Dialog
      open={product !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t.anbar.move.title}
      description={product ? t.anbar.move.description(product.name, fromName) : undefined}
      closeLabel={t.anbar.move.cancel}
    >
      {product && (
        <MoveForm product={product} locations={locations} onCancel={onClose} onMoved={onMoved} />
      )}
    </Dialog>
  );
}
