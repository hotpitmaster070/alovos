import TechCardList from "@/components/recipes/tech-card-list";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { resolveScope } from "@/lib/anbar/scope";
import { RECIPES_PATH } from "@/lib/auth-redirect";
import { memberRole } from "@/lib/count/load";
import { canSeeCosts } from "@/lib/labels/final";
import { currencyOf } from "@/lib/money";
import { listRecipeEconomics, listRecipes } from "@/lib/recipes/load";
import { getSettings } from "@/lib/tenant-settings/getSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function RecipesPage() {
  const gated = redirectIfNoOrg(await resolveScope(), RECIPES_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const [recipes, role, settings] = await Promise.all([listRecipes(gated.scope), memberRole(gated.scope), getSettings(gated.scope)]);
  const economics = canSeeCosts(role) ? Object.fromEntries(await listRecipeEconomics(gated.scope)) : null;
  return <TechCardList recipes={recipes} economics={economics} currency={currencyOf(settings)} />;
}
