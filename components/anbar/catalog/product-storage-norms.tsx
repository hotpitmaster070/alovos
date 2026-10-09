"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { StorageLocation } from "@/lib/anbar/types";
import { useT } from "@/lib/i18n/useT";
import { callLabelsApi } from "@/lib/labels/client";
import { SHELF_LIFE_DAYS_MAX, parseShelfLifeInfo, type LabelsErrorCode, type ShelfLifeInfo } from "@/lib/labels/model";
import { ErrorText, LightInput, SECONDARY_BUTTON } from "./primitives";

const ruleText = (info: ShelfLifeInfo, locationId: string): string =>
  info.rules[locationId] === undefined ? "" : String(info.rules[locationId]);

/** "" removes the rule; null: not a whole number of days in range. */
function daysOf(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return /^\d+$/.test(trimmed) && Number(trimmed) <= SHELF_LIFE_DAYS_MAX ? Number(trimmed) : undefined;
}

/**
 * How long the product keeps in each place of its branch: the rules public.get_shelf_life() reads first
 * on receipt and on a move to another kind of place. Empty falls back to the product's own shelf life.
 */
export default function ProductStorageNorms({ productId, locations }: { productId: string; locations: StorageLocation[] }) {
  const { t } = useT();
  const copy = t.labels.norms;
  const [info, setInfo] = useState<ShelfLifeInfo | null>(null);
  /** Edited fields only; the others show the saved rule. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<LabelsErrorCode | null>(null);

  useEffect(() => {
    let active = true;
    setInfo(null);
    setDraft({});
    void callLabelsApi(`/api/shelf-life-rules?product_id=${encodeURIComponent(productId)}`, "GET").then((outcome) => {
      if (!active) return;
      const parsed = outcome.ok ? parseShelfLifeInfo(outcome.data) : null;
      if (!parsed) {
        setError(outcome.ok ? "save_failed" : outcome.error);
        return;
      }
      setInfo(parsed);
    });
    return () => {
      active = false;
    };
  }, [productId]);

  if (locations.length === 0) return <p className="text-[13px] text-white/60">{copy.noPlaces}</p>;
  if (!info) return error ? <ErrorText>{t.labels.errors[error]}</ErrorText> : null;

  const fallback = info.productDays ?? info.defaultDays;
  const valueOf = (locationId: string): string => draft[locationId] ?? ruleText(info, locationId);
  const changes = locations.flatMap((location) => {
    const days = daysOf(valueOf(location.id));
    const current = info.rules[location.id] ?? null;
    return days === current ? [] : [{ location, days }];
  });
  const invalid = changes.some((change) => change.days === undefined);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (invalid || changes.length === 0) return;
    setPending(true);
    setError(null);
    setSaved(false);
    let latest = info;
    const rest = { ...draft };
    for (const change of changes) {
      const outcome = await callLabelsApi("/api/shelf-life-rules", "POST", {
        product_id: productId,
        storage_location_id: change.location.id,
        shelf_life_days: change.days,
      });
      const parsed = outcome.ok ? parseShelfLifeInfo(outcome.data) : null;
      if (!parsed) {
        setError(outcome.ok ? "save_failed" : outcome.error);
        break;
      }
      latest = parsed;
      delete rest[change.location.id];
    }
    setPending(false);
    setInfo(latest);
    setDraft(rest);
    setSaved(Object.keys(rest).length === 0);
  };

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-3 rounded-[16px] border border-line p-3">
      <div>
        <p className="text-[13px] text-white">{copy.title}</p>
        <p className="text-[12px] text-white/50">{copy.hint}</p>
      </div>
      <div className="flex flex-col gap-2">
        {locations.map((location) => (
          <div key={location.id} className="flex items-center justify-between gap-3">
            <label htmlFor={`norm-${location.id}`} className="min-w-0 truncate text-[14px] text-white/80">
              {location.name}
            </label>
            <LightInput
              id={`norm-${location.id}`}
              type="number"
              inputMode="numeric"
              min="0"
              max={SHELF_LIFE_DAYS_MAX}
              step="1"
              placeholder={copy.fallback(fallback)}
              aria-label={`${location.name} · ${copy.days}`}
              aria-invalid={daysOf(valueOf(location.id)) === undefined}
              value={valueOf(location.id)}
              onChange={(event) => {
                setSaved(false);
                setDraft({ ...draft, [location.id]: event.target.value });
              }}
              className="w-32"
            />
          </div>
        ))}
      </div>
      {error && <ErrorText>{error === "forbidden" ? copy.readOnly : t.labels.errors[error]}</ErrorText>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending || invalid || changes.length === 0} className={SECONDARY_BUTTON}>
          {pending ? t.anbar.working : copy.save}
        </button>
        {saved && <span role="status" className="text-[13px] text-green-400">{copy.saved}</span>}
      </div>
    </form>
  );
}
