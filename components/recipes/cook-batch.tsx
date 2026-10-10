"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import type { Branch } from "@/lib/anbar/types";
import { useT } from "@/lib/i18n/useT";
import type { RecipeIngredient } from "@/lib/recipes/load";
import { grossPerPortion, parseSaleResponse, SALE_MAX_PORTIONS, type SaleErrorCode } from "@/lib/recipes/sales";

const quantityText = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });

/** "Deduct cooking batch": portions and branch, a preview of the write-off, then the sales route. */
export default function CookBatch({
  recipeId,
  ingredients,
  branches,
}: {
  recipeId: string;
  ingredients: RecipeIngredient[];
  branches: Branch[];
}) {
  const { t } = useT();
  const copy = t.recipes;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [portions, setPortions] = useState("1");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SaleErrorCode | null>(null);
  const [toast, setToast] = useState<{ token: number; text: string } | null>(null);

  const count = Number(portions);
  const validCount = Number.isInteger(count) && count >= 1 && count <= SALE_MAX_PORTIONS;
  const names = new Map(ingredients.map((item) => [item.productId, item]));

  const submit = async () => {
    if (!validCount || !branchId) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/pos/v1/sales", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branch_id: branchId, items: [{ recipe_id: recipeId, quantity: count }] }),
      });
      const result = parseSaleResponse(await response.json().catch(() => null));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const warnings = result.warnings.map((warning) => {
        const item = names.get(warning.product_id);
        return copy.insufficient_stock_warning(
          item?.name ?? "—",
          `${quantityText(warning.meta.shortage)} ${item?.unit ?? ""}`.trim(),
        );
      });
      setToast({ token: Date.now(), text: [copy.deduct_success, ...warnings].join(" · ") });
      setOpen(false);
      router.refresh();
    } catch {
      setError("save_failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button type="button" disabled={ingredients.length === 0 || branches.length === 0} onClick={() => setOpen(true)}>
        {copy.cooking_batch}
      </Button>
      {branches.length === 0 && <p className="text-xs text-white/50">{copy.noBranches}</p>}
      <Dialog open={open} onOpenChange={setOpen} title={copy.cooking_batch} closeLabel={copy.close} className="max-w-2xl">
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-white/60">{copy.portions}</span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={SALE_MAX_PORTIONS}
                step={1}
                value={portions}
                disabled={pending}
                onChange={(event) => setPortions(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-white/60">{copy.branch}</span>
              <Select value={branchId} disabled={pending} onChange={(event) => setBranchId(event.target.value)}>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">{copy.deduct_preview}</h3>
            <div className="overflow-x-auto rounded-[12px] border border-line">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-white/45">
                  <tr className="border-b border-line">
                    <th className="px-3 py-2 font-medium">{copy.table.product}</th>
                    <th className="px-3 py-2 text-right font-medium">{copy.table.net}</th>
                    <th className="px-3 py-2 text-right font-medium">{copy.table.waste}</th>
                    <th className="px-3 py-2 text-right font-medium">{copy.table.gross}</th>
                  </tr>
                </thead>
                <tbody>
                  {ingredients.map((item) => (
                    <tr key={item.productId} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-2">{item.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {quantityText(item.netto)} {item.unit}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{quantityText(item.wastePercent)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {validCount ? `${quantityText(grossPerPortion(item) * count)} ${item.unit}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-300">
              {copy.errors[error]}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
              {copy.cancel}
            </Button>
            <Button type="button" disabled={pending || !validCount || !branchId} onClick={() => void submit()}>
              {pending && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
              {copy.confirm}
            </Button>
          </div>
        </div>
      </Dialog>
      <Toast token={toast?.token ?? null} text={toast?.text ?? ""} />
    </>
  );
}
