import type { TenantScope } from "@/lib/anbar/scope";
import { isUnit } from "@/lib/anbar/types";
import { DEFAULT_LANG, dictionaries, isLang, type Dictionary, type Lang } from "@/lib/i18n/dictionaries";
import type { PurchaseRequest, PurchasingErrorCode, Supplier } from "@/lib/purchasing/model";
import { listPurchaseRequests, listSuppliers, productLabels, sendPurchaseRequest } from "@/lib/purchasing/repository";
import { getSmartSettings } from "@/lib/smart-settings/repository";
import { getSettings } from "@/lib/tenant-settings/getSettings";
import { mailtoLink, orderMessage, whatsappLink } from "./model";

export type OrderMessage = {
  requestId: string;
  supplierId: string;
  supplierName: string;
  message: string;
  whatsapp: string | null;
  mailto: string | null;
};

/** The restaurant's language for messages to suppliers; the default when it has none. */
export const messageLang = (language: string | null): Lang => {
  const code = language?.trim().toUpperCase() ?? "";
  return isLang(code) ? code : DEFAULT_LANG;
};

/** "Salam! Sifariş: Toyuq 15kg, Et 10kg" for one request, with links to send it. */
export function draftMessage(
  dictionary: Dictionary,
  draft: PurchaseRequest,
  supplier: Pick<Supplier, "name" | "phone" | "email"> | null,
  labels: Record<string, { name: string }>,
): OrderMessage {
  const message = orderMessage(
    dictionary.autoOrder.message.greeting,
    draft.items.map((item) => ({
      name: labels[item.productId]?.name ?? item.productId,
      qty: item.qty,
      unit: isUnit(item.unit) ? dictionary.anbar.units[item.unit] : item.unit,
    })),
  );
  return {
    requestId: draft.id,
    supplierId: draft.supplierId,
    supplierName: supplier?.name ?? "",
    message,
    whatsapp: whatsappLink(supplier?.phone ?? null, message),
    mailto: mailtoLink(supplier?.email ?? null, dictionary.autoOrder.message.subject, message),
  };
}

/**
 * Marks the drafts sent (all of the restaurant's, or the given ones) and builds each supplier's message.
 * Delivery over WhatsApp or email is only logged for now; the caller gets links to open by hand.
 */
export async function sendDrafts(
  scope: TenantScope,
  ids: string[] | null,
): Promise<{ sent: OrderMessage[]; failed: { requestId: string; error: PurchasingErrorCode }[] }> {
  const [drafts, suppliers, settings, smart] = await Promise.all([
    listPurchaseRequests(scope, ["draft"]),
    listSuppliers(scope, { includeInactive: true }),
    getSettings(scope),
    getSmartSettings(scope),
  ]);
  const chosen = ids ? drafts.filter((draft) => ids.includes(draft.id)) : drafts;
  const labels = await productLabels(scope, Array.from(new Set(chosen.flatMap((draft) => draft.items.map((item) => item.productId)))));
  const dictionary = dictionaries[messageLang(settings.language)];
  const channel = smart?.autoOrderNotify ?? "system";
  const sent: OrderMessage[] = [];
  const failed: { requestId: string; error: PurchasingErrorCode }[] = [];

  for (const draft of chosen) {
    const result = await sendPurchaseRequest(scope, draft.id, null);
    if (!result.ok) {
      failed.push({ requestId: draft.id, error: result.error });
      continue;
    }
    console.log(
      JSON.stringify({ event: "auto_order_sent", tenant: scope.tenantId, request: draft.id, supplier: draft.supplierId, channel, lines: draft.items.length }),
    );
    sent.push(draftMessage(dictionary, draft, suppliers.find((row) => row.id === draft.supplierId) ?? null, labels));
  }
  return { sent, failed };
}
