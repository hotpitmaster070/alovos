import CountForm from "@/components/anbar/count-form";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { resolveScope } from "@/lib/anbar/scope";

export const dynamic = "force-dynamic";

export default async function CountPage() {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, "/app/anbar/sayim");
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const client = gated.scope.client;
  const tenantId = gated.scope.tenantId;
  const [products, locations] = await Promise.all([
    client.from("products").select("id, name").eq("tenant_id", tenantId).eq("organization_id", tenantId).order("name").limit(200),
    client.from("storage_locations").select("id, name").eq("tenant_id", tenantId).order("name").limit(200),
  ]);
  if (products.error) throw products.error;
  if (locations.error) throw locations.error;

  return (
    <CountForm
      products={(products.data ?? []) as { id: string; name: string }[]}
      locations={(locations.data ?? []) as { id: string; name: string }[]}
    />
  );
}
