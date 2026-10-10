import { notFound } from "next/navigation";
import { RecipeDetailView } from "@/components/recipes/recipe-views";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { CHEF_RECIPES_PATH } from "@/lib/auth-redirect";
import { getRecipe } from "@/lib/recipes/load";
import { isUuid } from "@/lib/recipes/sales";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function ChefRecipePage({ params }: { params: { id: string } }) {
  if (!isUuid(params.id)) notFound();
  const gated = redirectIfNoOrg(await resolveScope(), `${CHEF_RECIPES_PATH}/${params.id}`);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const [recipe, branches] = await Promise.all([getRecipe(gated.scope, params.id), listBranches(gated.scope)]);
  if (!recipe) notFound();
  return <RecipeDetailView recipe={recipe} branches={branches} />;
}
