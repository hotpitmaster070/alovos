"use client";

import { ArrowLeft, LoaderCircle, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import { RECIPES_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { formatMoney, formatRate } from "@/lib/money";
import { deleteTechCardAction, saveTechCardAction } from "@/lib/recipes/actions";
import type { EditorMoney, EditorProduct, PriceLot, Recipe } from "@/lib/recipes/load";
import { foodCost, parseDecimal, TECH_CARD_MAX_INGREDIENTS, wastePercent, type TechCardErrorCode } from "@/lib/recipes/model";

type Row = { key: number; productId: string; brutto: string; netto: string; priceLotId: string };

const decimalText = (value: number | null) => (value === null ? "" : String(value));
const quantityText = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });
const percentText = (value: number | null) =>
  value === null ? "—" : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} %`;
const optionalNumber = (text: string): number | null => {
  const value = parseDecimal(text);
  return Number.isFinite(value) ? value : null;
};

export default function TechCardEditor({
  recipe,
  products,
  money,
  canDelete,
}: {
  recipe: Recipe | null;
  products: EditorProduct[];
  money: EditorMoney | null;
  canDelete: boolean;
}) {
  const { t } = useT();
  const copy = t.recipes.editor;
  const router = useRouter();
  const [name, setName] = useState(recipe?.name ?? "");
  const [category, setCategory] = useState(recipe?.category ?? "");
  const [salePrice, setSalePrice] = useState(decimalText(money?.salePrice ?? null));
  const [yieldQty, setYieldQty] = useState(decimalText(recipe?.yieldQty ?? null));
  const [yieldUnit, setYieldUnit] = useState(recipe?.yieldUnit ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    (recipe?.ingredients ?? []).map((item, index) => ({
      key: index,
      productId: item.productId,
      brutto: String(item.brutto),
      netto: String(item.netto),
      priceLotId: item.priceLotId ?? "",
    })),
  );
  const [nextKey, setNextKey] = useState(rows.length);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TechCardErrorCode | null>(null);
  const [toast, setToast] = useState<number | null>(null);

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const lotsByProduct = useMemo(() => {
    const map = new Map<string, PriceLot[]>();
    for (const lot of money?.lots ?? []) map.set(lot.productId, [...(map.get(lot.productId) ?? []), lot]);
    return map;
  }, [money]);

  const lines = rows.map((row) => {
    const brutto = parseDecimal(row.brutto);
    const netto = parseDecimal(row.netto);
    const waste = wastePercent(brutto, netto);
    const pinned = row.priceLotId ? lotsByProduct.get(row.productId)?.find((lot) => lot.id === row.priceLotId) : undefined;
    const unitCost = money ? (pinned?.unitCost ?? money.prices[row.productId]?.unitCost ?? null) : null;
    const lineCost = unitCost !== null && Number.isFinite(brutto) && brutto > 0 ? brutto * unitCost : null;
    return { row, brutto, netto, waste, unitCost, lineCost, nettoTooHigh: Number.isFinite(brutto) && netto > brutto };
  });
  const chosen = lines.filter((line) => line.row.productId);
  const priced = chosen.filter((line) => line.lineCost !== null);
  const totalCost = priced.length > 0 ? priced.reduce((sum, line) => sum + (line.lineCost ?? 0), 0) : null;
  const economics = foodCost(totalCost, optionalNumber(salePrice));
  const valid =
    name.trim() !== "" &&
    rows.every((row) => row.productId) &&
    lines.every((line) => line.waste !== null) &&
    rows.length <= TECH_CARD_MAX_INGREDIENTS;

  const updateRow = (key: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const addRow = () => {
    setRows((current) => [...current, { key: nextKey, productId: "", brutto: "", netto: "", priceLotId: "" }]);
    setNextKey((key) => key + 1);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    const result = await saveTechCardAction({
      id: recipe?.id ?? null,
      name,
      category,
      salePrice: money ? optionalNumber(salePrice) : null,
      yieldQty: optionalNumber(yieldQty),
      yieldUnit,
      ingredients: lines.map((line) => ({
        productId: line.row.productId,
        brutto: line.brutto,
        netto: line.netto,
        priceLotId: line.row.priceLotId || null,
      })),
    }).catch(() => ({ ok: false as const, error: "save_failed" as const }));
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setToast(Date.now());
    if (!recipe) router.replace(`${RECIPES_PATH}/${result.value}`);
    router.refresh();
  };

  const onDelete = async () => {
    if (!recipe || !window.confirm(copy.deleteConfirm)) return;
    setPending(true);
    const result = await deleteTechCardAction(recipe.id).catch(() => ({ ok: false as const, error: "save_failed" as const }));
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.replace(RECIPES_PATH);
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Link href={RECIPES_PATH} className="inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {copy.back}
      </Link>
      <h1 className="text-2xl font-semibold">{recipe ? recipe.name || "—" : copy.newTitle}</h1>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="text-white/60">{copy.name}</span>
            <Input value={name} maxLength={120} required disabled={pending} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="text-white/60">{copy.category}</span>
            <Input value={category} maxLength={60} disabled={pending} onChange={(event) => setCategory(event.target.value)} />
          </label>
          {money && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-white/60">{copy.salePrice}</span>
              <Input inputMode="decimal" value={salePrice} disabled={pending} onChange={(event) => setSalePrice(event.target.value)} />
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-white/60">{copy.yieldQty}</span>
            <Input inputMode="decimal" value={yieldQty} disabled={pending} onChange={(event) => setYieldQty(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-white/60">{copy.yieldUnit}</span>
            <Input value={yieldUnit} maxLength={10} disabled={pending} onChange={(event) => setYieldUnit(event.target.value)} />
          </label>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>{copy.ingredients}</CardTitle>
          <span className="text-xs text-white/45">{copy.perPortion}</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-white/45">
              <tr className="border-b border-line">
                <th className="py-2 pr-2 font-medium">{copy.product}</th>
                <th className="px-2 py-2 font-medium">{copy.brutto}</th>
                <th className="px-2 py-2 font-medium">{copy.netto}</th>
                <th className="px-2 py-2 text-right font-medium">{copy.waste}</th>
                {money && (
                  <>
                    <th className="px-2 py-2 font-medium">{copy.priceLot}</th>
                    <th className="px-2 py-2 text-right font-medium">{copy.lineCost}</th>
                  </>
                )}
                <th className="py-2 pl-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map(({ row, waste, unitCost, lineCost, nettoTooHigh }) => {
                const unit = productById.get(row.productId)?.unit ?? "";
                const lots = lotsByProduct.get(row.productId) ?? [];
                const latest = money?.prices[row.productId];
                return (
                  <tr key={row.key} className="border-b border-line/60 align-top last:border-0">
                    <td className="py-2 pr-2">
                      <Select
                        value={row.productId}
                        required
                        disabled={pending}
                        aria-label={copy.product}
                        onChange={(event) => updateRow(row.key, { productId: event.target.value, priceLotId: "" })}
                      >
                        <option value="" disabled>
                          {copy.pickProduct}
                        </option>
                        {products.map((product) => (
                          <option
                            key={product.id}
                            value={product.id}
                            disabled={product.id !== row.productId && rows.some((other) => other.productId === product.id)}
                          >
                            {product.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        inputMode="decimal"
                        value={row.brutto}
                        required
                        disabled={pending}
                        aria-label={copy.brutto}
                        className="w-24"
                        onChange={(event) => updateRow(row.key, { brutto: event.target.value })}
                      />
                      {unit && <span className="mt-1 block text-xs text-white/45">{unit}</span>}
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        inputMode="decimal"
                        value={row.netto}
                        required
                        disabled={pending}
                        aria-label={copy.netto}
                        aria-invalid={nettoTooHigh}
                        className="w-24"
                        onChange={(event) => updateRow(row.key, { netto: event.target.value })}
                      />
                      {nettoTooHigh && <span className="mt-1 block text-xs text-red-300">{copy.nettoAboveBrutto}</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{percentText(waste)}</td>
                    {money && (
                      <>
                        <td className="px-2 py-2">
                          <Select
                            value={row.priceLotId}
                            disabled={pending || !row.productId}
                            aria-label={copy.priceLot}
                            className="min-w-[160px]"
                            onChange={(event) => updateRow(row.key, { priceLotId: event.target.value })}
                          >
                            <option value="">
                              {latest ? `${copy.latestPrice}: ${formatRate(latest.unitCost, money.currency)}` : copy.latestPrice}
                            </option>
                            {lots.map((lot) => (
                              <option key={lot.id} value={lot.id}>
                                {`${lot.lotNumber} · ${formatRate(lot.unitCost, money.currency)}`}
                              </option>
                            ))}
                          </Select>
                          {row.productId && unitCost === null && <span className="mt-1 block text-xs text-amber-300">{copy.noPrice}</span>}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatMoney(lineCost, money.currency)}</td>
                      </>
                    )}
                    <td className="py-2 pl-2 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={pending}
                        aria-label={copy.remove}
                        onClick={() => setRows((current) => current.filter((other) => other.key !== row.key))}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p className="mt-2 text-sm text-white/55">{t.recipes.noIngredients}</p>}
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={pending || rows.length >= TECH_CARD_MAX_INGREDIENTS || rows.length >= products.length}
          onClick={addRow}
        >
          <Plus className="h-4 w-4" aria-hidden />
          {copy.addIngredient}
        </Button>
      </Card>

      {money && (
        <Card>
          <CardTitle>{copy.summary}</CardTitle>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-white/45">{copy.cost}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(totalCost, money.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-white/45">{copy.foodCost}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{percentText(economics.foodCostPercent)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-white/45">{copy.margin}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(economics.margin, money.currency)}</dd>
            </div>
          </dl>
          {chosen.length > priced.length && (
            <p className="mt-3 text-xs text-amber-300">{copy.missingPrices(chosen.length - priced.length, chosen.length)}</p>
          )}
          <p className="mt-2 text-xs text-white/45">{copy.costNote}</p>
          {priced.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/45">
              {priced.map(({ row, brutto, unitCost }) => {
                const product = productById.get(row.productId);
                const source = row.priceLotId ? "price_lot" : (money.prices[row.productId]?.priceSource ?? "product");
                return (
                  <li key={row.key}>
                    {product?.name}: {quantityText(brutto)} {product?.unit} × {formatRate(unitCost ?? 0, money.currency)} ({copy.sources[source]})
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {copy.errors[error]}
        </p>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        {recipe && canDelete ? (
          <Button variant="ghost" disabled={pending} onClick={() => void onDelete()}>
            <Trash2 className="h-4 w-4" aria-hidden />
            {copy.delete}
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={pending || !valid}>
          {pending && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
          {copy.save}
        </Button>
      </div>
      <Toast token={toast} text={copy.saved} />
    </form>
  );
}
