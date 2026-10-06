import { redirect } from "next/navigation";
import LoginForm from "@/components/auth/login-form";
import { safeNextPath } from "@/lib/auth-redirect";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

type Props = { searchParams: { next?: string | string[] } };

export default async function LoginPage({ searchParams }: Props) {
  const next = safeNextPath(searchParams.next);

  const { userId } = await createServerSupabase();
  if (userId) redirect(next);

  return <LoginForm next={next} />;
}
