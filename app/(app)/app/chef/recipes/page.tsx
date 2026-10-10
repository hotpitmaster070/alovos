import { RecipeListView } from "@/components/recipes/recipe-views";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { resolveScope } from "@/lib/anbar/scope";
import { CHEF_RECIPES_PATH } from "@/lib/auth-redirect";
import { listRecipes } from "@/lib/recipes/load";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function ChefRecipesPage() {
  const gated = redirectIfNoOrg(await resolveScope(), CHEF_RECIPES_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  return <RecipeListView recipes={await listRecipes(gated.scope)} />;
}
