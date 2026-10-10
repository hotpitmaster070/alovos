import { NextResponse } from "next/server";
import { claimDueAutoOrderSends, runDueAutoOrders } from "@/lib/auto-order/repository";
import { deliverClaims } from "@/lib/auto-order/send";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduler hook (Bearer CRON_SECRET), called by the alovos-auto-order job through auto_order_tick():
 * at auto_order_draft_time each restaurant gets its drafts per supplier; at auto_order_time whatever the chef
 * has not sent goes to the suppliers over WhatsApp or email. Nobody is notified; the owner sees the log in
 * the morning. Safe to call as often as wanted: each restaurant drafts and sends once a day.
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
    const outcomes = await deliverClaims(admin, await claimDueAutoOrderSends(admin));
    for (const { claim, delivery } of outcomes) {
      console.log(
        JSON.stringify({
          event: "auto_order_sent",
          trigger: "auto",
          tenant: claim.tenantId,
          request: claim.requestId,
          channel: delivery.channel,
          status: delivery.status,
          lines: claim.items.length,
        }),
      );
    }
    return NextResponse.json({
      runs: runs.length,
      drafts: runs.reduce((sum, run) => sum + run.drafts, 0),
      sent: outcomes.filter((row) => row.delivery.status === "sent").length,
      failed: outcomes.filter((row) => row.delivery.status !== "sent").length,
    });
  } catch (error) {
    console.error("cron/auto-order:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
