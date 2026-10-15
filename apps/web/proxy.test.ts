import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "./proxy";

afterEach(() => vi.unstubAllEnvs());

describe("legacy domain redirect", () => {
  it.each(["https://byus.kr", "https://www.byus.kr"])("redirects public GET and HEAD from %s without changing the URL", (origin) => {
    vi.stubEnv("LEGACY_DOMAIN_REDIRECT_STATUS", "307");
    for (const method of ["GET", "HEAD"]) {
      const response = proxy(new NextRequest(`${origin}/live/elina?locale=en#schedule`, { method }));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("https://kyaa.io/live/elina?locale=en#schedule");
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  });

  it.each(["307", "308"])("moves admin pages to kyaa in %s mode without losing their location or indexing protection", (status) => {
    vi.stubEnv("LEGACY_DOMAIN_REDIRECT_STATUS", status);
    for (const origin of ["https://byus.kr", "https://www.byus.kr"]) {
      for (const path of ["/admin", "/admin/analytics/outbound"]) {
        for (const method of ["GET", "HEAD"]) {
          const suffix = `${path}?lang=en&days=7#details`;
          const response = proxy(new NextRequest(`${origin}${suffix}`, { method }));
          expect(response.status).toBe(Number(status));
          expect(response.headers.get("location")).toBe(`https://kyaa.io${suffix}`);
          expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
          if (status === "307") expect(response.headers.get("cache-control")).toContain("no-store");
          const destination = proxy(new NextRequest(response.headers.get("location")!, { method }));
          expect(destination.headers.has("location")).toBe(false);
          expect(destination.headers.get("x-robots-tag")).toBe("noindex, nofollow");
        }
      }
    }
  });

  it.each(["/live/elina", "/admin?lang=ko"])("supports the final 308 mode for %s without enabling redirects by default", (path) => {
    expect(proxy(new NextRequest(`https://byus.kr${path}`)).headers.has("location")).toBe(false);
    vi.stubEnv("LEGACY_DOMAIN_REDIRECT_STATUS", "308");
    const response = proxy(new NextRequest(`https://byus.kr${path}`));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`https://kyaa.io${path}`);
    expect(response.headers.has("cache-control")).toBe(false);
  });

  it.each(["", "true", "301", "invalid"])("keeps redirect disabled for value %j", (value) => {
    vi.stubEnv("LEGACY_DOMAIN_REDIRECT_STATUS", value);
    expect(proxy(new NextRequest("https://byus.kr/live/elina")).headers.has("location")).toBe(false);
  });

  it.each([
    "/login", "/my", "/c/elina/tickets", "/settings/kakao/callback", "/connect/instagram/callback", "/s/secret-token", "/t/secret-token",
    "/o/banksy/private", "/api/public/data", "/api/admin/session", "/api/provider/webhook", "/_next/static/chunk.js", "/images/photo.webp",
    "/sw.js", "/manifest.webmanifest", "/favicon.ico", "/c/elina/metadata.json",
  ])("keeps excluded legacy path %s on the old origin", (path) => {
    vi.stubEnv("LEGACY_DOMAIN_REDIRECT_STATUS", "307");
    expect(proxy(new NextRequest(`https://byus.kr${path}`)).headers.has("location")).toBe(false);
  });

  it.each(["code", "state", "error", "error_description", "privy_oauth_code", "privy_oauth_state"])(
    "does not redirect an OAuth return carrying %s",
    (key) => {
      vi.stubEnv("LEGACY_DOMAIN_REDIRECT_STATUS", "307");
      for (const path of ["/", "/admin", "/admin/analytics/outbound"]) {
        expect(proxy(new NextRequest(`https://byus.kr${path}?lang=en&${key}=opaque`)).headers.has("location")).toBe(false);
      }
    },
  );

  it.each(["307", "308"])("keeps authenticated ticket history on the old host in %s mode for GET and HEAD", (status) => {
    vi.stubEnv("LEGACY_DOMAIN_REDIRECT_STATUS", status);
    for (const method of ["GET", "HEAD"]) {
      const response = proxy(new NextRequest("https://byus.kr/c/elina/tickets?locale=ko", { method }));
      expect(response.headers.has("location")).toBe(false);
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    }
  });

  it.each(["/live/elina", "/admin?lang=ko", "/admin/analytics/outbound?lang=en"])("does not redirect POST, kyaa, preview, local, or insecure lookalike origins for %s", (path) => {
    vi.stubEnv("LEGACY_DOMAIN_REDIRECT_STATUS", "307");
    const requests = [
      new NextRequest(`https://byus.kr${path}`, { method: "POST" }),
      new NextRequest(`https://kyaa.io${path}`),
      new NextRequest(`https://byus-preview.vercel.app${path}`),
      new NextRequest(`http://localhost:3000${path}`),
      new NextRequest(`https://byus.kr.attacker.test${path}`),
      new NextRequest(`http://byus.kr${path}`),
    ];
    for (const request of requests) expect(proxy(request).headers.has("location")).toBe(false);
  });
});

describe("admin API proxy prefilter", () => {
  it("rejects a missing bearer header without an admin payload", async () => {
    const response = proxy(new NextRequest("https://byus.example/api/admin/session"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHENTICATED" } });
  });

  it("only forwards structurally valid bearer requests to the authoritative route gate", () => {
    const request = new NextRequest("https://byus.example/api/admin/session", {
      headers: { authorization: "Bearer opaque-token" },
    });
    const response = proxy(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("page locale proxy", () => {
  it("prevents indexing, caching, framing and referrer leakage of shared tokens", () => {
    const response = proxy(new NextRequest("https://byus.example/s/" + "a".repeat(32)));
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });
  it.each(["/creator/instagram", "/connect/instagram", "/connect/instagram/callback"])("keeps %s private and prevents framing/referrer leakage", (path) => {
    const response = proxy(new NextRequest(`https://byus.example${path}`));
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });
  it.each(["/creator/instagram", "/connect/instagram", "/connect/instagram/callback"])("maps added UI languages to English on %s", (path) => {
    const response = proxy(new NextRequest(`https://byus.example${path}?locale=ja`));
    expect(response.headers.get("x-middleware-request-x-byus-locale")).toBe("en");
    expect(new URL(response.headers.get("x-middleware-rewrite")!).searchParams.get("locale")).toBe("en");
  });
  it.each(["/my", "/admin", "/passports/id", "/c/ifew/verify/result", "/c/ifew/tickets", "/live/ifew-rehearsal"])("marks %s noindex without replacing authentication", (path) => {
    const response = proxy(new NextRequest(`https://byus.example${path}?locale=en&lang=en`, { headers: { "x-byus-pathname": "/" } }));
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("x-middleware-request-x-byus-pathname")).toBe(path);
  });
  it("keeps public pages indexable", () => {
    const response = proxy(new NextRequest("https://byus.example/live/ifew?locale=en"));
    expect(response.headers.has("x-robots-tag")).toBe(false);
  });
  it("forwards a validated query locale to SSR", () => {
    const response = proxy(new NextRequest("https://byus.example/c/kara?locale=en"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-request-x-byus-locale")).toBe("en");
  });

  it("uses English when the URL and browser do not select a locale", () => {
    const request = new NextRequest("https://byus.example/passports", {
      headers: { cookie: "byus_locale=en" },
    });
    const response = proxy(request);

    expect(new URL(response.headers.get('x-middleware-rewrite')!).searchParams.get('locale')).toBe('en');
  });

  it.each([['ko-KR', 'ko'], ['en-US', 'en'], ['ja-JP', 'ja'], ['zh-HK', 'zh-Hant']])('keeps creator URLs clean for %s browsers', (language, locale) => {
    const response = proxy(new NextRequest('https://byus.example/elina', { headers: { 'accept-language': language } }));
    expect(response.status).toBe(200);
    expect(response.headers.has('location')).toBe(false);
    expect(response.headers.get('x-middleware-request-x-byus-locale')).toBe(locale);
    expect(new URL(response.headers.get('x-middleware-rewrite')!).searchParams.get('locale')).toBe(locale);
    expect(response.headers.get('vary')).toContain('Cookie');
  });

  it('retains a language selected in this browser after reloading a clean URL', () => {
    const response = proxy(new NextRequest('https://byus.example/elina', { headers: { 'accept-language': 'ko-KR', cookie: 'byus_page_locale=en' } }));
    expect(response.headers.get('x-middleware-request-x-byus-locale')).toBe('en');
    expect(response.headers.has('location')).toBe(false);
  });

  it("uses a supported explicit locale instead of a stale legacy cookie", () => {
    const response = proxy(
      new NextRequest("https://byus.example/?locale=fr", {
        headers: { cookie: "byus_locale=en" },
      }),
    );

    expect(response.headers.get('x-middleware-request-x-byus-locale')).toBe('fr');
    expect(response.headers.has('x-middleware-rewrite')).toBe(false);
  });

  it.each([['ko-KR,ko;q=0.9', 'ko'], ['en-US,ko;q=0.8', 'en'], ['ja-JP', 'ja']])('preserves attendance and login return paths while selecting %s', (language, expected) => {
    for (const path of ['/live/elina?attendanceCode=ELINA2026#fan-code', '/login?returnTo=%2Flive%2Felina%3FattendanceCode%3DELINA2026%23fan-code']) {
      const original = new URL(path, 'https://byus.example');
      const result = proxy(new NextRequest(original, { headers: { 'accept-language': language } }));
      const destination = new URL(result.headers.get('x-middleware-rewrite')!);
      expect(result.status).toBe(200);
      expect(result.headers.has("location")).toBe(false);
      expect(destination.searchParams.get('locale')).toBe(expected);
      expect(destination.searchParams.get('attendanceCode')).toBe(original.searchParams.get('attendanceCode'));
      expect(destination.searchParams.get('returnTo')).toBe(original.searchParams.get('returnTo'));
      expect(destination.hash).toBe(original.hash);
      expect(result.headers.get('cache-control')).toContain('no-store');
    }
  });
  it('does not redirect explicit languages or static assets', () => {
    for (const path of ['/live/elina?locale=ko', '/live/elina?locale=en', '/live/elina?locale=fr', '/live/elina?locale=zh-Hant', '/sw.js', '/manifest.webmanifest']) {
      expect(proxy(new NextRequest(`https://byus.example${path}`)).headers.has('location')).toBe(false);
    }
  });
  it('normalizes duplicate locale parameters without looping or losing the code', () => {
    const first = proxy(new NextRequest('https://byus.example/live/elina?locale=en&locale=ko&attendanceCode=ELINA2026'));
    const destination = new URL(first.headers.get('x-middleware-rewrite')!);
    expect(destination.searchParams.getAll('locale')).toEqual(['en']);
    expect(destination.searchParams.get('attendanceCode')).toBe('ELINA2026');
    expect(proxy(new NextRequest(destination)).headers.has('location')).toBe(false);
  });
  it('does not replay a server action through a language redirect', () => {
    const response = proxy(new NextRequest('https://byus.example/live/elina', { method: 'POST', headers: { 'accept-language': 'ko-KR' } }));
    expect(response.headers.has('location')).toBe(false);
    expect(response.headers.get('x-middleware-request-x-byus-locale')).toBe('ko');
  });

  it("uses callback cookie only when query is absent and localizes manifest requests", () => {
    for (const [path, locale] of [["/settings/kakao/callback", "en"], ["/settings/kakao/callback?locale=ko", "ko"], ["/manifest.webmanifest?locale=en", "en"]]) {
      const response = proxy(new NextRequest(`https://byus.example${path}`, { headers: { cookie: "byus_locale=en" } }));
      const location = response.headers.get('x-middleware-rewrite');
      expect(location ? new URL(location).searchParams.get('locale') : response.headers.get("x-middleware-request-x-byus-locale")).toBe(locale);
    }
  });

  it("uses the existing Admin lang query contract instead of the fan locale query", () => {
    const english = proxy(new NextRequest("https://byus.example/admin?lang=en&locale=ko"));
    const korean = proxy(new NextRequest("https://byus.example/admin?lang=ko&locale=en"));

    expect(english.headers.get("x-middleware-request-x-byus-locale")).toBe("en");
    expect(korean.headers.get("x-middleware-request-x-byus-locale")).toBe("ko");
    const unsupported = proxy(new NextRequest("https://byus.example/admin?lang=ja", { headers: { "accept-language": "ja-JP,ko;q=0.8" } }));
    expect(new URL(unsupported.headers.get("location")!).searchParams.get("lang")).toBe("ko");
  });
});
