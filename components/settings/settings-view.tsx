"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { STORAGE_NAME_MAX_LENGTH } from "@/lib/anbar/constants";
import { STORAGE_TYPES, type StorageLocation } from "@/lib/anbar/types";
import { getBlock, getBlockLabel } from "@/lib/blocks";
import { MERGE_MODES } from "@/lib/count/model";
import type { TenantSettings } from "@/lib/tenant-settings/parse";
import {
  addBranch,
  addStorageLocation,
  addUnit,
  renameStorageLocation,
  saveTenantSettings,
  setStorageLocationActive,
} from "@/lib/settings/actions";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

type Named = { id: string; name: string };

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs text-white/60">
        {label}
      </label>
      {children}
    </div>
  );
}

const COPY = {
  AZ: {
    currency: "Valyuta",
    symbol: "Simvol",
    language: "Dil",
    stock: "Anbar",
    timezone: "Saat qurşağı",
    expiryWarn: "Qırmızı: qalan gün azdırsa",
    expiryCritical: "Sarı: qalan gün azdırsa",
    lowStock: "Az qalıq həddi (min_stock yoxdursa)",
    countMerge: "Sayımda eyni məhsulu bir neçə nəfər sayanda",
    branch: "Filial",
    address: "Ünvan",
    location: "Saxlama yeri",
    type: "Növ",
    unitCode: "Kod",
    unitName: "Ad",
    save: "Saxla",
    deactivate: "Deaktiv et",
    activate: "Aktiv et",
    inactive: "deaktiv",
  },
  RU: {
    currency: "Валюта",
    symbol: "Символ",
    language: "Язык",
    stock: "Склад",
    timezone: "Часовой пояс",
    expiryWarn: "Красный: осталось меньше дней",
    expiryCritical: "Жёлтый: осталось меньше дней",
    lowStock: "Порог «мало» (если у товара нет min_stock)",
    countMerge: "Если один товар посчитали несколько человек",
    branch: "Точка",
    address: "Адрес",
    location: "Место хранения",
    type: "Тип",
    unitCode: "Код",
    unitName: "Название",
    save: "Сохранить",
    deactivate: "Отключить",
    activate: "Включить",
    inactive: "отключено",
  },
  EN: {
    currency: "Currency",
    symbol: "Symbol",
    language: "Language",
    stock: "Stock",
    timezone: "Time zone",
    expiryWarn: "Red: fewer days left than",
    expiryCritical: "Yellow: fewer days left than",
    lowStock: "Low stock threshold (products without min_stock)",
    countMerge: "When several people count the same product",
    branch: "Branch",
    address: "Address",
    location: "Storage location",
    type: "Type",
    unitCode: "Code",
    unitName: "Name",
    save: "Save",
    deactivate: "Deactivate",
    activate: "Activate",
    inactive: "inactive",
  },
} as const;

export default function SettingsView({
  settings,
  branches,
  locations,
  units,
}: {
  settings: TenantSettings;
  branches: Named[];
  locations: StorageLocation[];
  units: { id: string; code: string; name: string }[];
}) {
  const { lang, t } = useT();
  const copy = COPY[lang];
  const storage = t.anbar.storage;
  const block = getBlock("sebeke");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight text-white">
        {block ? getBlockLabel(block, lang) : "sebeke"}
      </h1>

      <Card>
        <form action={saveTenantSettings} className="flex flex-col gap-3">
          <CardTitle className="text-[10px] uppercase tracking-widest text-muted">{copy.currency}</CardTitle>
          <Input name="currency" defaultValue={settings.currency} placeholder={copy.currency} required />
          <Input name="currency_symbol" defaultValue={settings.currencySymbol ?? ""} placeholder={copy.symbol} />
          <Input name="language" defaultValue={settings.language ?? ""} placeholder={copy.language} />
          <CardTitle className="mt-2 text-[10px] uppercase tracking-widest text-muted">{copy.stock}</CardTitle>
          <Field id="settings-timezone" label={copy.timezone}>
            <Input id="settings-timezone" name="timezone" defaultValue={settings.timezone} required />
          </Field>
          <Field id="settings-expiry-warn" label={copy.expiryWarn}>
            <Input
              id="settings-expiry-warn"
              name="expiry_warn_days"
              type="number"
              min="0"
              max="3650"
              step="1"
              defaultValue={settings.expiryWarnDays}
              required
            />
          </Field>
          <Field id="settings-expiry-critical" label={copy.expiryCritical}>
            <Input
              id="settings-expiry-critical"
              name="expiry_critical_days"
              type="number"
              min="0"
              max="3650"
              step="1"
              defaultValue={settings.expiryCriticalDays}
              required
            />
          </Field>
          <Field id="settings-low-stock" label={copy.lowStock}>
            <Input
              id="settings-low-stock"
              name="low_stock_default"
              type="number"
              min="0"
              step="1"
              defaultValue={settings.lowStockDefault}
              required
            />
          </Field>
          <Field id="settings-count-merge" label={copy.countMerge}>
            <Select id="settings-count-merge" name="count_merge_mode" defaultValue={settings.countMergeMode}>
              {MERGE_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {t.anbar.sayim.mergeModes[mode]}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit">{copy.save}</Button>
        </form>
      </Card>

      <Card>
        <CardTitle className="text-[10px] uppercase tracking-widest text-muted">{copy.branch}</CardTitle>
        <ul className="mt-3 flex flex-col gap-2 text-sm text-white">
          {branches.map((branch) => (
            <li key={branch.id}>{branch.name}</li>
          ))}
        </ul>
        <form action={addBranch} className="mt-4 flex flex-col gap-3">
          <Input name="name" placeholder={copy.branch} required />
          <Input name="address" placeholder={copy.address} />
          <Button type="submit">{copy.save}</Button>
        </form>
      </Card>

      <Card>
        <CardTitle className="text-[10px] uppercase tracking-widest text-muted">{copy.location}</CardTitle>
        <div className="mt-3 flex flex-col gap-5">
          {branches.map((branch) => {
            const rows = locations.filter((location) => location.branchId === branch.id);
            if (rows.length === 0) return null;
            return (
              <div key={branch.id} className="flex flex-col gap-2">
                {branches.length > 1 && <p className="text-xs text-white/50">{branch.name}</p>}
                <ul className="flex flex-col gap-2">
                  {rows.map((location) => (
                    <li key={location.id} className="flex flex-wrap items-center gap-2">
                      <form action={renameStorageLocation} className="flex min-w-0 flex-1 items-center gap-2">
                        <input type="hidden" name="id" value={location.id} />
                        <Input
                          name="name"
                          defaultValue={location.name}
                          required
                          maxLength={STORAGE_NAME_MAX_LENGTH}
                          aria-label={copy.location}
                          className={cn("min-w-0 flex-1", !location.active && "text-white/40")}
                        />
                        <span className="shrink-0 text-xs text-white/50">
                          {storage.types[location.type]}
                          {!location.active && ` · ${copy.inactive}`}
                        </span>
                        <Button type="submit" variant="outline" size="sm">
                          {copy.save}
                        </Button>
                      </form>
                      <form action={setStorageLocationActive}>
                        <input type="hidden" name="id" value={location.id} />
                        <input type="hidden" name="active" value={String(!location.active)} />
                        <Button type="submit" variant="ghost" size="sm">
                          {location.active ? copy.deactivate : copy.activate}
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        {branches.length > 0 && (
          <form action={addStorageLocation} className="mt-4 flex flex-col gap-3">
            <Input
              name="name"
              placeholder={storage.namePlaceholder}
              aria-label={copy.location}
              maxLength={STORAGE_NAME_MAX_LENGTH}
              required
            />
            <Select name="type" defaultValue="quru" aria-label={copy.type}>
              {STORAGE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {storage.types[type]}
                </option>
              ))}
            </Select>
            <Select name="branchId" defaultValue={branches[0]?.id} aria-label={copy.branch}>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
            <Button type="submit">{copy.save}</Button>
          </form>
        )}
      </Card>

      <Card>
        <CardTitle className="text-[10px] uppercase tracking-widest text-muted">{copy.unitName}</CardTitle>
        <ul className="mt-3 flex flex-col gap-2 text-sm text-white">
          {units.map((unit) => (
            <li key={unit.id}>
              {unit.code} · {unit.name}
            </li>
          ))}
        </ul>
        <form action={addUnit} className="mt-4 flex flex-col gap-3">
          <Input name="code" placeholder={copy.unitCode} required />
          <Input name="name" placeholder={copy.unitName} required />
          <Button type="submit">{copy.save}</Button>
        </form>
      </Card>
    </div>
  );
}
