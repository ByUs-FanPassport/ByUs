import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, HEAD } from "./route";

const destination = "https://byus.kr/c/elina/raffles?utm_source=mirrorworld.ai&utm_medium=referral&utm_campaign=banksy";
const fetcher = vi.fn();
const request = (headers: HeadersInit = {}) => new Request(
  "https://byus.kr/go/mirrorworld-banksy?url=https://untrusted.example&fbclid=private-click",
  { headers: { "user-agent": "Mozilla/5.0 Instagram 400.0", ...headers } },
);

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://database.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-test-key");
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset().mockImplementation(async () => new Response(null, { status: 201 }));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Mirrorworld → ByUs Banksy raffle", () => {
  it("stores only the campaign before an uncached redirect to the configured destination", async () => {
    const response = await GET(request());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(destination);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://database.example/rest/v1/outbound_link_visits");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ campaign: "mirrorworld-banksy" });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(await response.text()).toBe("");
  });

  it("counts repeat navigations separately", async () => {
    await GET(request());
    await GET(request());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each<Record<string, string>>([
    { "user-agent": "facebookexternalhit/1.1" },
    { "user-agent": "meta-externalagent/1.1" },
    { "user-agent": "Googlebot" },
    { "user-agent": "Twitterbot/1.0" },
    { "user-agent": "kakaotalk-scrap/1.0" },
    { purpose: "prefetch" },
    { "sec-purpose": "prefetch;prerender" },
    { "next-router-prefetch": "1" },
  ])("redirects previews without counting: %j", async (headers) => {
    expect((await GET(request(headers))).headers.get("location")).toBe(destination);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not count HEAD requests", async () => {
    expect((await HEAD(request())).status).toBe(302);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("counts normal Mirrorworld referrals", async () => {
    expect((await GET(request({ referer: "https://mirrorworld.ai/" }))).headers.get("location")).toBe(destination);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("still redirects when the database rejects the insert", async () => {
    fetcher.mockResolvedValue(new Response('{"message":"database unavailable"}', { status: 400 }));
    expect((await GET(request())).headers.get("location")).toBe(destination);
    expect(console.error).toHaveBeenCalledWith("outbound_link_visit_failed", { campaign: "mirrorworld-banksy" });
  });

  it("still redirects when database configuration is missing", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    expect((await GET(request())).status).toBe(302);
    expect(console.error).toHaveBeenCalled();
  });

  it("aborts slow storage and redirects without waiting indefinitely", async () => {
    fetcher.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));
    expect((await GET(request())).headers.get("location")).toBe(destination);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });
});
