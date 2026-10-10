import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";
import { takeRateLimit } from "@/lib/rate-limit";
import { readInvoiceImage, visionConfigured } from "@/lib/scanner/ai";
import { SCAN_MIME, parseModelJson, parseScanItems, type ScanItem } from "@/lib/scanner/model";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "invoice-scans";
const MAX_BYTES = 8 * 1024 * 1024;
const SCANS_PER_MINUTE = 10;
const NOT_CONFIGURED = "Добавьте GEMINI_API_KEY в environment variables";

function fail(error: string, status: number, message?: string) {
  return NextResponse.json(message ? { error, message } : { error }, { status });
}

function asFile(value: FormDataEntryValue | null): Blob | null {
  if (!value || typeof value === "string" || value.size <= 0) return null;
  return value;
}

type Image = { bytes: Uint8Array; mime: string };

/**
 * Keeps the prices of a scan for someone who must not see them; the browser gets only the scan id.
 * Null when the cache is unavailable (no service role key or a write error): the prices are then dropped.
 */
async function cachePrices(tenantId: string, userId: string, items: ScanItem[]): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) {
    console.error("scan-invoice: SUPABASE_SERVICE_ROLE_KEY is not set; delegate scan prices are dropped");
    return null;
  }
  await admin.from("invoice_scan_cache").delete().lt("expires_at", new Date().toISOString());
  const scanId = crypto.randomUUID();
  const { error } = await admin.from("invoice_scan_cache").insert({
    tenant_id: tenantId,
    user_id: userId,
    scan_id: scanId,
    prices: items.map((item, index) => ({ i: index, qty: item.qty, price: item.price, total: item.total })),
  });
  if (error) {
    console.error("scan-invoice: price cache write failed", error.message);
    return null;
  }
  return scanId;
}

/** FormData with `photo` (or `image`), or JSON {image: "data:image/jpeg;base64,..." | base64, mime?}. */
async function readImage(request: Request): Promise<Image | "too_large" | null> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body: unknown = await request.json().catch(() => null);
    if (typeof body !== "object" || body === null) return null;
    const record = body as Record<string, unknown>;
    if (typeof record.image !== "string") return null;
    const match = /^data:([\w/+.-]+);base64,([\s\S]*)$/.exec(record.image);
    const mime = match ? match[1] : typeof record.mime === "string" ? record.mime : "image/jpeg";
    const data = match ? match[2] : record.image;
    if (data.length > Math.ceil((MAX_BYTES * 4) / 3) + 4) return "too_large";
    const bytes = new Uint8Array(Buffer.from(data, "base64"));
    return bytes.length > 0 ? { bytes, mime } : null;
  }
  const form = await request.formData().catch(() => null);
  if (!form) return null;
  const photo = asFile(form.get("photo")) ?? asFile(form.get("image"));
  if (!photo) return null;
  if (photo.size > MAX_BYTES) return "too_large";
  return { bytes: new Uint8Array(await photo.arrayBuffer()), mime: photo.type };
}

export async function POST(request: Request) {
  const current = await requireTenant();
  if ("error" in current) return current.error;

  if (!visionConfigured()) return fail("ai_not_configured", 503, NOT_CONFIGURED);
  if (!takeRateLimit(`scan-invoice:${current.userId}`, SCANS_PER_MINUTE, 60_000)) {
    return fail("rate_limited", 429);
  }

  const image = await readImage(request);
  if (image === null) return fail("photo_required", 400);
  if (image === "too_large") return fail("invalid_input", 400);
  const ext = SCAN_MIME[image.mime];
  if (!ext || image.bytes.length > MAX_BYTES) return fail("invalid_input", 400);

  const { supabase, tenantId } = current;
  const photoPath = `${tenantId}/${crypto.randomUUID()}${ext}`;
  const uploaded = await supabase.storage.from(BUCKET).upload(photoPath, image.bytes, {
    contentType: image.mime,
    upsert: false,
  });
  if (uploaded.error) return fail("save_failed", 500);
  const discard = () => supabase.storage.from(BUCKET).remove([photoPath]);

  const vision = await readInvoiceImage(image.bytes, image.mime);
  if (!vision.ok) {
    await discard();
    return vision.error === "ai_not_configured" ? fail(vision.error, 503, NOT_CONFIGURED) : fail("scan_failed", 502);
  }

  const items = parseScanItems(parseModelJson(vision.text));
  if (items.length === 0) {
    await discard();
    return fail("no_items", 422);
  }

  const costs = await supabase.rpc("can_see_costs");
  if (!costs.error && costs.data === true) {
    return NextResponse.json({
      items: items.map((item) => ({ ...item, quantity: item.qty })),
      photoPath,
      scan_id: crypto.randomUUID(),
      isDelegated: false,
    });
  }

  // No prices in the response for anyone who must not see them; they wait server-side under scan_id.
  const scanId = await cachePrices(tenantId, current.userId, items);
  return NextResponse.json({
    items: items.map(({ name, qty, unit }) => ({ name, qty, quantity: qty, unit })),
    photoPath,
    scan_id: scanId,
    isDelegated: true,
  });
}
