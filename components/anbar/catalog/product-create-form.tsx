"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { createBarcodeProductAction } from "@/lib/anbar/actions";
import { BARCODE_MAX_LENGTH, CATEGORY_MAX_LENGTH, NAME_MAX_LENGTH, SHELF_LIFE_MAX_DAYS } from "@/lib/anbar/constants";
import type { AnbarErrorCode } from "@/lib/anbar/errors";
import { UNITS, type Branch, type CatalogProduct } from "@/lib/anbar/types";
import { useT } from "@/lib/i18n/useT";
import { ErrorText, LightInput, LightLabel, LightSelect, PRIMARY_BUTTON } from "./primitives";

/** New catalog product in the light sheet. The scanned code arrives pre-filled. */
export default function ProductCreateForm({
  code,
  branches,
  categories,
  defaultBranchId,
  onCreated,
  onCancel,
}: {
  code: string | null;
  branches: Branch[];
  categories: string[];
  defaultBranchId: string | null;
  onCreated: (product: CatalogProduct) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const copy = t.anbar.barcode;
  const shelf = t.anbar.shelf;
  const categoryListId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<AnbarErrorCode | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      try {
        const created = await createBarcodeProductAction(data);
        if (created.ok) onCreated(created.product);
        else setError(created.error);
      } catch {
        setError("saveFailed");
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-x-3 gap-y-4">
      <div className="col-span-2">
        <LightLabel htmlFor="create-name">{copy.name}</LightLabel>
        <LightInput id="create-name" name="name" required autoFocus maxLength={NAME_MAX_LENGTH} />
      </div>

      <div className="col-span-2">
        <LightLabel htmlFor="create-barcode" hint={shelf.optional}>
          {t.anbar.fields.barcode}
        </LightLabel>
        <LightInput
          id="create-barcode"
          name="barcode"
          defaultValue={code ?? ""}
          maxLength={BARCODE_MAX_LENGTH}
          inputMode="numeric"
          autoComplete="off"
          className="font-mono"
        />
      </div>

      <div className="col-span-2">
        <LightLabel htmlFor="create-category" hint={shelf.optional}>
          {shelf.category}
        </LightLabel>
        <LightInput
          id="create-category"
          name="category"
          list={categoryListId}
          maxLength={CATEGORY_MAX_LENGTH}
          placeholder={shelf.categoryPlaceholder}
          autoComplete="off"
        />
        <datalist id={categoryListId}>
          {categories.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
      </div>

      <div>
        <LightLabel htmlFor="create-unit">{copy.unit}</LightLabel>
        <LightSelect id="create-unit" name="unit" defaultValue="kg">
          {UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {t.anbar.units[unit]}
            </option>
          ))}
        </LightSelect>
      </div>

      <div>
        <LightLabel htmlFor="create-price">{copy.price}</LightLabel>
        <LightInput id="create-price" name="pricePerUnit" type="number" inputMode="decimal" min="0" step="any" />
      </div>

      <div>
        <LightLabel htmlFor="create-shelf-life">{shelf.shelfLifeDays}</LightLabel>
        <LightInput
          id="create-shelf-life"
          name="shelfLifeDays"
          type="number"
          inputMode="numeric"
          min="0"
          max={SHELF_LIFE_MAX_DAYS}
          step="1"
        />
      </div>

      <div>
        <LightLabel htmlFor="create-min-stock">{shelf.minStock}</LightLabel>
        <LightInput id="create-min-stock" name="minStock" type="number" inputMode="decimal" min="0" step="any" />
      </div>

      <div>
        <LightLabel htmlFor="create-expiry">{t.anbar.fields.expiry}</LightLabel>
        <LightInput id="create-expiry" name="expiryDate" type="date" />
      </div>

      <div>
        <LightLabel htmlFor="create-branch">{copy.branch}</LightLabel>
        <LightSelect id="create-branch" name="branchId" defaultValue={defaultBranchId ?? ""}>
          <option value="">{copy.sharedBranch}</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </LightSelect>
      </div>

      {error && (
        <div className="col-span-2">
          <ErrorText>{t.anbar.errors[error]}</ErrorText>
        </div>
      )}

      <div className="col-span-2 mt-2 flex flex-col gap-2">
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {pending ? t.anbar.working : copy.create}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-11 rounded-full text-[15px] font-medium text-neutral-500 transition-colors hover:text-neutral-900"
        >
          {t.anbar.addProduct.cancel}
        </button>
      </div>
    </form>
  );
}
