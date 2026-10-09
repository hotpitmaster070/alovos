"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useT } from "@/lib/i18n/useT";
import { callLabelsApi, field } from "@/lib/labels/client";
import { PRODUCT_TYPES, productType, type ProductType } from "@/lib/labels/final";
import type { LabelsErrorCode } from "@/lib/labels/model";
import { PERCENT_MAX } from "@/lib/tenant-settings/validation";
import { ErrorText, LightInput, LightLabel, LightSelect, SECONDARY_BUTTON } from "./primitives";

type Loaded = { type: ProductType; salePrice: string; density: string; trimValue: string; canEdit: boolean };

const asText = (value: unknown): string => (typeof value === "number" || (typeof value === "string" && value !== "") ? String(value) : "");

/** Type, sale price, density and trim value of a product (owners and chefs edit; others see the type). */
export default function ProductEconomics({ productId }: { productId: string }) {
  const { t } = useT();
  const copy = t.labels.stock.economics;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<LabelsErrorCode | null>(null);

  useEffect(() => {
    let active = true;
    void callLabelsApi(`/api/products/${productId}/economics`, "GET").then((outcome) => {
      if (!active) return;
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      setLoaded({
        type: productType(field(outcome.data, "product_type")) ?? PRODUCT_TYPES[0],
        salePrice: asText(field(outcome.data, "sale_price")),
        density: asText(field(outcome.data, "density_kg_per_l")),
        trimValue: asText(field(outcome.data, "trim_value_percent")),
        canEdit: field(outcome.data, "can_edit") === true,
      });
    });
    return () => {
      active = false;
    };
  }, [productId]);

  if (!loaded) return error ? <ErrorText>{t.labels.errors[error]}</ErrorText> : null;

  const set = (patch: Partial<Loaded>) => {
    setSaved(false);
    setLoaded({ ...loaded, ...patch });
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const outcome = await callLabelsApi(`/api/products/${productId}/economics`, "PATCH", {
      product_type: loaded.type,
      sale_price: loaded.salePrice,
      density_kg_per_l: loaded.density,
      trim_value_percent: loaded.type === "trim" ? loaded.trimValue : "",
    });
    setPending(false);
    if (!outcome.ok) setError(outcome.error);
    else setSaved(true);
  };

  if (!loaded.canEdit) {
    return (
      <p className="text-[13px] text-white/60">
        {copy.type}: <span className="text-white">{t.labels.stock.types[loaded.type]}</span>
      </p>
    );
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="grid grid-cols-2 gap-x-3 gap-y-3 rounded-[16px] border border-line p-3">
      <p className="col-span-2 text-[13px] text-white/60">{copy.title}</p>
      <div className="col-span-2">
        <LightLabel htmlFor="eco-type">{copy.type}</LightLabel>
        <LightSelect id="eco-type" value={loaded.type} onChange={(event) => set({ type: productType(event.target.value) ?? loaded.type })}>
          {PRODUCT_TYPES.map((type) => (
            <option key={type} value={type}>
              {t.labels.stock.types[type]}
            </option>
          ))}
        </LightSelect>
      </div>
      <div>
        <LightLabel htmlFor="eco-sale">{copy.salePrice}</LightLabel>
        <LightInput
          id="eco-sale"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={loaded.salePrice}
          onChange={(event) => set({ salePrice: event.target.value })}
        />
      </div>
      <div>
        <LightLabel htmlFor="eco-density">{copy.density}</LightLabel>
        <LightInput
          id="eco-density"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={loaded.density}
          onChange={(event) => set({ density: event.target.value })}
        />
      </div>
      {loaded.type === "trim" && (
        <div className="col-span-2">
          <LightLabel htmlFor="eco-trim" hint={copy.trimValueHint}>
            {copy.trimValue}
          </LightLabel>
          <LightInput
            id="eco-trim"
            type="number"
            inputMode="decimal"
            min="0"
            max={PERCENT_MAX}
            step="any"
            value={loaded.trimValue}
            onChange={(event) => set({ trimValue: event.target.value })}
          />
        </div>
      )}
      {error && (
        <div className="col-span-2">
          <ErrorText>{t.labels.errors[error]}</ErrorText>
        </div>
      )}
      <div className="col-span-2 flex items-center gap-3">
        <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
          {pending ? t.anbar.working : copy.save}
        </button>
        {saved && <span role="status" className="text-[13px] text-green-400">{copy.saved}</span>}
      </div>
    </form>
  );
}
