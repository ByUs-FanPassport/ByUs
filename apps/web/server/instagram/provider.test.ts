import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createInstagramProvider, normalizeMedia } from "./provider";
import { InstagramError } from "./model";

const identity = { id: "102000000000001", user_id: "178400000000001", username: "creator_test", account_type: "BUSINESS" as const };
const config = { appId: "123456", appSecret: "provider-test-secret-only", redirectUri: "https://byus-test.invalid/connect/instagram/callback", graphVersion: "v25.0" };
const longToken = { access_token: "test-long-token", expires_in: 5184000 };
function transport(...bodies: unknown[]) {
  return vi.fn<typeof fetch>().mockImplementation(async () => Response.json(bodies.shift()));
}

describe("Instagram Login HTTP provider", () => {
  it("requests only basic read permission with the current forced account-selection parameter", () => {
    const url = new URL(createInstagramProvider(config).authorizationUrl("state-value"));
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic");
    expect(url.searchParams.get("force_reauth")).toBe("true");
    expect(url.searchParams.has("force_authentication")).toBe(false);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
  });

  it.each([
    { data: [{ access_token: "short-test", user_id: identity.id, permissions: "instagram_business_basic" }] },
    { access_token: "short-test", user_id: identity.id, permissions: ["instagram_business_basic"] },
  ])("parses documented envelope and earlier flat responses without exposing tokens", async (short) => {
    const request = transport(short, longToken, identity);
    const result = await createInstagramProvider(config, request).exchange("test-code");
    expect(result).toEqual({ identity, token: { accessToken: longToken.access_token, expiresIn: longToken.expires_in } });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[0][1]?.method).toBe("POST");
    const form = request.mock.calls[0][1]?.body as URLSearchParams;
    expect(form.get("redirect_uri")).toBe(config.redirectUri);
    expect(request.mock.calls[2][1]?.headers).toEqual({ authorization: "Bearer test-long-token" });
    expect(request.mock.calls.every(([, options]) => options?.redirect === "error" && options.cache === "no-store")).toBe(true);
  });

  it.each([
    { data: [{ access_token: "short-test", user_id: identity.id, permissions: "instagram_business_manage_messages" }] },
    { data: [{ access_token: "short-test", user_id: identity.id }] },
    { data: [] },
    { access_token: "short-test", user_id: 17840000000000100, permissions: ["instagram_business_basic"] },
  ])("rejects missing permission, invalid envelopes and unsafe numeric IDs", async (short) => {
    const request = transport(short);
    await expect(createInstagramProvider(config, request).exchange("test-code")).rejects.toBeInstanceOf(InstagramError);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("compares app-scoped ID without confusing the professional ID", async () => {
    const request = transport({ data: [{ access_token: "short-test", user_id: identity.user_id, permissions: "instagram_business_basic" }] }, longToken, identity);
    await expect(createInstagramProvider(config, request).exchange("test-code")).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH" });
  });

  it("classifies token revocation and strips provider error details", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 190, message: "secret-token-in-provider-message" } }, { status: 400 }));
    await expect(createInstagramProvider(config, request).media("private-token", identity)).rejects.toEqual(new InstagramError("REAUTH_REQUIRED"));
  });

  it("fails closed on timeout and malformed token expiry", async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("https://secret.invalid/token"));
    await expect(createInstagramProvider(config, request).refresh("private-token")).rejects.toEqual(new InstagramError("UNAVAILABLE"));
    await expect(createInstagramProvider(config, transport({ access_token: "test", expires_in: -1 })).refresh("test")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("does not claim remote revocation until that endpoint is verified", async () => {
    const request = transport(true);
    await expect(createInstagramProvider(config, request).revoke("test", identity.id)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(request).not.toHaveBeenCalled();
    await createInstagramProvider({ ...config, remoteRevocationVerified: true }, request).revoke("test", identity.id);
    expect(request.mock.calls[0][1]?.method).toBe("DELETE");
  });
});

describe("Instagram media normalization", () => {
  const photo = (id: string, date: string) => ({ id, media_type: "IMAGE", media_product_type: "FEED", media_url: "https://cdninstagram.com/photo.jpg", permalink: `https://www.instagram.com/p/post${id}/`, timestamp: date, caption: "원본 캡션" });
  it("sorts newest three, uses video thumbnail and carousel representative, keeps source and original permalink", () => {
    const items = normalizeMedia({ data: [
      photo("1", "2026-09-01T00:00:00+0000"),
      { ...photo("2", "2026-09-02T00:00:00+0000"), media_type: "VIDEO", media_product_type: "REELS", media_url: "https://cdninstagram.com/video.mp4", thumbnail_url: "https://cdninstagram.com/thumb.jpg" },
      { ...photo("3", "2026-09-03T00:00:00+0000"), media_type: "CAROUSEL_ALBUM", children: { data: [{ media_type: "IMAGE", media_url: "https://cdninstagram.com/first.jpg" }] } },
      photo("4", "2026-09-04T00:00:00+0000"),
    ] }, identity);
    expect(items.map((item) => item.id)).toEqual(["4", "3", "2"]);
    expect(items[2].imageUrl).toBe("https://cdninstagram.com/thumb.jpg");
    expect(items[1].imageUrl).toBe("https://cdninstagram.com/first.jpg");
    expect(items[0].sourceAccount).toEqual({ id: identity.user_id, username: identity.username });
    expect(items[0].permalink).toBe("https://www.instagram.com/p/post4/");
  });
  it("omits stories, unsafe original URLs and videos without thumbnails", () => {
    const row = photo("1", "2026-09-01T00:00:00Z");
    expect(normalizeMedia({ data: [{ ...row, media_type: "VIDEO" }, { ...row, media_product_type: "STORY" }, { ...row, permalink: "https://instagram.com.evil.invalid/p/post1/" }] }, identity)).toEqual([]);
    expect(normalizeMedia({ data: [] }, identity)).toEqual([]);
  });
});
