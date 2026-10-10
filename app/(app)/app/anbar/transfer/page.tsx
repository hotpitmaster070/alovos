import TransferForm from "@/components/anbar/transfer/transfer-form";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches, listStorageLocations } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { ANBAR_TRANSFER_PATH } from "@/lib/auth-redirect";
import { canApproveCounts, memberRole } from "@/lib/count/load";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function TransferPage() {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, ANBAR_TRANSFER_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }

  const role = await memberRole(gated.scope);
  if (!canApproveCounts(role)) return <TransferForm allowed={false} branches={[]} locations={[]} />;

  const [branches, locations] = await Promise.all([listBranches(gated.scope), listStorageLocations(gated.scope)]);
  return <TransferForm allowed branches={branches} locations={locations.filter((item) => item.active)} />;
}
