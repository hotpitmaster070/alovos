import StockByKind from "@/components/labels/stock-by-kind";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { KITCHEN_STOCK_PATH } from "@/lib/auth-redirect";
import { stockFilter } from "@/lib/labels/final";
import { stockView } from "@/lib/labels/repository";
import { getSettings } from "@/lib/tenant-settings/getSettings";
import { currencyOf } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Kitchen view: raw material, preparations and returned trim apart, FIFO with lot and expiry, no money. */
export default async function KitchenStockPage({ searchParams }: { searchParams: RawSearchParams }) {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, KITCHEN_STOCK_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const [branches, settings] = await Promise.all([listBranches(gated.scope), getSettings(gated.scope)]);
  const requested = first(searchParams.branch);
  const branch = branches.find((item) => item.id === requested) ?? branches[0] ?? null;
  const filter = stockFilter(first(searchParams.type));
  const stock = branch ? await stockView(gated.scope, branch.id, filter, false) : null;
  if (stock && !stock.ok) throw new Error(`stock_items: ${stock.error}`);

  return (
    <div className="flex flex-col gap-6">
      {stock && (
        <StockByKind
          value={stock.value.value}
          blocks={stock.value.blocks}
          filter={filter}
          currency={currencyOf(settings)}
          seesMoney={false}
          link={{ path: KITCHEN_STOCK_PATH, branchId: branch?.id ?? null }}
        />
      )}
    </div>
  );
}
