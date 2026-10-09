import { redirect } from "next/navigation";
import LoginForm from "@/components/auth/login-form";
import { safeNextPath } from "@/lib/auth-redirect";
import { INVITE_TOKEN_PATTERN } from "@/lib/purchasing/model";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

type Props = { searchParams: { next?: string | string[]; invite?: string | string[] } };

export default async function RegisterPage({ searchParams }: Props) {
  const next = safeNextPath(searchParams.next);
  const invite = Array.isArray(searchParams.invite) ? searchParams.invite[0] : searchParams.invite;

  const { userId } = await createServerSupabase();
  if (userId) redirect(next);

  return (
    <LoginForm
      next={next}
      initialMode="signUp"
      inviteToken={invite && INVITE_TOKEN_PATTERN.test(invite) ? invite : null}
    />
  );
}
