import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const current = await requireTenant();
  if ("error" in current) return current.error;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ mocked: true, items: [] });
    }
    const items =
      typeof body === "object" && body !== null && "items" in body && Array.isArray(body.items) ? body.items : [];
    return NextResponse.json({ mocked: true, items });
  }

  return NextResponse.json({ mocked: true, items: [] });
}
