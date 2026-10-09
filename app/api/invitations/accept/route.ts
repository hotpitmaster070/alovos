import { NextResponse } from "next/server";
import { ANBAR_APP_PATH, loginPath } from "@/lib/auth-redirect";
import { INVITE_TOKEN_PATTERN } from "@/lib/purchasing/model";
import { acceptInvitation } from "@/lib/purchasing/repository";
import { invitePath } from "@/lib/purchasing/serialize";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Form post from /invite/{token}: the signed-in user joins the inviting restaurant. */
export async function POST(request: Request) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  if (!INVITE_TOKEN_PATTERN.test(token)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { supabase, userId } = await createServerSupabase();
  if (!userId) return NextResponse.redirect(new URL(loginPath(invitePath(token)), request.url), 303);

  const accepted = await acceptInvitation(supabase, token);
  if (!accepted.ok) {
    const back = new URL(invitePath(token), request.url);
    back.searchParams.set("error", accepted.error);
    return NextResponse.redirect(back, 303);
  }
  return NextResponse.redirect(new URL(ANBAR_APP_PATH, request.url), 303);
}
