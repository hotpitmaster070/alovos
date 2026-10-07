"use client";

import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getBlock, getBlockLabel } from "@/lib/blocks";
import type { TenantSettings } from "@/lib/money";
import { addBranch, addStorageLocation, addUnit, saveTenantSettings } from "@/lib/settings/actions";
import { useT } from "@/lib/i18n/useT";

type Named = { id: string; name: string };

const COPY = {
  AZ: {
    currency: "Valyuta",
    symbol: "Simvol",
    language: "Dil",
    branch: "Filial",
    address: "Ünvan",
    location: "Saxlama yeri",
    type: "Tip",
    unitCode: "Kod",
    unitName: "Ad",
    save: "Saxla",
  },
  RU: {
    currency: "Валюта",
    symbol: "Символ",
    language: "Язык",
    branch: "Точка",
    address: "Адрес",
    location: "Место хранения",
    type: "Тип",
    unitCode: "Код",
    unitName: "Название",
    save: "Сохранить",
  },
  EN: {
    currency: "Currency",
    symbol: "Symbol",
    language: "Language",
    branch: "Branch",
    address: "Address",
    location: "Storage location",
    type: "Type",
    unitCode: "Code",
    unitName: "Name",
    save: "Save",
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
  locations: { id: string; name: string; type: string }[];
  units: { id: string; code: string; name: string }[];
}) {
  const { lang } = useT();
  const copy = COPY[lang];
  const block = getBlock("sebeke");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight text-white">
        {block ? getBlockLabel(block, lang) : "sebeke"}
      </h1>

      <Card>
        <form action={saveTenantSettings} className="flex flex-col gap-3">
          <CardTitle className="text-[10px] uppercase tracking-widest text-muted">{copy.currency}</CardTitle>
          <Input name="currency" defaultValue={settings.currency ?? ""} placeholder={copy.currency} />
          <Input name="currency_symbol" defaultValue={settings.currencySymbol ?? ""} placeholder={copy.symbol} />
          <Input name="language" defaultValue={settings.language ?? ""} placeholder={copy.language} />
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
        <ul className="mt-3 flex flex-col gap-2 text-sm text-white">
          {locations.map((location) => (
            <li key={location.id}>
              {location.name} · {location.type}
            </li>
          ))}
        </ul>
        <form action={addStorageLocation} className="mt-4 flex flex-col gap-3">
          <Input name="name" placeholder={copy.location} required />
          <Input name="type" placeholder={copy.type} required />
          <select
            name="branch_id"
            className="w-full rounded-[12px] border border-line bg-bg px-3 py-2.5 text-sm text-white"
            defaultValue=""
          >
            <option value="">—</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
          <Button type="submit">{copy.save}</Button>
        </form>
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
