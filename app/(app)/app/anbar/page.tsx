import { redirect } from "next/navigation";
import AnbarView from "@/components/anbar/anbar-view";
import { listLocations, listProducts } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { parseFilters, type RawSearchParams } from "@/lib/anbar/validation";
import { safeNextPath } from "@/lib/auth-redirect";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

const ANBAR_PATH = "/app/anbar";

export default async function AnbarPage({ searchParams }: { searchParams: RawSearchParams }) {
  const filters = parseFilters(searchParams);

  const resolved = await resolveScope();
  if (resolved.status === "unauthenticated") {
    redirect(`/login?next=${encodeURIComponent(safeNextPath(ANBAR_PATH))}`);
  }
  if (resolved.status === "error") {
    throw new Error("Could not resolve the organization");
  }

  const { scope } = resolved;
  const now = new Date();
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
