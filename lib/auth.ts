import type { Session } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase/client";

export { getOrgId, OrgError, type OrgErrorCode } from "@/lib/org";

export type Credentials = { email: string; password: string };

export type SignUpResult =
  | { status: "signed_in" }
  | { status: "confirmation_required" }
  | { status: "email_taken" };

export async function signUp({ email, password }: Credentials): Promise<SignUpResult> {
  const { data, error } = await getBrowserClient().auth.signUp({ email, password });
  if (error) throw error;
  // Supabase answers an existing, confirmed address with a user that has no identities.
  if (data.user && data.user.identities?.length === 0) return { status: "email_taken" };
  return data.session ? { status: "signed_in" } : { status: "confirmation_required" };
}

export async function signIn({ email, password }: Credentials): Promise<void> {
  const { error } = await getBrowserClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await getBrowserClient().auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await getBrowserClient().auth.getSession();
  if (error) throw error;
  return data.session;
}
