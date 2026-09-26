import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { translateText } from "./google-translate";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Google content translation boundary", () => {
  it("sends plain text to the fixed endpoint with a private header and normalizes the result", async () => {
    vi.stubEnv("GOOGLE_TRANSLATION_API_KEY", "test-private-key");
    const transport = vi.fn().mockResolvedValue(Response.json({ data: { translations: [{
      translatedText: "A &amp; B &#x1f496; &lt;script&gt;", detectedSourceLanguage: "ko",
    }] } }));
    vi.stubGlobal("fetch", transport);
    await expect(translateText("안녕", "zh-Hant")).resolves.toEqual({
      translatedText: "A & B 💖 <script>", detectedSourceLocale: "ko",
    });
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe("https://translation.googleapis.com/language/translate/v2");
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-private-key");
    expect(init).toMatchObject({ redirect: "error", cache: "no-store" });
    expect(JSON.parse(init.body)).toEqual({ q: "안녕", target: "zh-TW", format: "text", model: "nmt" });
  });

  it("never contacts a provider with missing configuration or invalid source/locale", async () => {
    const transport = vi.fn(); vi.stubGlobal("fetch", transport); vi.stubEnv("GOOGLE_TRANSLATION_API_KEY", "");
    await expect(translateText("안녕", "en")).rejects.toMatchObject({ code: "TRANSLATION_UNAVAILABLE" });
    await expect(translateText("x".repeat(20_001), "en")).rejects.toMatchObject({ code: "TRANSLATION_INVALID_INPUT" });
    await expect(translateText("안녕", "xx" as "en")).rejects.toMatchObject({ code: "TRANSLATION_INVALID_INPUT" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([[429, "TRANSLATION_RATE_LIMITED"], [403, "TRANSLATION_UNAVAILABLE"], [500, "TRANSLATION_FAILED"]])(
    "maps provider status %s without leaking its body", async (status, code) => {
      vi.stubEnv("GOOGLE_TRANSLATION_API_KEY", "test-private-key");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-provider-details", { status })));
      await expect(translateText("안녕", "en")).rejects.toMatchObject({ message: code, code });
    },
  );

  it("rejects oversized or malformed responses and transport failures", async () => {
    vi.stubEnv("GOOGLE_TRANSLATION_API_KEY", "test-private-key");
    const transport = vi.fn()
      .mockResolvedValueOnce(new Response("x".repeat(512_001)))
      .mockResolvedValueOnce(Response.json({ data: { translations: [] } }))
      .mockRejectedValueOnce(new Error("token and source must never escape"));
    vi.stubGlobal("fetch", transport);
    for (let i = 0; i < 3; i++) await expect(translateText("안녕", "en")).rejects.toMatchObject({ message: "TRANSLATION_FAILED" });
  });
});
