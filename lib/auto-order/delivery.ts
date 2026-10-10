import type { Lang } from "@/lib/i18n/dictionaries";
import type { AutoOrderNotify } from "@/lib/smart-settings/model";

/**
 * Sending an order to its supplier: WhatsApp Cloud API (Meta) with an approved template, or email through
 * Resend. Both are plain HTTPS calls; credentials come from the environment, nothing is sent without them.
 */

export const DELIVERY_CHANNELS = ["whatsapp", "email", "none"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
export const DELIVERY_STATUSES = ["sent", "failed", "skipped"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
/** Why nothing was sent: the restaurant chose no messages, the supplier has no contact, no provider is set up. */
export const SKIP_REASONS = ["disabled", "no_contact", "not_configured"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export type DeliveryOutcome = { channel: DeliveryChannel; status: DeliveryStatus; providerId: string | null; error: string | null };

export type WhatsappConfig = { token: string; phoneNumberId: string; template: string; apiVersion: string };
export type EmailConfig = { apiKey: string; from: string };
export type DeliveryConfig = { whatsapp: WhatsappConfig | null; email: EmailConfig | null };

type Env = Record<string, string | undefined>;
const env = (source: Env, name: string): string | null => {
  const value = source[name]?.trim();
  return value ? value : null;
};

/** Graph API version used when WHATSAPP_API_VERSION is not set. */
export const WHATSAPP_DEFAULT_API_VERSION = "v21.0";

export function deliveryConfig(source: Env = process.env): DeliveryConfig {
  const token = env(source, "WHATSAPP_TOKEN");
  const phoneNumberId = env(source, "WHATSAPP_PHONE_NUMBER_ID");
  const template = env(source, "WHATSAPP_TEMPLATE");
  const apiKey = env(source, "RESEND_API_KEY");
  const from = env(source, "RESEND_FROM");
  return {
    whatsapp:
      token && phoneNumberId && template
        ? { token, phoneNumberId, template, apiVersion: env(source, "WHATSAPP_API_VERSION") ?? WHATSAPP_DEFAULT_API_VERSION }
        : null,
    email: apiKey && from ? { apiKey, from } : null,
  };
}

/** Template language codes registered with Meta for the order template. */
export const WHATSAPP_LANGUAGE: Record<Lang, string> = { AZ: "az", RU: "ru", EN: "en" };

/** Meta refuses template parameters with new lines, tabs or more than 4 spaces in a row. */
export const TEMPLATE_PARAM_MAX = 1000;
export function templateParam(value: string, max = TEMPLATE_PARAM_MAX): string {
  const flat = value.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The restaurant's preference first, the other channel when the first is not possible. */
export function chooseChannel(
  preference: AutoOrderNotify,
  contact: { phone: string | null; email: string | null },
  config: DeliveryConfig,
): { channel: DeliveryChannel; reason: SkipReason | null } {
  if (preference === "system") return { channel: "none", reason: "disabled" };
  const whatsapp = Boolean(contact.phone);
  const email = Boolean(contact.email);
  if (!whatsapp && !email) return { channel: "none", reason: "no_contact" };
  const order: DeliveryChannel[] = preference === "email" ? ["email", "whatsapp"] : ["whatsapp", "email"];
  for (const channel of order) {
    if (channel === "whatsapp" && whatsapp && config.whatsapp) return { channel, reason: null };
    if (channel === "email" && email && config.email) return { channel, reason: null };
  }
  return { channel: "none", reason: "not_configured" };
}

export type HttpRequest = { url: string; init: { method: "POST"; headers: Record<string, string>; body: string } };

/** Template message: {{1}} the restaurant, {{2}} the order lines. */
export function whatsappRequest(config: WhatsappConfig, phone: string, language: string, restaurant: string, lines: string): HttpRequest {
  return {
    url: `https://graph.facebook.com/${encodeURIComponent(config.apiVersion)}/${encodeURIComponent(config.phoneNumberId)}/messages`,
    init: {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone.replace(/\D/g, ""),
        type: "template",
        template: {
          name: config.template,
          language: { code: language },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: templateParam(restaurant, 100) },
                { type: "text", text: templateParam(lines) },
              ],
            },
          ],
        },
      }),
    },
  };
}

export function emailRequest(config: EmailConfig, to: string, subject: string, text: string): HttpRequest {
  return {
    url: "https://api.resend.com/emails",
    init: {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.from, to: [to], subject, text }),
    },
  };
}

type Fetch = (url: string, init: HttpRequest["init"]) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Provider message id from a WhatsApp ({messages: [{id}]}) or Resend ({id}) response. */
export function providerMessageId(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.id === "string") return payload.id;
  const first = Array.isArray(payload.messages) ? payload.messages[0] : null;
  return isRecord(first) && typeof first.id === "string" ? first.id : null;
}

export function providerError(status: number, payload: unknown): string {
  const nested = isRecord(payload) && isRecord(payload.error) ? payload.error.message : null;
  const flat = isRecord(payload) ? payload.message : null;
  const message = typeof nested === "string" ? nested : typeof flat === "string" ? flat : "";
  return `http_${status}${message ? `: ${message}` : ""}`.slice(0, 500);
}

export type OrderToDeliver = {
  phone: string | null;
  email: string | null;
  restaurant: string;
  /** Meta template language code. */
  whatsappLanguage: string;
  /** "Toyuq 15kg, Et 10kg" */
  lines: string;
  subject: string;
  /** Full message for email. */
  text: string;
};

export async function deliverOrder(
  order: OrderToDeliver,
  preference: AutoOrderNotify,
  config: DeliveryConfig,
  send: Fetch = fetch as unknown as Fetch,
): Promise<DeliveryOutcome> {
  const { channel, reason } = chooseChannel(preference, order, config);
  if (channel === "none") return { channel, status: "skipped", providerId: null, error: reason };
  const request =
    channel === "whatsapp" && config.whatsapp && order.phone
      ? whatsappRequest(config.whatsapp, order.phone, order.whatsappLanguage, order.restaurant, order.lines)
      : emailRequest(config.email as EmailConfig, order.email as string, order.subject, order.text);
  try {
    const response = await send(request.url, request.init);
    const payload = await response.json().catch(() => null);
    return response.ok
      ? { channel, status: "sent", providerId: providerMessageId(payload), error: null }
      : { channel, status: "failed", providerId: null, error: providerError(response.status, payload) };
  } catch (error) {
    return { channel, status: "failed", providerId: null, error: `network: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500) };
  }
}
