import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { loginPath } from "@/lib/auth-redirect";

const PUBLIC_AUTH_PATHS = new Set(["/login", "/register"]);

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const toLogin = () => NextResponse.redirect(new URL(loginPath(`${pathname}${search}`), req.url));

  // Login and registration never require a session. Do not call getUser() here.
  if (PUBLIC_AUTH_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (!pathname.startsWith("/app")) {
    return NextResponse.next();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("MISSING ENV:", { url: !!url, key: !!key });
    return toLogin();
  }

  const res = NextResponse.next();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return toLogin();
  }
  return res;
}

export const config = { matcher: ["/login", "/register", "/app/:path*"] };
