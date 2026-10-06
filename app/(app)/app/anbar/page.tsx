import AnbarView from "@/components/anbar/anbar-view";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listLocations, listProducts } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { parseFilters, type RawSearchParams } from "@/lib/anbar/validation";
import { ANBAR_APP_PATH } from "@/lib/auth-redirect";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function AnbarPage({ searchParams }: { searchParams: RawSearchParams }) {
  const filters = parseFilters(searchParams);
  const now = new Date();
  const resolved = await resolveScope();

  if (resolved.status === "unauthenticated") {
    return (
      <AnbarView products={[]} locations={[]} filters={filters} hasNext={false} nowIso={now.toISOString()} />
    );
  }

  const gated = redirectIfNoOrg(resolved, ANBAR_APP_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Organization lookup failed");
  }

  const { scope } = gated;
  const [locations, page] = await Promise.all([
    listLocations(scope),
    listProducts(scope, filters, now),
  ]);

  return (
    <AnbarView
      products={page.products}
      locations={locations}
      filters={filters}
      hasNext={page.hasNext}
      nowIso={now.toISOString()}
    />
  );
}
