import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export { getTenantId, OrgError, type OrgErrorCode } from "@/lib/org";

export type Credentials = { email: string; password: string };

export const DEMO_EMAIL = "test@alovos.az";
export const DEMO_PASSWORD = "Alovos123!";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

export type SignUpResult =
  | { status: "signed_in" }
  | { status: "confirmation_required" }
  | { status: "email_taken" };

/** The new restaurant's currency (ISO code) and time zone (IANA), applied by apply_signup_settings. */
export type SignUpRestaurant = { currency: string | null; timezone: string | null };

/**
 * With an invitation token the database joins the inviting restaurant instead of creating one
 * (handle_new_user reads raw_user_meta_data.invite_token); otherwise restaurant sets its currency and zone.
 */
export async function signUp(
  { email, password }: Credentials,
  inviteToken: string | null = null,
  restaurant: SignUpRestaurant | null = null,
): Promise<SignUpResult> {
  if (!isValidEmail(email)) throw new Error("Email address is invalid");
  const metadata = inviteToken
    ? { invite_token: inviteToken }
    : Object.fromEntries(Object.entries(restaurant ?? {}).filter(([, value]) => value !== null));
  const { data, error } = await createClient().auth.signUp({
    email,
    password,
    ...(Object.keys(metadata).length > 0 ? { options: { data: metadata } } : {}),
  });
  if (error) throw error;
  // Supabase answers an existing, confirmed address with a user that has no identities.
  if (data.user && data.user.identities?.length === 0) return { status: "email_taken" };
  return data.session ? { status: "signed_in" } : { status: "confirmation_required" };
}

export async function signIn({ email, password }: Credentials): Promise<void> {
  if (!isValidEmail(email)) throw new Error("Email address is invalid");
  const { error } = await createClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await createClient().auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await createClient().auth.getSession();
  if (error) throw error;
  return data.session;
}
