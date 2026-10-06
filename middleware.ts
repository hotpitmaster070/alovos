import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_AFTER_LOGIN,
  isPublicAnbarPath,
  LOGIN_PATH,
  PATHNAME_HEADER,
  safeNextPath,
} from "@/lib/auth-redirect";
import { getSupabaseConfig, isSupabaseConfigError } from "@/lib/supabase/config";
import {
  COOKIE_MAX_AGE_SECONDS,
  isSessionStale,
  readSession,
  writeSession,
  type CookiePair,
  type StoredSession,
} from "@/lib/supabase/cookie-codec";

/**
 * Session middleware for /app/*, /onboarding and /login:
 *  - when the public Supabase env is missing, responds with 503 and the names of the missing variables;
 *  - refreshes an expired access token (written to the request, so server components see it, and to
 *    the response, so the browser stores it); no network call unless the token is stale;
 *  - sends visitors without a session cookie from /app/* and /onboarding to /login?next=<path>,
 *    except /app/anbar, which stays reachable without a session;
 *  - sends users with a verified session from /login to /app/anbar (or a validated ?next=);
 *  - records the pathname so the app layout can redirect without a hardcoded path.
 * Pages and server actions still verify the user with auth.getUser(); the cookie is never trusted.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isLogin = pathname === LOGIN_PATH;

  try {
    const { url, publishableKey, storageKey } = getSupabaseConfig();
    const existing = request.cookies.getAll();
    let session = readSession(storageKey, existing);
    let refreshed: { set: CookiePair[]; remove: string[] } | null = null;

    if (session && isSessionStale(session, Math.floor(Date.now() / 1000))) {
      const client = createClient(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await client.auth.refreshSession({ refresh_token: session.refresh_token });
      if (!error && data.session) {
        const next: StoredSession = { ...data.session };
        refreshed = writeSession(storageKey, next, existing);
        session = next;
      } else {
        session = null;
      }
    }

    if (!session && !isLogin && !isPublicAnbarPath(pathname)) {
      const login = new URL(LOGIN_PATH, request.url);
      login.searchParams.set("next", safeNextPath(`${pathname}${search}`));
      return NextResponse.redirect(login);
    }

    if (session && isLogin && (await isVerified(url, publishableKey, session))) {
      const target = safeNextPath(request.nextUrl.searchParams.get("next"), DEFAULT_AFTER_LOGIN);
      return withCookies(NextResponse.redirect(new URL(target, request.url)), refreshed, request);
    }

    return continueRequest(request, refreshed);
  } catch (error) {
    if (isSupabaseConfigError(error)) {
      return new NextResponse(error.message, {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return NextResponse.next();
  }
}

function continueRequest(
  request: NextRequest,
  refreshed: { set: CookiePair[]; remove: string[] } | null,
): NextResponse {
  if (refreshed) {
    for (const name of refreshed.remove) request.cookies.delete(name);
    for (const cookie of refreshed.set) request.cookies.set(cookie.name, cookie.value);
  }
  const headers = new Headers(request.headers);
  headers.set(PATHNAME_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return withCookies(NextResponse.next({ request: { headers } }), refreshed, request);
}

async function isVerified(url: string, key: string, session: StoredSession): Promise<boolean> {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.getUser(session.access_token);
  return !error && data.user !== null;
}

function withCookies(
  response: NextResponse,
  refreshed: { set: CookiePair[]; remove: string[] } | null,
  request: NextRequest,
): NextResponse {
  if (!refreshed) return response;
  for (const name of refreshed.remove) response.cookies.set(name, "", { path: "/", maxAge: 0 });
  for (const cookie of refreshed.set) {
    response.cookies.set(cookie.name, cookie.value, {
      path: "/",
      maxAge: COOKIE_MAX_AGE_SECONDS,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  }
  return response;
}

export const config = {
  matcher: ["/app/:path*", "/login", "/onboarding"],
};
