import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function requireTenant() {
  const { supabase, userId } = await createServerSupabase();
  if (!userId) {
    return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  }
  const profile = await supabase.from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
  if (profile.error) return { error: NextResponse.json({ error: "save_failed" }, { status: 500 }) };
  const tenantId = typeof profile.data?.tenant_id === "string" ? profile.data.tenant_id : null;
  if (!tenantId) return { error: NextResponse.json({ error: "no_tenant" }, { status: 403 }) };
  return { supabase, userId, tenantId };
}
