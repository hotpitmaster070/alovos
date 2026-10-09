import { notFound } from "next/navigation";
import InviteAccept from "@/components/purchasing/invite-accept";
import { loginPath, registerPath } from "@/lib/auth-redirect";
import { INVITE_TOKEN_PATTERN, isPurchasingErrorCode } from "@/lib/purchasing/model";
import { invitationPreview } from "@/lib/purchasing/repository";
import { invitePath } from "@/lib/purchasing/serialize";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

type Props = { params: { token: string }; searchParams: { error?: string | string[] } };

export default async function InvitePage({ params, searchParams }: Props) {
  const token = params.token;
  if (!INVITE_TOKEN_PATTERN.test(token)) notFound();
  const { supabase, userId } = await createServerSupabase();
  const preview = userId ? await invitationPreview(supabase, token) : null;
  const rawError = Array.isArray(searchParams.error) ? searchParams.error[0] : searchParams.error;
  const back = invitePath(token);

  return (
    <InviteAccept
      token={token}
      preview={userId ? (preview ?? { tenantName: null, role: null, state: "not_found" }) : null}
      error={isPurchasingErrorCode(rawError) ? rawError : null}
      signInHref={loginPath(back)}
      signUpHref={registerPath(back, token)}
    />
  );
}
