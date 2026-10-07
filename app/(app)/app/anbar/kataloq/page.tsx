import CatalogView from "@/components/anbar/catalog-view";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches, listCatalog } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { parseLocationFilter } from "@/lib/anbar/stock-view";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { ANBAR_CATALOG_PATH } from "@/lib/auth-redirect";
import { readSettings } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function CatalogPage({ searchParams }: { searchParams: RawSearchParams }) {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, ANBAR_CATALOG_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }

  const branches = await listBranches(gated.scope);
  const requested = parseLocationFilter(searchParams.branch);
  const branchId = branches.some((branch) => branch.id === requested) ? requested : null;

  const [lines, settingsRow] = await Promise.all([
    listCatalog(gated.scope, branchId),
    gated.scope.client
      .from("tenants")
      .select("currency_symbol:settings->>currency_symbol")
      .eq("id", gated.scope.tenantId)
      .maybeSingle(),
  ]);
  if (settingsRow.error) throw settingsRow.error;

  return (
    <CatalogView
      lines={lines}
      branches={branches}
      branchId={branchId}
      currencySymbol={readSettings(settingsRow.data).currencySymbol}
    />
  );
}
