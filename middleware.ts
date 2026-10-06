import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  DEFAULT_AFTER_LOGIN,
  LOGIN_PATH,
  PATHNAME_HEADER,
  safeNextPath,
} from "@/lib/auth-redirect";
import { getSupabaseConfig, isSupabaseConfigError } from "@/lib/supabase/config";

/**
 * Session middleware for /app/*, /onboarding and /login.
 * Uses @supabase/ssr so the session cookie is read and refreshed the same way as server components.
 * A request without a verified user is redirected to /login (307), including /app/anbar.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isLogin = pathname === LOGIN_PATH;

  try {
    const { url, anonKey } = getSupabaseConfig();
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(PATHNAME_HEADER, `${pathname}${search}`);

    let response = NextResponse.next({ request: { headers: requestHeaders } });
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });

    const { data } = await supabase.auth.getUser();
    const user = data.user;

    if (!user && !isLogin) {
      const login = new URL(LOGIN_PATH, request.url);
      login.searchParams.set("next", safeNextPath(`${pathname}${search}`));
      return withSessionCookies(NextResponse.redirect(login), response);
    }

    if (user && isLogin) {
      const target = safeNextPath(request.nextUrl.searchParams.get("next"), DEFAULT_AFTER_LOGIN);
      return withSessionCookies(NextResponse.redirect(new URL(target, request.url)), response);
    }

    return response;
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

function withSessionCookies(target: NextResponse, sessionResponse: NextResponse): NextResponse {
  sessionResponse.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });
  return target;
}

export const config = {
  matcher: ["/app/:path*", "/login", "/onboarding"],
};
