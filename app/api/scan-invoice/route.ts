import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";
import { SCAN_MIME, parseScanItems, readModelText } from "@/lib/scanner/model";

export const dynamic = "force-dynamic";

const BUCKET = "invoice-scans";
const MAX_BYTES = 8 * 1024 * 1024;

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function asFile(value: FormDataEntryValue | null): Blob | null {
  if (!value || typeof value === "string" || value.size <= 0) return null;
  return value;
}

export async function POST(request: Request) {
  const current = await requireTenant();
  if ("error" in current) return current.error;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("invalid_input", 400);
  }

  const photo = asFile(form.get("photo"));
  if (!photo) return fail("photo_required", 400);
  const ext = SCAN_MIME[photo.type];
  if (!ext || photo.size > MAX_BYTES) return fail("invalid_input", 400);

  const apiKey = process.env.OPENAI_API_KEY;
  if (typeof apiKey !== "string" || apiKey.trim() === "") return fail("scan_failed", 503);

  const { supabase, tenantId } = current;
  const photoPath = `${tenantId}/${crypto.randomUUID()}${ext}`;
  const bytes = new Uint8Array(await photo.arrayBuffer());
  const uploaded = await supabase.storage.from(BUCKET).upload(photoPath, bytes, {
    contentType: photo.type,
    upsert: false,
  });
  if (uploaded.error) return fail("save_failed", 500);

  const vision = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Read this invoice or receipt. Return JSON only: {\"items\":[{\"name\":\"string\",\"qty\":number,\"unit\":\"string\",\"price\":number}]}. price is the unit price. Skip totals and headers.",
            },
            {
              type: "image_url",
              image_url: { url: `data:${photo.type};base64,${Buffer.from(bytes).toString("base64")}` },
            },
          ],
        },
      ],
    }),
  });

  if (!vision.ok) {
    await supabase.storage.from(BUCKET).remove([photoPath]);
    return fail("scan_failed", 502);
  }

  let modelBody: unknown;
  try {
    modelBody = await vision.json();
  } catch {
    await supabase.storage.from(BUCKET).remove([photoPath]);
    return fail("scan_failed", 502);
  }

  const text = readModelText(modelBody);
  if (!text) {
    await supabase.storage.from(BUCKET).remove([photoPath]);
    return fail("scan_failed", 502);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    await supabase.storage.from(BUCKET).remove([photoPath]);
    return fail("scan_failed", 502);
  }

  const items = parseScanItems(parsed);
  if (items.length === 0) {
    await supabase.storage.from(BUCKET).remove([photoPath]);
    return fail("no_items", 422);
  }

  return NextResponse.json({ items, photoPath });
}
