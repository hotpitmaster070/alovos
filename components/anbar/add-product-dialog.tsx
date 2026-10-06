"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { addProductAction } from "@/lib/anbar/actions";
import { NAME_MAX_LENGTH } from "@/lib/anbar/constants";
import { UNITS, type Location } from "@/lib/anbar/types";
import { useT } from "@/lib/i18n/useT";
import ActionMessage from "./action-message";
import BarcodeField from "./barcode-field";
import { useAction } from "./use-action";

function ProductForm({
  locations,
  onCancel,
  onDone,
}: {
  locations: Location[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const { t } = useT();
  const copy = t.anbar.addProduct;
  const { pending, result, onSubmit } = useAction(addProductAction, { onSuccess: onDone });

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <Label htmlFor="add-product-name">{copy.name}</Label>
        <Input id="add-product-name" name="name" required maxLength={NAME_MAX_LENGTH} />
      </div>
      <div className="col-span-2">
        <BarcodeField id="add-product-barcode" name="barcode" label={copy.barcode} />
      </div>
      <div>
        <Label htmlFor="add-product-qty">{copy.qty}</Label>
        <Input
          id="add-product-qty"
          name="qty"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          defaultValue="0"
        />
      </div>
      <div>
        <Label htmlFor="add-product-unit">{copy.unit}</Label>
        <Select id="add-product-unit" name="unit" defaultValue="kg">
          {UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {t.anbar.units[unit]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="add-product-cost">{copy.cost}</Label>
        <Input id="add-product-cost" name="cost" type="number" inputMode="decimal" min="0" step="any" />
      </div>
      <div>
        <Label htmlFor="add-product-expiry">{copy.expiry}</Label>
        <Input id="add-product-expiry" name="expiryDate" type="date" />
      </div>
      <div className="col-span-2">
        <Label htmlFor="add-product-location">{copy.location}</Label>
        <Select id="add-product-location" name="locationId" defaultValue="">
          <option value="">{copy.noLocation}</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="col-span-2">
        <ActionMessage result={result} />
      </div>
      <div className="col-span-2 flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel}>
          {copy.cancel}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t.anbar.working : copy.submit}
        </Button>
      </div>
    </form>
  );
}

export default function AddProductDialog({
  open,
  locations,
  onClose,
  onDone,
}: {
  open: boolean;
  locations: Location[];
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
      title={t.anbar.addProduct.title}
      closeLabel={t.anbar.addProduct.cancel}
    >
      <ProductForm locations={locations} onCancel={onClose} onDone={onDone} />
    </Dialog>
  );
}
