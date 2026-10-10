import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness probe for uptime monitoring; public, no database call. */
export function GET() {
  return NextResponse.json({ ok: true, node: process.version }, { headers: { "cache-control": "no-store" } });
}
