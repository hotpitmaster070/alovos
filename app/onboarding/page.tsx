import { redirect } from "next/navigation";
import OnboardingView from "@/components/auth/onboarding-view";
import { loginPath, safeNextPath } from "@/lib/auth-redirect";
import { getOrgId, OrgError } from "@/lib/org";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

type Props = { searchParams: { next?: string | string[] } };

export default async function OnboardingPage({ searchParams }: Props) {
  const next = safeNextPath(searchParams.next);
  const { supabase, userId } = await createServerSupabase();
  if (!userId) redirect(loginPath(next));

  try {
    await getOrgId(supabase);
  } catch (error) {
    if (error instanceof OrgError && error.code === "no_organization") return <OnboardingView />;
    if (error instanceof OrgError && error.code === "not_authenticated") redirect(loginPath(next));
    throw error;
  }

  redirect(next);
}
