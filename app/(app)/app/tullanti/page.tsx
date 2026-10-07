import WasteBoard from "@/components/wastage/waste-board";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches, listKitchenBoard } from "@/lib/anbar/kitchen";
import { resolveScope } from "@/lib/anbar/scope";
import { buildStockLines, parseLocationFilter } from "@/lib/anbar/stock-view";
import { readSettings } from "@/lib/money";
import { listWasteCards } from "@/lib/wastage/load";
import type { RawSearchParams } from "@/lib/anbar/validation";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

const PATH = "/app/tullanti";

export default async function TullantiPage({ searchParams }: { searchParams: RawSearchParams }) {
  const locationId = parseLocationFilter(searchParams.location);
  const branchId = parseLocationFilter(searchParams.branch);
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, PATH);
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
  const cards = await listWasteCards(gated.scope, { branchId, locationId }, board.balances);
  const settings = readSettings(settingsRow.data);

  return (
    <WasteBoard
      lines={lines}
      locations={board.locations}
      branches={branches}
      locationId={locationId}
      branchId={branchId}
      cards={cards}
      symbol={settings.currencySymbol}
    />
  );
}
