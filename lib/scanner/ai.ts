export const INVOICE_PROMPT =
  "Ты — бухгалтер ресторана. Извлеки из накладной массив JSON: [{name, quantity, unit, price, total}]. " +
  "Верни ТОЛЬКО валидный JSON без markdown. " +
  "name — название товара как в накладной, quantity — количество (число), unit — единица (кг, г, л, мл, шт), " +
  "price — цена за единицу (число), total — сумма строки (число). Пропусти заголовки, итоги и НДС.";

const TIMEOUT_MS = 45_000;

export type VisionResult =
  | { ok: true; text: string; provider: "gemini" | "openai" }
  | { ok: false; error: "ai_not_configured" | "scan_failed" };

const key = (name: string): string | null => {
  const value = process.env[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
};

export const visionConfigured = (): boolean => key("GEMINI_API_KEY") !== null || key("OPENAI_API_KEY") !== null;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

async function gemini(apiKey: string, base64: string, mime: string): Promise<string | null> {
  const model = key("GEMINI_MODEL") ?? "gemini-2.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: INVOICE_PROMPT }, { inline_data: { mime_type: mime, data: base64 } }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    console.error("gemini vision failed", response.status);
    return null;
  }
  const body = record(await response.json().catch(() => null));
  const candidates = Array.isArray(body?.candidates) ? body.candidates : [];
  const parts = record(record(candidates[0])?.content)?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map((part) => (typeof record(part)?.text === "string" ? (record(part)?.text as string) : "")).join("");
  return text.trim() === "" ? null : text;
}

async function openai(apiKey: string, base64: string, mime: string): Promise<string | null> {
  const model = key("OPENAI_VISION_MODEL") ?? "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: INVOICE_PROMPT },
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    console.error("openai vision failed", response.status);
    return null;
  }
  const body = record(await response.json().catch(() => null));
  const choices = Array.isArray(body?.choices) ? body.choices : [];
  const content = record(record(choices[0])?.message)?.content;
  return typeof content === "string" && content.trim() !== "" ? content : null;
}

/** Gemini when GEMINI_API_KEY is set, else OpenAI; the other provider is tried when the first fails. */
export async function readInvoiceImage(bytes: Uint8Array, mime: string): Promise<VisionResult> {
  const geminiKey = key("GEMINI_API_KEY");
  const openaiKey = key("OPENAI_API_KEY");
  if (!geminiKey && !openaiKey) return { ok: false, error: "ai_not_configured" };
  const base64 = Buffer.from(bytes).toString("base64");
  try {
    if (geminiKey) {
      const text = await gemini(geminiKey, base64, mime);
      if (text) return { ok: true, text, provider: "gemini" };
    }
    if (openaiKey) {
      const text = await openai(openaiKey, base64, mime);
      if (text) return { ok: true, text, provider: "openai" };
    }
  } catch (error) {
    console.error("invoice vision failed", error instanceof Error ? error.name : "unknown");
  }
  return { ok: false, error: "scan_failed" };
}
