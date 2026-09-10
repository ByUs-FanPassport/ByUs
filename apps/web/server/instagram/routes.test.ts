import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createInstagramCallbackHandler, createInstagramConfirmHandler, createInstagramInviteHandler, createInstagramStartHandler, type InstagramRouteDependencies } from "./routes";
import { secretHash } from "./crypto";
import type { InstagramRepository } from "./repository";

const identity = { id: "102000000000001", user_id: "178400000000001", username: "creator_test", account_type: "BUSINESS" };
const secret = "a".repeat(43);
const browser = "b".repeat(43);
const pending = "c".repeat(43);
const origin = "https://byus-test.invalid";
const flow = { celebrity_id: "11111111-1111-4111-8111-111111111111", generation: "22222222-2222-4222-8222-222222222222", expected_username: "creator_test", expected_user_id: null, celebrity_name: "연결 대상", locale: "ko" as const, payload: { identity }, expires_at: "2026-09-08T00:10:00Z" };
function setup() {
  const repository = {
    issueInvite: vi.fn<InstagramRepository["issueInvite"]>(async () => undefined), transition: vi.fn<InstagramRepository["transition"]>(async () => flow), disconnect: vi.fn(),
    deleteSubject: vi.fn(), deletionStatus: vi.fn(), claimSync: vi.fn(), finishSync: vi.fn(),
  };
  const service = { callback: vi.fn(async () => pending), disconnect: vi.fn(), sync: vi.fn(async () => []) };
  const deps = {
    config: { appId: "123", appSecret: "unit-test-secret", encryptionKey: "", graphVersion: "v25.0", origin, redirectUri: `${origin}/connect/instagram/callback`, remoteRevocationVerified: false },
    repository, provider: { authorizationUrl: vi.fn((state) => `https://www.instagram.com/oauth/authorize?state=${state}`) }, service,
    authorize: vi.fn(async () => ({ role: "operator", appUserId: "actor", allowlistId: "allow", email: "test@example.invalid" })),
  } as unknown as InstagramRouteDependencies;
  return { deps, repository, service };
}
const cookie = `__Host-byus_ig_browser=${browser}; __Host-byus_ig_pending=${pending}`;
const form = (path: string, values: Record<string, string>, headers: Record<string, string> = {}) => new Request(`${origin}${path}`, {
  method: "POST", headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(values),
});

describe("Instagram administrator boundary", () => {
  it("denies viewer writes and does not issue an invitation", async () => {
    const { deps, repository } = setup();
    deps.authorize = vi.fn<InstagramRouteDependencies["authorize"]>(async () => ({ role: "viewer", appUserId: "viewer", allowlistId: "allow", email: "test@example.invalid" }));
    const response = await createInstagramInviteHandler(deps)(new Request(`${origin}/api/admin/instagram/invites`, { method: "POST", body: "{}" }));
    expect(response.status).toBe(403);
    expect(repository.issueInvite).not.toHaveBeenCalled();
  });
  it("binds an operator-created link to separately supplied target and expected identity", async () => {
    const { deps, repository } = setup();
    const response = await createInstagramInviteHandler(deps)(new Request(`${origin}/api/admin/instagram/invites`, { method: "POST", body: JSON.stringify({ celebrityId: flow.celebrity_id, expectedUsername: "Creator_Test", expectedUserId: identity.user_id }) }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(new URL(body.connectionUrl).origin).toBe(origin);
    expect(repository.issueInvite).toHaveBeenCalledWith(expect.objectContaining({ celebrityId: flow.celebrity_id, username: "creator_test", userId: identity.user_id, locale: "ko" }));
    expect(JSON.stringify(repository.issueInvite.mock.calls)).not.toContain(new URL(body.connectionUrl).searchParams.get("invite"));
  });
});

describe("Instagram creator browser flow", () => {
  it("GET invite only previews, sets secure browser cookie, and has no third-party scripts", async () => {
    const { deps, repository } = setup();
    const response = await createInstagramStartHandler(deps)(new Request(`${origin}/connect/instagram/start?invite=${secret}`));
    const html = await response.text();
    expect(repository.transition).toHaveBeenCalledWith("peek_invite", secretHash(secret));
    expect(response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax");
    expect(response.headers.get("set-cookie")).toContain("; Secure");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(html).not.toContain("<script");
    expect(html).toContain("연결 대상");
    expect(html).toContain("@creator_test");
  });
  it("rejects foreign origin, missing cookie, duplicate and missing CSRF without consuming invite", async () => {
    const { deps, repository } = setup();
    const start = createInstagramStartHandler(deps);
    const valid = { invite: secret, locale: "ko", csrf: secretHash(`instagram-form:${browser}:${secret}`) };
    for (const request of [form("/connect/instagram/start", valid, { origin: "https://evil.invalid" }), form("/connect/instagram/start", valid, { cookie: "" }), form("/connect/instagram/start", { invite: secret })]) {
      expect((await start(request)).status).toBe(400);
    }
    expect(repository.transition).not.toHaveBeenCalled();
    expect((await start(form("/connect/instagram/start", valid))).status).toBe(303);
    expect(repository.transition).toHaveBeenCalledWith("peek_invite", secretHash(secret));
    expect(repository.transition).toHaveBeenCalledWith("start", secretHash(secret), secretHash(browser), expect.objectContaining({ next_hash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
  });
  it("accepts an already-open invite form without a locale field and uses the stored flow locale", async () => {
    const { deps, repository } = setup();
    repository.transition.mockResolvedValue({ ...flow, locale: "en" });
    const response = await createInstagramStartHandler(deps)(form("/connect/instagram/start", {
      invite: secret,
      csrf: secretHash(`instagram-form:${browser}:${secret}`),
    }));
    expect(response.status).toBe(303);
    expect(repository.transition.mock.calls.map((call) => call[0])).toEqual(["peek_invite", "start"]);
  });
  it("rejects duplicate callback fields or an absent browser without exchanging a code", async () => {
    const { deps, service } = setup();
    const callback = createInstagramCallbackHandler(deps);
    expect((await callback(new Request(`${origin}/connect/instagram/callback?state=${secret}&code=one&code=two`, { headers: { cookie } }))).status).toBe(400);
    expect((await callback(new Request(`${origin}/connect/instagram/callback?state=${secret}&code=one`))).status).toBe(400);
    expect(service.callback).not.toHaveBeenCalled();
  });
  it("cancellation consumes and discards state without exchanging tokens", async () => {
    const { deps, repository, service } = setup();
    const response = await createInstagramCallbackHandler(deps)(new Request(`${origin}/connect/instagram/callback?state=${secret}&error=access_denied`, { headers: { cookie } }));
    expect(response.status).toBe(200);
    expect(repository.transition.mock.calls.map((call) => call[0])).toEqual(["peek_state", "consume", "cancel"]);
    expect(service.callback).not.toHaveBeenCalled();
  });
  it("redirects from OAuth code URL to a clean confirmation URL with HttpOnly pending secret", async () => {
    const { deps } = setup();
    const response = await createInstagramCallbackHandler(deps)(new Request(`${origin}/connect/instagram/callback?state=${secret}&code=test-code`, { headers: { cookie } }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/connect/instagram/confirm?locale=ko");
    expect(response.headers.get("set-cookie")).toContain("__Host-byus_ig_pending=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });
  it("requires explicit confirmation with CSRF and keeps success despite an initial media error", async () => {
    const { deps, repository, service } = setup();
    const confirm = createInstagramConfirmHandler(deps);
    expect((await confirm(form("/connect/instagram/confirm", { action: "confirm", csrf: "wrong" }))).status).toBe(400);
    expect(repository.transition).toHaveBeenCalledTimes(1);
    expect(repository.transition).toHaveBeenCalledWith("peek_pending", secretHash(pending), secretHash(browser));
    service.sync.mockRejectedValueOnce(new Error("media unavailable"));
    const response = await confirm(form("/connect/instagram/confirm", { action: "confirm", csrf: secretHash(`instagram-form:${browser}:${pending}`) }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Instagram을 연결했어요");
    expect(repository.transition).toHaveBeenCalledWith("confirm", secretHash(pending), secretHash(browser));
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("keeps an English locale across invite, OAuth and confirmation pages", async () => {
    const { deps, repository } = setup();
    repository.transition.mockResolvedValue({ ...flow, locale: "en", celebrity_name: "Creator" });
    const invite = await createInstagramInviteHandler(deps)(new Request(`${origin}/api/admin/instagram/invites`, { method: "POST", body: JSON.stringify({ celebrityId: flow.celebrity_id, expectedUsername: "creator_test", expectedUserId: null, locale: "en" }) }));
    expect((await invite.json()).connectionUrl).toContain("locale=en");
    expect(repository.issueInvite).toHaveBeenCalledWith(expect.objectContaining({ locale: "en" }));
    const start = await createInstagramStartHandler(deps)(new Request(`${origin}/connect/instagram/start?invite=${secret}&locale=en`));
    expect(await start.text()).toContain('<html lang="en">');
    const callback = await createInstagramCallbackHandler(deps)(new Request(`${origin}/connect/instagram/callback?state=${secret}&error=access_denied`, { headers: { cookie } }));
    expect(await callback.text()).toContain("Connection cancelled");
    const confirm = await createInstagramConfirmHandler(deps)(new Request(`${origin}/connect/instagram/confirm?locale=en`, { headers: { cookie } }));
    const html = await confirm.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Privacy Policy");
    expect(html).toContain("Connect this account");
  });
});
