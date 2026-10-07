import MovementsTable from "@/components/anbar/movements-table";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listStockMovements } from "@/lib/anbar/kitchen";
import { resolveScope } from "@/lib/anbar/scope";
import { parseMovementDate, parseMovementType } from "@/lib/anbar/stock-view";
import { ANBAR_MOVEMENTS_PATH } from "@/lib/auth-redirect";
import type { RawSearchParams } from "@/lib/anbar/validation";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function MovementsPage({ searchParams }: { searchParams: RawSearchParams }) {
  const date = parseMovementDate(searchParams.date);
  const type = parseMovementType(searchParams.type);
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, ANBAR_MOVEMENTS_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }

  const rows = await listStockMovements(gated.scope, { date, type });
  return <MovementsTable rows={rows} date={date} type={type} />;
}
