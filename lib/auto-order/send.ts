import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantScope } from "@/lib/anbar/scope";
import { isUnit } from "@/lib/anbar/types";
import { DEFAULT_LANG, dictionaries, isLang, type Dictionary, type Lang } from "@/lib/i18n/dictionaries";
import type { PurchaseRequest, PurchasingErrorCode, Supplier } from "@/lib/purchasing/model";
import { listPurchaseRequests, listSuppliers, productLabels, sendPurchaseRequest } from "@/lib/purchasing/repository";
import type { AutoOrderNotify } from "@/lib/smart-settings/model";
import { getSmartSettings } from "@/lib/smart-settings/repository";
import { getSettings } from "@/lib/tenant-settings/getSettings";
import { deliverOrder, deliveryConfig, WHATSAPP_LANGUAGE, type DeliveryConfig, type DeliveryOutcome } from "./delivery";
import { mailtoLink, orderLineText, orderMessage, whatsappLink, type AutoOrderClaim, type OrderLine } from "./model";

export type OrderMessage = {
  requestId: string;
  supplierId: string;
  supplierName: string;
  message: string;
  whatsapp: string | null;
  mailto: string | null;
  /** What happened to the message; links stay for anything not delivered. */
  delivery: DeliveryOutcome | null;
};

/** The restaurant's language for messages to suppliers; the default when it has none. */
export const messageLang = (language: string | null): Lang => {
  const code = language?.trim().toUpperCase() ?? "";
  return isLang(code) ? code : DEFAULT_LANG;
};

const lineOf = (dictionary: Dictionary, name: string, qty: number, unit: string): OrderLine => ({
  name,
  qty,
  unit: isUnit(unit) ? dictionary.anbar.units[unit] : unit,
});

/** "Salam! Sifariş: Toyuq 15kg, Et 10kg" for one request, with links to send it. */
export function draftMessage(
  dictionary: Dictionary,
  draft: PurchaseRequest,
  supplier: Pick<Supplier, "name" | "phone" | "email"> | null,
  labels: Record<string, { name: string }>,
): OrderMessage {
  const message = orderMessage(
    dictionary.autoOrder.message.greeting,
    draft.items.map((item) => lineOf(dictionary, labels[item.productId]?.name ?? item.productId, item.qty, item.unit)),
  );
  return {
    requestId: draft.id,
    supplierId: draft.supplierId,
    supplierName: supplier?.name ?? "",
    message,
    whatsapp: whatsappLink(supplier?.phone ?? null, message),
    mailto: mailtoLink(supplier?.email ?? null, dictionary.autoOrder.message.subject, message),
    delivery: null,
  };
}

/** One order through WhatsApp or email, in the restaurant's language. */
export function deliverLines(
  dictionary: Dictionary,
  lang: Lang,
  restaurant: string,
  contact: { phone: string | null; email: string | null },
  lines: OrderLine[],
  preference: AutoOrderNotify,
  config: DeliveryConfig,
): Promise<DeliveryOutcome> {
  const text = orderMessage(dictionary.autoOrder.message.greeting, lines);
  return deliverOrder(
    {
      phone: contact.phone,
      email: contact.email,
      restaurant,
      whatsappLanguage: WHATSAPP_LANGUAGE[lang],
      lines: lines.map(orderLineText).join(", "),
      subject: restaurant ? `${dictionary.autoOrder.message.subject} · ${restaurant}` : dictionary.autoOrder.message.subject,
      text: restaurant ? `${text}\n\n${restaurant}` : text,
    },
    preference,
    config,
  );
}

async function restaurantName(scope: TenantScope): Promise<string> {
  const { data } = await scope.client.from("tenants").select("name").eq("id", scope.tenantId).maybeSingle();
  return typeof data?.name === "string" ? data.name : "";
}

/**
 * The chef sends now: the drafts (all of the restaurant's, or the given ones) are marked sent and delivered
 * over the restaurant's channel. Anything not delivered keeps its wa.me / mailto links for sending by hand.
 */
export async function sendDrafts(
  scope: TenantScope,
  ids: string[] | null,
): Promise<{ sent: OrderMessage[]; failed: { requestId: string; error: PurchasingErrorCode }[] }> {
  const [drafts, suppliers, settings, smart, restaurant] = await Promise.all([
    listPurchaseRequests(scope, ["draft"]),
    listSuppliers(scope, { includeInactive: true }),
    getSettings(scope),
    getSmartSettings(scope),
    restaurantName(scope),
  ]);
  const chosen = ids ? drafts.filter((draft) => ids.includes(draft.id)) : drafts;
  const labels = await productLabels(scope, Array.from(new Set(chosen.flatMap((draft) => draft.items.map((item) => item.productId)))));
  const lang = messageLang(settings.language);
  const dictionary = dictionaries[lang];
  const preference = smart?.autoOrderNotify ?? "system";
  const config = deliveryConfig();
  const sent: OrderMessage[] = [];
  const failed: { requestId: string; error: PurchasingErrorCode }[] = [];

  for (const draft of chosen) {
    const result = await sendPurchaseRequest(scope, draft.id, null);
    if (!result.ok) {
      failed.push({ requestId: draft.id, error: result.error });
      continue;
    }
    const supplier = suppliers.find((row) => row.id === draft.supplierId) ?? null;
    const message = draftMessage(dictionary, draft, supplier, labels);
    const delivery = await deliverLines(
      dictionary,
      lang,
      restaurant,
      { phone: supplier?.phone ?? null, email: supplier?.email ?? null },
      draft.items.map((item) => lineOf(dictionary, labels[item.productId]?.name ?? item.productId, item.qty, item.unit)),
      preference,
      config,
    );
    const { error } = await scope.client.rpc("log_purchase_request_delivery", {
      p_request_id: draft.id,
      p_channel: delivery.channel,
      p_status: delivery.status,
      p_provider_id: delivery.providerId,
      p_error: delivery.error,
    });
    if (error) console.error("log_purchase_request_delivery:", error.message);
    console.log(
      JSON.stringify({
        event: "auto_order_sent",
        trigger: "chef",
        tenant: scope.tenantId,
        request: draft.id,
        supplier: draft.supplierId,
        channel: delivery.channel,
        status: delivery.status,
        lines: draft.items.length,
      }),
    );
    sent.push({ ...message, delivery });
  }
  return { sent, failed };
}

/**
 * Deadline (service_role): delivers what claim_due_auto_order_sends() took from the drafts and records the
 * outcome; finish_auto_order_send() puts undelivered requests back to draft for the chef.
 */
export async function deliverClaims(admin: SupabaseClient, claims: AutoOrderClaim[], config: DeliveryConfig = deliveryConfig()) {
  const outcomes: { claim: AutoOrderClaim; delivery: DeliveryOutcome }[] = [];
  for (const claim of claims) {
    const lang = messageLang(claim.language);
    const dictionary = dictionaries[lang];
    const delivery = await deliverLines(
      dictionary,
      lang,
      claim.restaurant,
      { phone: claim.supplierPhone, email: claim.supplierEmail },
      claim.items.map((item) => lineOf(dictionary, item.name, item.qty, item.unit)),
      claim.channel,
      config,
    );
    const { error } = await admin.rpc("finish_auto_order_send", {
      p_request_id: claim.requestId,
      p_channel: delivery.channel,
      p_status: delivery.status,
      p_provider_id: delivery.providerId,
      p_error: delivery.error,
    });
    if (error) console.error("finish_auto_order_send:", error.message);
    outcomes.push({ claim, delivery });
  }
  return outcomes;
}
