import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type Credentials = { email: string; password: string };

export async function signUp({ email, password }: Credentials) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn({ email, password }: Credentials) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function ensureMyOrganization(): Promise<string> {
  const { data, error } = await supabase.rpc("ensure_my_organization");
  if (error) throw error;
  if (typeof data !== "string") {
    throw new Error("ensure_my_organization returned no organization id");
  }
  return data;
}
