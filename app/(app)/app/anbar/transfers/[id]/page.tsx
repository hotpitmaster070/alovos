import { notFound } from "next/navigation";
import TransferInvoiceView from "@/components/anbar/transfer/transfer-invoice";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { resolveScope } from "@/lib/anbar/scope";
import { transferInvoicePath } from "@/lib/auth-redirect";
import { canApproveCounts, memberRole } from "@/lib/count/load";
import { getSettings } from "@/lib/tenant-settings/getSettings";
import { loadTransferInvoice } from "@/lib/transfer/invoice";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TransferInvoicePage({ params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) notFound();
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, transferInvoicePath(params.id));
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }

  const role = await memberRole(gated.scope);
  if (!canApproveCounts(role)) return <TransferInvoiceView invoice={null} timeZone="UTC" />;

  const [invoice, settings] = await Promise.all([loadTransferInvoice(gated.scope, params.id), getSettings(gated.scope)]);
  if (!invoice) notFound();
  return <TransferInvoiceView invoice={invoice} timeZone={settings.timezone} />;
}
