import CatalogView from "@/components/anbar/catalog-view";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listCatalog } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { ANBAR_CATALOG_PATH } from "@/lib/auth-redirect";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function CatalogPage() {
  const resolved = await resolveScope();
  if (resolved.status === "unauthenticated") return <CatalogView items={[]} />;

  const gated = redirectIfNoOrg(resolved, ANBAR_CATALOG_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Organization lookup failed");
  }

  const items = await listCatalog(gated.scope);
  return <CatalogView items={items} />;
}
