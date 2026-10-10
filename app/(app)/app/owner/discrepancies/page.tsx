import DiscrepancyPage from "@/components/inventory/discrepancy-page";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { OWNER_DISCREPANCIES_PATH } from "@/lib/auth-redirect";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default function OwnerDiscrepanciesPage({ searchParams }: { searchParams: RawSearchParams }) {
  return <DiscrepancyPage searchParams={searchParams} path={OWNER_DISCREPANCIES_PATH} />;
}
