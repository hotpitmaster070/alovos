"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createStorageLocationsAction, setStorageLocationActiveAction } from "@/lib/anbar/actions";
import { STORAGE_NAME_MAX_LENGTH } from "@/lib/anbar/constants";
import type { AnbarErrorCode } from "@/lib/anbar/errors";
import type { StorageOverview } from "@/lib/anbar/repository";
import { formatNumberRanges, nextStorageNumber, usedStorageNumbers } from "@/lib/anbar/storage-numbers";
import { STORAGE_TYPES, isStorageType, storageLocationCode, type Branch, type StorageType } from "@/lib/anbar/types";
import { STORAGE_BULK_MAX } from "@/lib/anbar/validation";
import { ANBAR_APP_PATH, ANBAR_STORAGE_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { formatMoney, type CurrencyInfo } from "@/lib/money";
import type { StockValueByType } from "@/lib/purchasing/model";
import { Card } from "@/components/ui/card";
import { StorageCard, StorageGrid } from "./storage-card";
import StorageIcon from "./storage-icon";

type Message = { kind: "notice"; text: string } | { kind: "error"; error: AnbarErrorCode };

/** New places of one type: shows the next fixed number, the default name and the resulting code. */
function AddLocationsForm({
  branch,
  locations,
  onCreated,
}: {
  branch: Branch;
  locations: StorageOverview[];
  onCreated: (count: number) => void;
}) {
  const { t } = useT();
  const copy = t.anbar.saxlama;
  const storage = t.anbar.storage;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<AnbarErrorCode | null>(null);
  const [type, setType] = useState<StorageType>("soyuducu");
  const [count, setCount] = useState(1);
  /** null while the name follows the type and number. */
  const [name, setName] = useState<string | null>(null);

  const used = usedStorageNumbers(locations, branch.id, type);
  const next = nextStorageNumber(used);
  const last = next + count - 1;
  const autoName = `${storage.types[type]} #${next}`;
  const numbers = count > 1 ? `#${next}–${last}` : `#${next}`;
  const code =
    count > 1
      ? `${storageLocationCode(type, next)} … ${storageLocationCode(type, last)}`
      : storageLocationCode(type, next);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const data = new FormData();
    data.set("type", type);
    data.set("branchId", branch.id);
    data.set("count", String(count));
    // An untouched name is built by the database from the number it actually assigns.
    const custom = name?.replace(/\s+/g, " ").trim() ?? "";
    if (count === 1 && custom !== "" && custom !== autoName) data.set("name", custom);
    else data.set("name_prefix", storage.types[type]);
    setError(null);
    startTransition(async () => {
      const created = await createStorageLocationsAction(data);
      if (created.ok) onCreated(created.locations.length);
      else setError(created.error);
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="storage-add-type">{storage.type}</Label>
        <Select
          id="storage-add-type"
          value={type}
          onChange={(event) => {
            if (isStorageType(event.target.value)) setType(event.target.value);
          }}
        >
          {STORAGE_TYPES.map((item) => (
            <option key={item} value={item}>
              {storage.types[item]}
            </option>
          ))}
        </Select>
        <p className="mt-1.5 text-xs text-white/60">{copy.nextNumber(numbers, used.length > 0 ? formatNumberRanges(used) : null)}</p>
      </div>
      <div>
        <Label htmlFor="storage-add-count">{copy.count}</Label>
        <Input
          id="storage-add-count"
          type="number"
          min={1}
          max={STORAGE_BULK_MAX}
          step={1}
          value={count}
          onChange={(event) => {
            const value = Number(event.target.value);
            setCount(Number.isInteger(value) ? Math.min(Math.max(value, 1), STORAGE_BULK_MAX) : 1);
          }}
        />
      </div>
      {count === 1 && (
        <div>
          <Label htmlFor="storage-add-name">{storage.name}</Label>
          <Input
            id="storage-add-name"
            value={name ?? autoName}
            maxLength={STORAGE_NAME_MAX_LENGTH}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      )}
      <p className="text-sm text-white/70">
        {copy.code}: <span className="font-mono text-white">{code}</span>
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {t.anbar.errors[error]}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t.anbar.working : storage.submit}
      </Button>
    </form>
  );
}

export default function StorageManager({
  branches,
  branch,
  locations,
  value,
  currency,
}: {
  branches: Branch[];
  branch: Branch | null;
  /** The branch's places, inactive included, in display order. */
  locations: StorageOverview[];
  /** Live stock value per storage type; null when the member may not see costs. */
  value: StockValueByType[] | null;
  currency: CurrencyInfo;
}) {
  const { t } = useT();
  const copy = t.anbar.saxlama;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const toggle = (location: StorageOverview) => {
    setMessage(null);
    startTransition(async () => {
      const result = await setStorageLocationActiveAction(location.id, !location.active);
      if (result.ok) router.refresh();
      else setMessage({ kind: "error", error: result.error });
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
        <Link href={ANBAR_APP_PATH} className={buttonVariants("outline", "sm")}>
          {t.anbar.title}
        </Link>
      </div>

      {value && (
        <Card className="flex flex-col gap-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-widest text-white/50">
              {t.purchasing.value.title} · <span className="text-emerald-300">{t.purchasing.value.live}</span>
            </p>
            <p className="mt-1 font-serif text-3xl font-bold text-white">
              {formatMoney(value.reduce((sum, part) => sum + part.value, 0), currency)}
            </p>
            <p className="mt-1 text-xs text-white/50">{t.purchasing.value.byType}</p>
          </div>
          {value.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {value.map((part) => (
                <li key={part.type} className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs text-white/80">
                  {isStorageType(part.type) && <StorageIcon type={part.type} className="h-4 w-4 text-beige" />}
                  {isStorageType(part.type) ? t.anbar.storage.types[part.type] : part.type}: {formatMoney(part.value, currency)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {branches.length > 1 && (
          <div className="min-w-[200px] flex-1">
            <Label htmlFor="storage-branch">{copy.branch}</Label>
            <Select
              id="storage-branch"
              value={branch?.id ?? ""}
              onChange={(event) => router.push(`${ANBAR_STORAGE_PATH}?branch=${encodeURIComponent(event.target.value)}`)}
            >
              {branches.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        {branch && (
          <Button type="button" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {copy.add}
          </Button>
        )}
      </div>

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-red-400" : "text-sm text-emerald-400"}>
          {message.kind === "error" ? t.anbar.errors[message.error] : message.text}
        </p>
      )}

      {locations.length === 0 ? (
        <p className="text-sm text-white/60">{copy.empty}</p>
      ) : (
        <StorageGrid
          locations={locations}
          renderCard={(location) => (
            <StorageCard
              key={location.id}
              location={location}
              branchName={branches.find((item) => item.id === location.branchId)?.name ?? null}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                disabled={pending || (location.active && location.openCount !== null)}
                onClick={() => toggle(location)}
              >
                {location.active ? copy.deactivate : copy.activate}
              </Button>
            </StorageCard>
          )}
        />
      )}

      {branch && (
        <Dialog open={adding} onOpenChange={setAdding} title={copy.add} closeLabel={t.anbar.kitchen.cancel}>
          <AddLocationsForm
            branch={branch}
            locations={locations}
            onCreated={(count) => {
              setAdding(false);
              setMessage({ kind: "notice", text: copy.created(count) });
              router.refresh();
            }}
          />
        </Dialog>
      )}
    </div>
  );
}
