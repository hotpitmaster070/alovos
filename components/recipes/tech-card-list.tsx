"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RECIPES_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { formatMoney, type CurrencyInfo } from "@/lib/money";
import type { RecipeSummary, TechCardEconomics } from "@/lib/recipes/load";

const percentText = (value: number | null) =>
  value === null ? "—" : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} %`;

/** Recipe cards; owners and chefs also see cost, sale price, food cost and margin (economics null for cooks). */
export default function TechCardList({
  recipes,
  economics,
  currency,
}: {
  recipes: RecipeSummary[];
  economics: Record<string, TechCardEconomics> | null;
  currency: CurrencyInfo;
}) {
  const { t } = useT();
  const copy = t.recipes.editor;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{copy.listTitle}</h1>
          <p className="mt-1 text-sm text-white/55">{copy.listSubtitle}</p>
        </div>
        <Link href={`${RECIPES_PATH}/new`} className={buttonVariants()}>
          <Plus className="h-4 w-4" aria-hidden />
          {copy.newCard}
        </Link>
      </div>

      {recipes.length === 0 ? (
        <Card>
          <p className="text-sm text-white/55">{t.recipes.empty}</p>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-white/45">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 font-medium">{copy.columns.name}</th>
                  <th className="px-3 py-2 font-medium">{copy.columns.category}</th>
                  {economics && (
                    <>
                      <th className="px-3 py-2 text-right font-medium">{copy.columns.cost}</th>
                      <th className="px-3 py-2 text-right font-medium">{copy.columns.salePrice}</th>
                      <th className="px-3 py-2 text-right font-medium">{copy.columns.foodCost}</th>
                      <th className="px-3 py-2 text-right font-medium">{copy.columns.margin}</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {recipes.map((recipe) => {
                  const item = economics?.[recipe.id];
                  const missing = item ? item.ingredientCount - item.pricedCount : 0;
                  return (
                    <tr key={recipe.id} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-2">
                        <Link href={`${RECIPES_PATH}/${recipe.id}`} className="font-medium hover:text-beige">
                          {recipe.name || "—"}
                        </Link>
                        {item && missing > 0 && (
                          <p className="mt-0.5 text-xs text-amber-300">{copy.missingPrices(missing, item.ingredientCount)}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-white/70">{recipe.category ?? "—"}</td>
                      {economics && (
                        <>
                          <td className="px-3 py-2 text-right tabular-nums">{formatMoney(item?.cost, currency)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatMoney(item?.salePrice, currency)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{percentText(item?.foodCostPercent ?? null)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatMoney(item?.margin, currency)}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
