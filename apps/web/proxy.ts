import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest): NextResponse {
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

export const config = { matcher: ["/api/admin/:path*"] };
