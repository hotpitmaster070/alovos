import StockBoard from "@/components/anbar/stock-board";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches, listKitchenBoard } from "@/lib/anbar/kitchen";
import { resolveScope } from "@/lib/anbar/scope";
import { buildStockLines, parseLocationFilter, stockValue } from "@/lib/anbar/stock-view";
import { ANBAR_APP_PATH } from "@/lib/auth-redirect";
import { formatMoney, readSettings } from "@/lib/money";
import type { RawSearchParams } from "@/lib/anbar/validation";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function AnbarPage({ searchParams }: { searchParams: RawSearchParams }) {
  const locationId = parseLocationFilter(searchParams.location);
  const branchId = parseLocationFilter(searchParams.branch);
  const notice = Array.isArray(searchParams.notice) ? searchParams.notice[0] : searchParams.notice;
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, ANBAR_APP_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }

  const [board, branches, settingsRow] = await Promise.all([
    listKitchenBoard(gated.scope),
    listBranches(gated.scope),
    gated.scope.client
      .from("tenants")
      .select("currency_symbol:settings->>currency_symbol")
      .eq("id", gated.scope.tenantId)
      .maybeSingle(),
  ]);
  if (settingsRow.error) throw settingsRow.error;

  const lines = buildStockLines(board.products, board.locations, board.balances, locationId, branchId);
  const settings = readSettings(settingsRow.data);

  return (
    <StockBoard
      lines={lines}
      locations={board.locations}
      branches={branches}
      locationId={locationId}
      branchId={branchId}
      money={formatMoney(stockValue(lines), settings.currencySymbol)}
      updated={notice === "1"}
    />
  );
}
