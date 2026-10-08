import MovementsTable from "@/components/anbar/movements-table";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listStockMovements } from "@/lib/anbar/kitchen";
import { resolveScope } from "@/lib/anbar/scope";
import { parseMovementDate, parseMovementType } from "@/lib/anbar/stock-view";
import { ANBAR_MOVEMENTS_PATH } from "@/lib/auth-redirect";
import { PAGE_SIZE, parsePage } from "@/lib/pagination";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { getSettings } from "@/lib/tenant-settings/getSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function MovementsPage({ searchParams }: { searchParams: RawSearchParams }) {
  const date = parseMovementDate(searchParams.date);
  const type = parseMovementType(searchParams.type);
  const page = parsePage(searchParams.page);
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, ANBAR_MOVEMENTS_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }

  const settings = await getSettings(gated.scope);
  const movements = await listStockMovements(gated.scope, { date, type }, settings, page);
  return (
    <MovementsTable
      rows={movements.rows}
      total={movements.total}
      page={page}
      pageSize={PAGE_SIZE}
      date={date}
      type={type}
    />
  );
}
