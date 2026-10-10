"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isUnit } from "@/lib/anbar/types";
import { AUTO_ORDER_PATH, OWNER_LOSSES_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { callPurchasingApi } from "@/lib/purchasing/client";
import { formatQty } from "@/lib/purchasing/format";
import {
  AUTO_ORDER_NOTIFY,
  effectiveMin,
  isAutoOrderNotify,
  LOSS_ALERT_MAX,
  LOSS_ALERT_MIN,
  lossTone,
  type LimitChange,
  type SmartSettings,
  type SmartSettingsPatch,
  type StockLimitRow,
} from "@/lib/smart-settings/model";

type BranchOption = { id: string; name: string };
type Tab = "stock" | "losses" | "autoOrder";
type Notice = { kind: "ok" | "error"; text: string } | null;
/** Rows drawn at once; search narrows the rest. */
const SHOWN_ROWS = 300;

const TONE_CLASS = {
  ok: "border-emerald-400/50 text-emerald-200",
  watch: "border-amber-300/60 text-amber-200",
  over: "border-red-400/70 bg-red-500/15 text-red-200",
} as const;

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p role={notice.kind === "error" ? "alert" : "status"} className={notice.kind === "error" ? "text-sm text-red-300" : "text-sm text-emerald-300"}>
      {notice.text}
    </p>
  );
}

/** Saves a settings patch and hands back the stored values. */
function useSaveSettings(onSaved: (settings: SmartSettings) => void) {
  const { t } = useT();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const save = async (patch: SmartSettingsPatch) => {
    setPending(true);
    setNotice(null);
    const outcome = await callPurchasingApi("/api/settings", "PUT", patch);
    setPending(false);
    if (!outcome.ok) {
      setNotice({ kind: "error", text: t.purchasing.errors[outcome.error] });
      return;
    }
    const stored = (outcome.data as { settings?: SmartSettings } | null)?.settings;
    if (stored) onSaved(stored);
    setNotice({ kind: "ok", text: t.autoOrder.settings.saved });
  };
  return { pending, notice, save };
}

type Draft = { min_stock?: string; branch_min?: string };

const parseCell = (value: string): number | null | undefined => {
  if (value.trim() === "") return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

function StockTab({
  settings,
  onSettings,
  branches,
  initialBranchId,
  initialRows,
}: {
  settings: SmartSettings;
  onSettings: (settings: SmartSettings) => void;
  branches: BranchOption[];
  initialBranchId: string | null;
  initialRows: StockLimitRow[];
}) {
  const { t } = useT();
  const copy = t.autoOrder.settings;
  const [lowStock, setLowStock] = useState(String(settings.lowStockDefault));
  const defaults = useSaveSettings(onSettings);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [rows, setRows] = useState(initialRows);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [edits, setEdits] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const unit = (value: string) => (isUnit(value) ? t.anbar.units[value] : value);
  const tenantDefault = settings.lowStockDefault;

  const load = async (next: string | null) => {
    setLoading(true);
    setNotice(null);
    const response = await fetch(`/api/settings/limits${next ? `?branch_id=${encodeURIComponent(next)}` : ""}`).catch(() => null);
    const payload = (await response?.json().catch(() => null)) as { rows?: StockLimitRow[] } | null;
    setLoading(false);
    if (!response?.ok || !payload?.rows) {
      setNotice({ kind: "error", text: t.purchasing.errors.save_failed });
      return;
    }
    setRows(payload.rows);
    setEdits({});
  };

  const changes = useMemo(() => {
    const items: LimitChange[] = [];
    let invalid = false;
    for (const [productId, draft] of Object.entries(edits)) {
      const item: LimitChange = { product_id: productId };
      for (const key of ["min_stock", "branch_min"] as const) {
        if (draft[key] === undefined) continue;
        const value = parseCell(draft[key] ?? "");
        if (value === undefined) invalid = true;
        else item[key] = value;
      }
      if ("min_stock" in item || "branch_min" in item) items.push(item);
    }
    return { items, invalid };
  }, [edits]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle === "" ? rows : rows.filter((row) => `${row.name} ${row.category ?? ""}`.toLocaleLowerCase().includes(needle));
  }, [rows, query]);

  const edit = (productId: string, key: keyof Draft, value: string) => setEdits((current) => ({ ...current, [productId]: { ...current[productId], [key]: value } }));
  const cell = (row: StockLimitRow, key: keyof Draft, stored: number | null) => edits[row.productId]?.[key] ?? (stored === null ? "" : formatQty(stored));

  const saveAll = async () => {
    if (changes.items.length === 0) {
      setNotice({ kind: "ok", text: copy.stock.nothingChanged });
      return;
    }
    setSaving(true);
    setNotice(null);
    const outcome = await callPurchasingApi("/api/settings/limits", "PUT", { branch_id: branchId, items: changes.items });
    setSaving(false);
    if (!outcome.ok) {
      setNotice({ kind: "error", text: t.purchasing.errors[outcome.error] });
      return;
    }
    await load(branchId);
    setNotice({ kind: "ok", text: copy.stock.savedRows(changes.items.length) });
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void defaults.save({ low_stock_default: Number(lowStock) });
          }}
        >
          <div>
            <Label htmlFor="low-stock-default">{copy.stock.defaultLabel}</Label>
            <Input id="low-stock-default" type="number" min="0" step="1" inputMode="numeric" required value={lowStock} onChange={(event) => setLowStock(event.target.value)} className="w-32" />
          </div>
          <Button type="submit" disabled={defaults.pending}>
            {defaults.pending ? copy.saving : copy.save}
          </Button>
        </form>
        <p className="text-xs text-white/50">{copy.stock.defaultHint}</p>
        <NoticeLine notice={defaults.notice} />
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          {branches.length > 0 && (
            <div className="min-w-[200px]">
              <Label htmlFor="limits-branch">{copy.stock.branch}</Label>
              <Select
                id="limits-branch"
                value={branchId ?? ""}
                disabled={loading}
                onChange={(event) => {
                  const next = event.target.value || null;
                  setBranchId(next);
                  void load(next);
                }}
              >
                <option value="">{copy.stock.allBranches}</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="min-w-[220px] flex-1">
            <Label htmlFor="limits-search">{copy.stock.search}</Label>
            <Input id="limits-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <Button onClick={saveAll} disabled={saving || loading || changes.invalid}>
            {saving ? copy.saving : copy.stock.saveAll(changes.items.length)}
          </Button>
        </div>
        <p className="text-xs text-white/50">
          {copy.stock.legend} {branchId === null && copy.stock.branchHint}
        </p>
        <NoticeLine notice={notice} />
        {rows.length === 0 ? (
          <p className="text-sm text-white/60">{copy.stock.empty}</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-white/60">{copy.stock.noMatch}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.stock.product}</TableHead>
                <TableHead>{copy.stock.left}</TableHead>
                {branchId && <TableHead>{copy.stock.branchMin}</TableHead>}
                <TableHead>{copy.stock.productMin}</TableHead>
                <TableHead>{copy.stock.effective}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.slice(0, SHOWN_ROWS).map((row) => {
                const productMin = parseCell(cell(row, "min_stock", row.productMin));
                const branchMin = branchId ? parseCell(cell(row, "branch_min", row.branchMin)) : null;
                const live =
                  productMin === undefined || branchMin === undefined ? null : effectiveMin(branchMin, productMin, tenantDefault);
                const productFallback = tenantDefault > 0 ? formatQty(tenantDefault) : copy.stock.sources.off;
                return (
                  <TableRow key={row.productId}>
                    <TableCell className="text-white">
                      {row.name}
                      {row.category && <span className="ml-2 text-xs text-white/40">{row.category}</span>}
                    </TableCell>
                    <TableCell className={live && live.min > 0 && row.quantity < live.min ? "text-red-300" : "text-white/70"}>
                      {formatQty(row.quantity)} {unit(row.unit)}
                    </TableCell>
                    {branchId && (
                      <TableCell>
                        <Input
                          aria-label={`${copy.stock.branchMin}: ${row.name}`}
                          inputMode="decimal"
                          className="w-28"
                          placeholder={copy.stock.inherit(productMin != null ? formatQty(productMin) : productFallback)}
                          value={cell(row, "branch_min", row.branchMin)}
                          onChange={(event) => edit(row.productId, "branch_min", event.target.value)}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <Input
                        aria-label={`${copy.stock.productMin}: ${row.name}`}
                        inputMode="decimal"
                        className="w-28"
                        placeholder={copy.stock.inherit(productFallback)}
                        value={cell(row, "min_stock", row.productMin)}
                        onChange={(event) => edit(row.productId, "min_stock", event.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      {live === null ? (
                        <span className="text-sm text-red-300">{t.purchasing.errors.invalid_input}</span>
                      ) : (
                        <span className="flex items-center gap-2 text-sm text-white">
                          {live.min > 0 ? `${formatQty(live.min)} ${unit(row.unit)}` : "—"}
                          <Badge className={live.source === "off" ? "border-white/20 text-white/50" : "border-beige/50 text-beige"}>
                            {copy.stock.sources[live.source]}
                          </Badge>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {visible.length > SHOWN_ROWS && <p className="text-xs text-white/50">{t.owner.dashboard.shownLimit(SHOWN_ROWS)}</p>}
      </Card>
    </div>
  );
}

function LossesTab({ settings, onSettings }: { settings: SmartSettings; onSettings: (settings: SmartSettings) => void }) {
  const { t } = useT();
  const copy = t.autoOrder.settings.losses;
  const [enabled, setEnabled] = useState(settings.lossAlertEnabled);
  const [limit, setLimit] = useState(Math.min(LOSS_ALERT_MAX, Math.max(LOSS_ALERT_MIN, settings.lossAlertPercent)));
  const { pending, notice, save } = useSaveSettings(onSettings);
  const samples = Array.from(new Set([Math.max(1, Math.round(limit / 3)), limit, limit + 5]));

  return (
    <Card className="flex flex-col gap-4">
      <label className="flex items-start gap-3">
        <Checkbox checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="mt-0.5" />
        <span>
          <span className="block text-sm font-medium text-white">{copy.enabled}</span>
          <span className="block text-xs text-white/50">{copy.enabledHint}</span>
        </span>
      </label>
      <div>
        <Label htmlFor="loss-limit">
          {copy.limit}: <span className="font-mono text-white">{limit}%</span>
        </Label>
        <input
          id="loss-limit"
          type="range"
          min={LOSS_ALERT_MIN}
          max={LOSS_ALERT_MAX}
          step={1}
          value={limit}
          disabled={!enabled}
          onChange={(event) => setLimit(Number(event.target.value))}
          className="w-full max-w-md accent-beige"
        />
        <p className="text-xs text-white/50">{copy.limitHint(String(limit))}</p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm text-white/70">{copy.preview}</span>
        <div className="flex flex-wrap gap-2">
          {samples.map((percent) => {
            const tone = lossTone(percent, limit, enabled);
            return (
              <Badge key={percent} className={TONE_CLASS[tone]}>
                {copy.sample(percent)} · {copy.tones[tone]}
              </Badge>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => void save({ loss_alert_enabled: enabled, loss_alert_percent: limit })}>
          {pending ? t.autoOrder.settings.saving : t.autoOrder.settings.save}
        </Button>
        <Link href={OWNER_LOSSES_PATH} className={buttonVariants("outline", "default")}>
          {copy.open}
        </Link>
      </div>
      <NoticeLine notice={notice} />
    </Card>
  );
}

function AutoOrderTab({ settings, onSettings }: { settings: SmartSettings; onSettings: (settings: SmartSettings) => void }) {
  const { t } = useT();
  const copy = t.autoOrder.settings.autoOrder;
  const [enabled, setEnabled] = useState(settings.autoOrderEnabled);
  const [time, setTime] = useState(settings.autoOrderTime);
  const [notify, setNotify] = useState(settings.autoOrderNotify);
  const { pending, notice, save } = useSaveSettings(onSettings);

  return (
    <Card className="flex flex-col gap-4">
      <label className="flex items-start gap-3">
        <Checkbox checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="mt-0.5" />
        <span>
          <span className="block text-sm font-medium text-white">{copy.enabled}</span>
          <span className="block text-xs text-white/50">{copy.enabledHint}</span>
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="auto-order-time">{copy.time}</Label>
          <Input id="auto-order-time" type="time" required value={time} disabled={!enabled} onChange={(event) => setTime(event.target.value)} className="w-36" />
          <p className="mt-1 text-xs text-white/50">{copy.timeHint(settings.timezone)}</p>
        </div>
        <div>
          <Label htmlFor="auto-order-notify">{copy.notify}</Label>
          <Select
            id="auto-order-notify"
            value={notify}
            disabled={!enabled}
            onChange={(event) => isAutoOrderNotify(event.target.value) && setNotify(event.target.value)}
          >
            {AUTO_ORDER_NOTIFY.map((channel) => (
              <option key={channel} value={channel}>
                {copy.channels[channel]}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-white/50">{copy.channelHint}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => void save({ auto_order_enabled: enabled, auto_order_time: time, auto_order_notify: notify })}>
          {pending ? t.autoOrder.settings.saving : t.autoOrder.settings.save}
        </Button>
        <Link href={AUTO_ORDER_PATH} className={buttonVariants("outline", "default")}>
          {copy.open}
        </Link>
      </div>
      <NoticeLine notice={notice} />
    </Card>
  );
}

/** Owner settings in three tabs; each save goes straight to /api/settings without a page reload. */
export default function SmartSettingsView({
  owner,
  settings: initial,
  branches,
  branchId,
  rows,
}: {
  owner: boolean;
  settings: SmartSettings | null;
  branches: BranchOption[];
  branchId: string | null;
  rows: StockLimitRow[];
}) {
  const { t } = useT();
  const copy = t.autoOrder.settings;
  const [tab, setTab] = useState<Tab>("stock");
  const [settings, setSettings] = useState(initial);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
        <p className="mt-1 text-sm text-white/60">{copy.subtitle}</p>
      </div>
      {!owner ? (
        <p className="text-sm text-white/60">{copy.ownerOnly}</p>
      ) : !settings ? (
        <p role="alert" className="text-sm text-amber-200">
          {copy.notReady}
        </p>
      ) : (
        <>
          <div role="tablist" aria-label={copy.title} className="flex flex-wrap gap-2">
            {(["stock", "losses", "autoOrder"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={buttonVariants(tab === key ? "default" : "outline", "sm")}
              >
                {copy.tabs[key]}
              </button>
            ))}
          </div>
          <div role="tabpanel">
            {tab === "stock" && <StockTab settings={settings} onSettings={setSettings} branches={branches} initialBranchId={branchId} initialRows={rows} />}
            {tab === "losses" && <LossesTab settings={settings} onSettings={setSettings} />}
            {tab === "autoOrder" && <AutoOrderTab settings={settings} onSettings={setSettings} />}
          </div>
        </>
      )}
    </div>
  );
}
