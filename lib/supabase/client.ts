import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("MISSING ENV:", { url: !!url, key: !!key });
    throw new Error("Supabase env is missing. Check .env.local has NEXT_PUBLIC_SUPABASE_URL and ANON_KEY");
  }
  return createBrowserClient(url, key);
}
