"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { buttonVariants } from "@/components/ui/button";
import { createBarcodeProductAction } from "@/lib/anbar/actions";
import { BARCODE_MAX_LENGTH, CATEGORY_MAX_LENGTH, NAME_MAX_LENGTH, SHELF_LIFE_MAX_DAYS } from "@/lib/anbar/constants";
import type { AnbarErrorCode } from "@/lib/anbar/errors";
import { UNITS, type Branch, type CatalogProduct, type StorageLocation } from "@/lib/anbar/types";
import { useT } from "@/lib/i18n/useT";
import AddStorageLocation from "../add-storage-location";
import { ErrorText, LightInput, LightLabel, LightSelect, PRIMARY_BUTTON } from "./primitives";

/** New catalog product in the dark sheet. The scanned code arrives pre-filled. */
export default function ProductCreateForm({
  code,
  branches,
  locations,
  categories,
  defaultBranchId,
  onCreated,
  onCancel,
}: {
  code: string | null;
  branches: Branch[];
  locations: StorageLocation[];
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
  const [branchId, setBranchId] = useState(defaultBranchId ?? "");
  const [list, setList] = useState(locations);
  const [locationId, setLocationId] = useState("");
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
  const visibleLocations = branchId ? list.filter((location) => location.branchId === branchId) : list;

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
        <LightSelect
          id="create-branch"
          name="branchId"
          value={branchId}
          onChange={(event) => {
            const next = event.target.value;
            setBranchId(next);
            if (next && list.find((location) => location.id === locationId)?.branchId !== next) setLocationId("");
          }}
        >
          <option value="">{copy.sharedBranch}</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </LightSelect>
      </div>

      <div className="col-span-2">
        <LightLabel htmlFor="create-storage" hint={shelf.optional}>
          {t.anbar.qebul.location}
        </LightLabel>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <LightSelect
              id="create-storage"
              name="storageLocationId"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              <option value="">{t.anbar.storage.none}</option>
              {visibleLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {!branchId && branches.length > 1
                    ? `${branchName.get(location.branchId) ?? ""} · ${location.name}`
                    : location.name}
                </option>
              ))}
            </LightSelect>
          </div>
          <AddStorageLocation
            branches={branches}
            branchId={branchId || null}
            onCreated={(location) => {
              setList((current) => [...current, location].sort((a, b) => a.name.localeCompare(b.name)));
              if (branchId && branchId !== location.branchId) setBranchId(location.branchId);
              setLocationId(location.id);
            }}
          />
        </div>
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
          className={buttonVariants("ghost")}
        >
          {t.anbar.addProduct.cancel}
        </button>
      </div>
    </form>
  );
}
