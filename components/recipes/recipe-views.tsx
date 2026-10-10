"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import CookBatch from "@/components/recipes/cook-batch";
import { Card, CardTitle } from "@/components/ui/card";
import type { Branch } from "@/lib/anbar/types";
import { CHEF_RECIPES_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import type { Recipe, RecipeSummary } from "@/lib/recipes/load";

const quantityText = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });

export function RecipeListView({ recipes }: { recipes: RecipeSummary[] }) {
  const { t } = useT();
  const copy = t.recipes;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{copy.title}</h1>
        <p className="mt-1 text-sm text-white/55">{copy.subtitle}</p>
      </div>
      {recipes.length === 0 ? (
        <Card>
          <p className="text-sm text-white/55">{copy.empty}</p>
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {recipes.map((recipe) => (
            <Link key={recipe.id} href={`${CHEF_RECIPES_PATH}/${recipe.id}`}>
              <Card className="transition hover:border-white/30">
                <span className="font-medium">{recipe.name || "—"}</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function RecipeDetailView({ recipe, branches }: { recipe: Recipe; branches: Branch[] }) {
  const { t } = useT();
  const copy = t.recipes;
  return (
    <div className="flex flex-col gap-4">
      <Link href={CHEF_RECIPES_PATH} className="inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {copy.back}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">{recipe.name || "—"}</h1>
        <div className="flex flex-col items-end gap-1">
          <CookBatch recipeId={recipe.id} ingredients={recipe.ingredients} branches={branches} />
        </div>
      </div>
      <Card>
        <CardTitle>{copy.ingredients}</CardTitle>
        {recipe.ingredients.length === 0 ? (
          <p className="mt-2 text-sm text-white/55">{copy.noIngredients}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-white/45">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-medium">{copy.table.product}</th>
                  <th className="px-3 py-2 text-right font-medium">{copy.table.net}</th>
                  <th className="py-2 pl-3 text-right font-medium">{copy.table.waste}</th>
                </tr>
              </thead>
              <tbody>
                {recipe.ingredients.map((item) => (
                  <tr key={item.productId} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-3">{item.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {quantityText(item.netto)} {item.unit}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums">{quantityText(item.wastePercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
