import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function requireTenant() {
  const { supabase, userId } = await createServerSupabase();
  if (!userId) {
    return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  }
  const current = await supabase.rpc("current_tenant_id");
  if (current.error) return { error: NextResponse.json({ error: "save_failed" }, { status: 500 }) };
  const tenantId = typeof current.data === "string" && current.data !== "" ? current.data : null;
  if (!tenantId) return { error: NextResponse.json({ error: "no_tenant" }, { status: 403 }) };
  return { supabase, userId, tenantId };
}
