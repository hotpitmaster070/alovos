"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createBarcodeProductAction } from "@/lib/anbar/actions";
import { NAME_MAX_LENGTH } from "@/lib/anbar/constants";
import { failure, type ActionResult } from "@/lib/anbar/errors";
import { UNITS, type Branch, type CatalogProduct } from "@/lib/anbar/types";
import { useT } from "@/lib/i18n/useT";
import ActionMessage from "./action-message";
import BarcodeField from "./barcode-field";

/** New product with an optional factory barcode. Products without one are found by internal_code. */
export default function BarcodeProductForm({
  code,
  branches,
  defaultBranchId,
  onCreated,
  onCancel,
}: {
  code: string | null;
  branches: Branch[];
  defaultBranchId: string | null;
  onCreated: (product: CatalogProduct) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const copy = t.anbar.barcode;
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setResult(null);
    startTransition(async () => {
      try {
        const created = await createBarcodeProductAction(data);
        if (created.ok) onCreated(created.product);
        else setResult(failure(created.error));
      } catch {
        setResult(failure("saveFailed"));
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <Label htmlFor="barcode-product-name">{copy.name}</Label>
        <Input id="barcode-product-name" name="name" required autoFocus maxLength={NAME_MAX_LENGTH} />
      </div>
      <div className="col-span-2">
        <BarcodeField
          id="barcode-product-barcode"
          name="barcode"
          label={t.anbar.fields.barcode}
          defaultValue={code ?? ""}
          placeholder={t.anbar.fields.noBarcode}
        />
      </div>
      <div>
        <Label htmlFor="barcode-product-unit">{copy.unit}</Label>
        <Select id="barcode-product-unit" name="unit" defaultValue="kg">
          {UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {t.anbar.units[unit]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="barcode-product-price">{copy.price}</Label>
        <Input
          id="barcode-product-price"
          name="pricePerUnit"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
        />
      </div>
      <div>
        <Label htmlFor="barcode-product-expiry">{t.anbar.fields.expiry}</Label>
        <Input id="barcode-product-expiry" name="expiryDate" type="date" />
      </div>
      <div>
        <Label htmlFor="barcode-product-branch">{copy.branch}</Label>
        <Select id="barcode-product-branch" name="branchId" defaultValue={defaultBranchId ?? ""}>
          <option value="">{copy.sharedBranch}</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="col-span-2">
        <ActionMessage result={result} />
      </div>
      <div className="col-span-2 flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel}>
          {t.anbar.addProduct.cancel}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t.anbar.working : copy.create}
        </Button>
      </div>
    </form>
  );
}
