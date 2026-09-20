import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, HEAD } from "./route";

const destination = "https://www.ehyundai.com/newCulture/EH/EH000001_V.do?seq=2092865&bbsCd=210&eventState=";
const fetcher = vi.fn();
const request = (headers: HeadersInit = {}) => new Request(
  "https://byus.kr/go/elina-banksy?url=https://untrusted.example&fbclid=private-click",
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

describe("Elina Instagram → byus → Banksy", () => {
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
    expect(JSON.parse(options.body)).toEqual({ campaign: "elina-banksy-instagram" });
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

  it.each<[string, number]>([
    ["https://www.facebook.com/", 0],
    ["https://www.facebook.com", 0],
    ["https://facebook.com/?preview=1", 0],
    ["https://l.instagram.com/", 1],
    ["https://www.facebook.com.example/", 1],
    ["", 1],
  ])("excludes Facebook scans while counting Instagram and direct Chrome visits: %s", async (referrer, count) => {
    const response = await GET(new Request("https://byus.kr/go/elina-banksy", {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6780.64 Safari/537.36", referer: referrer },
    }));
    expect(response.headers.get("location")).toBe(destination);
    expect(fetcher).toHaveBeenCalledTimes(count);
  });

  it("excludes Meta scans when they rotate the browser version", async () => {
    const response = await GET(request({
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.8976.12 Safari/537.36",
      referer: "https://www.facebook.com/",
    }));
    expect(response.headers.get("location")).toBe(destination);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("still redirects when the database rejects the insert", async () => {
    fetcher.mockResolvedValue(new Response('{"message":"database unavailable"}', { status: 400 }));
    expect((await GET(request())).headers.get("location")).toBe(destination);
    expect(console.error).toHaveBeenCalledWith("outbound_link_visit_failed", { campaign: "elina-banksy-instagram" });
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
