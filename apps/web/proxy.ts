import { NextRequest, NextResponse } from "next/server";
import { isPrivatePath, isRehearsalPath } from "./seo/metadata";
import { requestLocale } from "./components/locale-path";

export function proxy(request: NextRequest): NextResponse {
  if (!request.nextUrl.pathname.startsWith("/api/admin/")) {
    const isAdminPage =
      request.nextUrl.pathname === "/admin" || request.nextUrl.pathname.startsWith("/admin/");
    const queryKey = isAdminPage ? "lang" : "locale";
    const requestedLocale = request.nextUrl.searchParams.get(queryKey);
    const locale = requestLocale(request.nextUrl.pathname, requestedLocale, request.cookies.get("byus_locale")?.value, request.headers.get("accept-language"));
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-byus-locale", locale);
    requestHeaders.set("x-byus-pathname", request.nextUrl.pathname);
    // Resolve before rendering so existing page query readers and auth return paths
    // agree with SSR. Static resources must retain their exact URLs.
    const needsLocale = (requestedLocale !== "ko" && requestedLocale !== "en")
      || request.nextUrl.searchParams.getAll(queryKey).length > 1;
    const isPage = !/\.[a-z0-9]+$/i.test(request.nextUrl.pathname);
    const destination = request.nextUrl.clone();
    destination.searchParams.set(queryKey, locale);
    const redirect = needsLocale && isPage && (request.method === "GET" || request.method === "HEAD");
    const response = redirect
      ? NextResponse.redirect(destination, 307)
      : NextResponse.next({ request: { headers: requestHeaders } });
    if (redirect) {
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("Vary", "Accept-Language, Cookie");
    }
    if (isPrivatePath(request.nextUrl.pathname) || isRehearsalPath(request.nextUrl.pathname)) {
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
    }
    if (/^\/(?:creator|connect)(?:\/|$)/.test(request.nextUrl.pathname)) {
      response.headers.set("Cache-Control", "private, no-store, max-age=0");
      response.headers.set("Referrer-Policy", "same-origin");
      response.headers.set("X-Frame-Options", "DENY");
    }
    if (/^\/s(?:\/|$)/.test(request.nextUrl.pathname)) {
      response.headers.set("Cache-Control", "private, no-store, max-age=0");
      response.headers.set("Referrer-Policy", "no-referrer");
      response.headers.set("X-Frame-Options", "DENY");
    }
    return response;
  }

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!/^Bearer[ \t]+[^\s]+$/i.test(authorization)) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED" } },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  // This is only an inexpensive structural prefilter. Every admin route must
  // independently verify Privy identity and database authorization server-side.
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/admin/:path*",
    "/((?!api/|_next/static|_next/image|favicon.ico|sw.js|images/).*)",
  ],
};
