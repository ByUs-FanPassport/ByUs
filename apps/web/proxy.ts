import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest): NextResponse {
  if (!request.nextUrl.pathname.startsWith("/api/admin/")) {
    const isAdminPage =
      request.nextUrl.pathname === "/admin" || request.nextUrl.pathname.startsWith("/admin/");
    const queryKey = isAdminPage ? "lang" : "locale";
    const requestedLocale = request.nextUrl.searchParams.get(queryKey);
    const locale = requestedLocale === "en" ? "en" : "ko";
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-byus-locale", locale);
    return NextResponse.next({ request: { headers: requestHeaders } });
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
    "/((?!api/|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|images/).*)",
  ],
};
