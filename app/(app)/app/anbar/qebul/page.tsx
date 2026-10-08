import ReceiptView from "@/components/anbar/receipt-view";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches, listStorageLocations } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { normalizeCode, type RawSearchParams } from "@/lib/anbar/validation";
import { ANBAR_RECEIPT_PATH } from "@/lib/auth-redirect";
import { getSettings } from "@/lib/tenant-settings/getSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function ReceiptPage({ searchParams }: { searchParams: RawSearchParams }) {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, ANBAR_RECEIPT_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }

  const [branches, locations, settings] = await Promise.all([
    listBranches(gated.scope),
    listStorageLocations(gated.scope),
    getSettings(gated.scope),
  ]);
  const code = normalizeCode(Array.isArray(searchParams.code) ? searchParams.code[0] : searchParams.code);

  return (
    <ReceiptView branches={branches} locations={locations} initialCode={code} timezone={settings.timezone} />
  );
}
