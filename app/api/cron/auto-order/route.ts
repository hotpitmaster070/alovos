import { NextResponse } from "next/server";
import { runDueAutoOrders } from "@/lib/auto-order/repository";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Scheduler hook (Bearer CRON_SECRET): every restaurant whose auto-order time has come today in its own
 * timezone gets its drafts per supplier. Safe to call as often as wanted: each restaurant runs once a day.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) {
    console.error("cron/auto-order: SUPABASE_SERVICE_ROLE_KEY is not set");
    return NextResponse.json({ error: "save_failed" }, { status: 503 });
  }
  try {
    const runs = await runDueAutoOrders(admin);
    for (const run of runs.filter((row) => row.notify !== "system")) {
      console.log(JSON.stringify({ event: "auto_order_notify", tenant: run.tenantId, branch: run.branchId, channel: run.notify, drafts: run.drafts }));
    }
    return NextResponse.json({ runs: runs.length, drafts: runs.reduce((sum, run) => sum + run.drafts, 0) });
  } catch (error) {
    console.error("cron/auto-order:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
