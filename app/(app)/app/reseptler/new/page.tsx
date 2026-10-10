import TechCardEditor from "@/components/recipes/tech-card-editor";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { resolveScope } from "@/lib/anbar/scope";
import { RECIPES_PATH } from "@/lib/auth-redirect";
import { memberRole } from "@/lib/count/load";
import { loadEditorData } from "@/lib/recipes/editor-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function NewRecipePage() {
  const gated = redirectIfNoOrg(await resolveScope(), `${RECIPES_PATH}/new`);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const role = await memberRole(gated.scope);
  const { products, money } = await loadEditorData(gated.scope, role, null);
  return <TechCardEditor recipe={null} products={products} money={money} canDelete={false} />;
}
