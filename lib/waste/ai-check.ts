import { readModelText } from "@/lib/scanner/model";

/** What waste_ai_reserve() returns for a photo log. */
export type WasteAiReservation = {
  status: "pending" | "not_checked" | "limit_reached";
  photoPath: string | null;
  productName: string;
  quantity: number;
  unit: string;
  /** Logged amount in kg; null when the unit does not convert (no portion weight / density). */
  loggedKg: number | null;
  reason: string;
  tolerancePercent: number;
};

export type WasteAiAnalysis = {
  detected: string;
  estimated_kg: number | null;
  reason_match: boolean;
  suspicious: boolean;
  notes: string;
  cost_usd: number | null;
  /** |estimated - logged| / logged, %; null when either is unknown. */
  diff_percent: number | null;
};

export type WasteAiVerdict = { status: "approved" | "suspicious"; confidence: number; analysis: WasteAiAnalysis };

export type WasteAiConfig = {
  apiKey: string;
  model: string;
  inputUsdPer1M: number | null;
  outputUsdPer1M: number | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const price = (v: string | undefined): number | null => {
  const n = num(v);
  return n !== null && n >= 0 ? n : null;
};

/** OPENAI_API_KEY and WASTE_AI_MODEL; null when either is missing (checks are then not made). */
export function wasteAiConfig(env: Record<string, string | undefined> = process.env): WasteAiConfig | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.WASTE_AI_MODEL?.trim();
  if (!apiKey || !model) return null;
  return { apiKey, model, inputUsdPer1M: price(env.WASTE_AI_INPUT_USD_PER_1M), outputUsdPer1M: price(env.WASTE_AI_OUTPUT_USD_PER_1M) };
}

export function parseReservation(raw: unknown): WasteAiReservation | null {
  if (!isRecord(raw)) return null;
  const status = raw.status;
  if (status !== "pending" && status !== "not_checked" && status !== "limit_reached") return null;
  const quantity = num(raw.quantity);
  const tolerance = num(raw.tolerance_percent);
  if (quantity === null || tolerance === null) return null;
  return {
    status,
    photoPath: typeof raw.photo_path === "string" ? raw.photo_path : null,
    productName: typeof raw.product_name === "string" ? raw.product_name : "",
    quantity,
    unit: typeof raw.unit === "string" ? raw.unit : "",
    loggedKg: num(raw.logged_kg),
    reason: typeof raw.reason === "string" ? raw.reason : "",
    tolerancePercent: tolerance,
  };
}

export function wastePrompt(r: WasteAiReservation): string {
  const weight = r.loggedKg !== null ? ` (= ${r.loggedKg} kg)` : "";
  return [
    "You check a restaurant waste photo against what a cook logged.",
    `Logged: ${r.quantity} ${r.unit} of "${r.productName}"${weight}, reason "${r.reason}".`,
    "Look at the photo and return JSON only:",
    '{"detected":"what food you see","estimated_kg":number|null,"reason_match":boolean,"suspicious":boolean,"confidence":0-100,"notes":"short"}.',
    "estimated_kg is the weight of food you see; null if you cannot tell.",
    "reason_match is false when the photo contradicts the reason (e.g. fresh food logged as spoiled).",
    "suspicious is true when the photo shows a different product, no food, or a reused/screen photo.",
  ].join("\n");
}

/** Model JSON -> analysis fields and confidence; null when it is not the asked shape. */
export function parseModelAnalysis(raw: unknown): { analysis: Omit<WasteAiAnalysis, "cost_usd" | "diff_percent">; confidence: number } | null {
  if (!isRecord(raw) || typeof raw.reason_match !== "boolean" || typeof raw.suspicious !== "boolean") return null;
  const confidence = num(raw.confidence);
  if (confidence === null) return null;
  const estimated = num(raw.estimated_kg);
  return {
    analysis: {
      detected: typeof raw.detected === "string" ? raw.detected : "",
      estimated_kg: estimated !== null && estimated >= 0 ? estimated : null,
      reason_match: raw.reason_match,
      suspicious: raw.suspicious,
      notes: typeof raw.notes === "string" ? raw.notes : "",
    },
    // Some models answer 0..1.
    confidence: Math.min(100, Math.max(0, confidence <= 1 ? confidence * 100 : confidence)),
  };
}

export function weightDiffPercent(loggedKg: number | null, estimatedKg: number | null): number | null {
  if (loggedKg === null || estimatedKg === null || loggedKg <= 0) return null;
  return (Math.abs(estimatedKg - loggedKg) / loggedKg) * 100;
}

/** Suspicious when the model says so, the reason does not match, or the weight differs above the tenant's tolerance. */
export function decideVerdict(
  r: WasteAiReservation,
  parsed: NonNullable<ReturnType<typeof parseModelAnalysis>>,
  costUsd: number | null,
): WasteAiVerdict {
  const diff = weightDiffPercent(r.loggedKg, parsed.analysis.estimated_kg);
  const suspicious = parsed.analysis.suspicious || !parsed.analysis.reason_match || (diff !== null && diff > r.tolerancePercent);
  return {
    status: suspicious ? "suspicious" : "approved",
    confidence: Math.round(parsed.confidence),
    analysis: { ...parsed.analysis, suspicious, cost_usd: costUsd, diff_percent: diff === null ? null : Math.round(diff * 10) / 10 },
  };
}

export function aiCostUsd(body: unknown, config: WasteAiConfig): number | null {
  if (!isRecord(body) || !isRecord(body.usage) || config.inputUsdPer1M === null || config.outputUsdPer1M === null) return null;
  const input = num(body.usage.prompt_tokens);
  const output = num(body.usage.completion_tokens);
  if (input === null || output === null) return null;
  return (input * config.inputUsdPer1M + output * config.outputUsdPer1M) / 1_000_000;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** One vision call; null when the call or its answer fails (the check is then given back). */
export async function analyzeWastePhoto(
  r: WasteAiReservation,
  photo: { bytes: Uint8Array; mime: string },
  config: WasteAiConfig,
  fetcher: Fetcher = fetch,
): Promise<WasteAiVerdict | null> {
  let body: unknown;
  try {
    const response = await fetcher("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: wastePrompt(r) },
              { type: "image_url", image_url: { url: `data:${photo.mime};base64,${Buffer.from(photo.bytes).toString("base64")}` } },
            ],
          },
        ],
      }),
    });
    if (!response.ok) return null;
    body = await response.json();
  } catch {
    return null;
  }
  const text = readModelText(body);
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = parseModelAnalysis(raw);
  return parsed ? decideVerdict(r, parsed, aiCostUsd(body, config)) : null;
}

export type WasteAiStatus = "not_checked" | "limit_reached" | "approved" | "suspicious";

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Reserve a check (AI off -> not_checked, over the month's limit -> limit_reached), call the model,
 * record the verdict. Any failure records not_checked, which gives the check back.
 */
export async function runWasteAiCheck(
  admin: RpcClient,
  tenantId: string,
  logId: string,
  photo: { bytes: Uint8Array; mime: string },
  config: WasteAiConfig | null,
  fetcher: Fetcher = fetch,
): Promise<WasteAiStatus> {
  const reserved = await admin.rpc("waste_ai_reserve", { p_tenant_id: tenantId, p_log_id: logId });
  const reservation = reserved.error ? null : parseReservation(reserved.data);
  if (!reservation) return "not_checked";
  if (reservation.status !== "pending") return reservation.status;

  const verdict = config ? await analyzeWastePhoto(reservation, photo, config, fetcher) : null;
  const recorded = await admin.rpc("waste_ai_record", {
    p_tenant_id: tenantId,
    p_log_id: logId,
    p_status: verdict ? verdict.status : "not_checked",
    p_confidence: verdict ? verdict.confidence : null,
    p_analysis: verdict ? verdict.analysis : { error: config ? "ai_failed" : "ai_not_configured" },
  });
  if (recorded.error || !verdict) return "not_checked";
  return verdict.status;
}
