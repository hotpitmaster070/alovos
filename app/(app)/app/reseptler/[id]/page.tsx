import { notFound } from "next/navigation";
import TechCardEditor from "@/components/recipes/tech-card-editor";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { resolveScope } from "@/lib/anbar/scope";
import { RECIPES_PATH } from "@/lib/auth-redirect";
import { memberRole } from "@/lib/count/load";
import { canSeeCosts } from "@/lib/labels/final";
import { loadEditorData } from "@/lib/recipes/editor-data";
import { getRecipe } from "@/lib/recipes/load";
import { isUuid } from "@/lib/recipes/model";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function RecipeEditorPage({ params }: { params: { id: string } }) {
  if (!isUuid(params.id)) notFound();
  const gated = redirectIfNoOrg(await resolveScope(), `${RECIPES_PATH}/${params.id}`);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const [recipe, role] = await Promise.all([getRecipe(gated.scope, params.id), memberRole(gated.scope)]);
  if (!recipe) notFound();
  const { products, money } = await loadEditorData(gated.scope, role, recipe.id);
  return <TechCardEditor key={recipe.id} recipe={recipe} products={products} money={money} canDelete={canSeeCosts(role)} />;
}
