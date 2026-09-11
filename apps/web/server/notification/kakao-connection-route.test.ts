import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createKakaoCallbackHandler, createKakaoEnrollmentStartHandler, createKakaoStartHandler } from "./kakao-connection-route";

function deps() {
  const repository = {
    createState: vi.fn(),
    consumeState: vi.fn(async () => ({ codeVerifier: "v".repeat(64), returnPath: "/settings?locale=ko", purpose: "connection" as const, consentVersion: null })),
    complete: vi.fn(async () => ({ provider: "kakao" as const, status: "connected" as const, connectedAt: "2026-09-04T00:00:00.000Z", disconnectedAt: null })),
    disconnect: vi.fn(),
    stageEnrollment: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111", destinationLabel: "010-****-5678", expiresAt: "2026-09-11T00:10:00Z" })),
  };
  return {
    authorize: vi.fn(async () => ({ appUserId: "owner", privyUserId: "p", verifiedEmail: "o@example.com" })),
    repository: repository as never,
    _repository: repository,
    port: {
      authorizationUrl: vi.fn(() => "https://kauth.kakao.com/oauth/authorize?state=x"),
      exchange: vi.fn(async () => ({ kakaoSubject: "123" })),
    },
    redirectUri: "https://dev.byus.test/settings/kakao/callback",
    enrollmentEnabled: true,
  };
}

function callbackRequest(body: unknown, authorization = "Bearer x") {
  return new Request("https://dev.byus.test/api/me/connected-accounts/kakao/callback", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Kakao connection routes", () => {
  it("accepts only authenticated POST starts and preserves a safe return path", async () => {
    const d = deps();
    expect((await createKakaoStartHandler(d)(new Request("https://dev.byus.test/api"))).status).toBe(405);
    d.authorize.mockRejectedValueOnce(new Error("no"));
    expect((await createKakaoStartHandler(d)(new Request("https://dev.byus.test/api", { method: "POST" }))).status).toBe(401);
    const response = await createKakaoStartHandler(d)(new Request("https://dev.byus.test/api?return=%2Fsettings%3Flocale%3Den", { method: "POST", headers: { authorization: "Bearer x" } }));
    expect(response.status).toBe(200);
    expect(d._repository.createState).toHaveBeenCalledWith(expect.objectContaining({ appUserId: "owner", returnPath: "/settings?locale=en" }));
  });

  it("requires explicit fixed consent and requests phone_number only for enrollment", async () => {
    const d = deps();
    const invalid = new Request("https://dev.byus.test/api?return=%2Fsettings", { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: JSON.stringify({ consented: false, consentVersion: "kakao-alimtalk-v1" }) });
    expect((await createKakaoEnrollmentStartHandler(d)(invalid)).status).toBe(400);
    expect(d._repository.createState).not.toHaveBeenCalled();
    const valid = new Request("https://dev.byus.test/api?return=%2Fsettings", { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: JSON.stringify({ consented: true, consentVersion: "kakao-alimtalk-v1" }) });
    expect((await createKakaoEnrollmentStartHandler(d)(valid)).status).toBe(200);
    expect(d._repository.createState).toHaveBeenCalledWith(expect.objectContaining({ purpose: "alimtalk" }));
    expect(d.port.authorizationUrl).toHaveBeenCalledWith(expect.objectContaining({ scope: "phone_number" }));
  });

  it.each([
    "https://dev.byus.test/api?return=https://evil.test",
    "https://dev.byus.test/api?return=/settings%23secret",
    "https://dev.byus.test/api?return=/settings&return=/my",
  ])("rejects an unsafe or duplicate return without creating state: %s", async (url) => {
    const d = deps();
    expect((await createKakaoStartHandler(d)(new Request(url, { method: "POST", headers: { authorization: "Bearer x" } }))).status).toBe(400);
    expect(d._repository.createState).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated callback before reading state", async () => {
    const d = deps();
    d.authorize.mockRejectedValue(new Error("no"));
    const response = await createKakaoCallbackHandler(d)(callbackRequest({ code: "c", state: "s".repeat(40) }, ""));
    expect(response.status).toBe(401);
    expect(d._repository.consumeState).not.toHaveBeenCalled();
  });

  it("consumes owner-bound state once and discards provider tokens", async () => {
    const d = deps();
    const response = await createKakaoCallbackHandler(d)(callbackRequest({ code: "c", state: "s".repeat(40) }));
    expect(response.status).toBe(200);
    expect(d._repository.consumeState).toHaveBeenCalledWith({ appUserId: "owner", stateHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(d.port.exchange).toHaveBeenCalledWith(expect.objectContaining({ redirectUri: "https://dev.byus.test/settings/kakao/callback" }));
    expect(JSON.stringify(d._repository.complete.mock.calls)).not.toContain("token");
  });

  it("stages an enrollment from the same profile response after connecting the exact subject", async () => {
    const d = deps();
    d._repository.consumeState.mockResolvedValue({ codeVerifier: "v".repeat(64), returnPath: "/settings", purpose: "alimtalk", consentVersion: "kakao-alimtalk-v1" } as never);
    d.port.exchange.mockResolvedValue({ kakaoSubject: "123", phoneNumber: "+82 10-1234-5678", phoneNumberNeedsAgreement: false } as never);
    const response = await createKakaoCallbackHandler(d)(callbackRequest({ code: "c", state: "s".repeat(40) }));
    expect(response.status).toBe(200);
    expect(d.port.exchange).toHaveBeenCalledWith(expect.objectContaining({ includePhone: true }));
    expect(d._repository.complete).toHaveBeenCalledWith({ appUserId: "owner", subjectHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(d._repository.stageEnrollment).toHaveBeenCalledWith(expect.objectContaining({ appUserId: "owner", phone: "01012345678", subjectHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(d._repository.complete.mock.invocationCallOrder[0]).toBeLessThan(d._repository.stageEnrollment.mock.invocationCallOrder[0]);
    expect(JSON.stringify(await response.json())).not.toContain("01012345678");
  });

  it("does not exchange an enrollment callback after the capability is disabled", async () => {
    const d = deps();
    d.enrollmentEnabled = false;
    d._repository.consumeState.mockResolvedValue({ codeVerifier: "v".repeat(64), returnPath: "/settings", purpose: "alimtalk", consentVersion: "kakao-alimtalk-v1" } as never);
    expect((await createKakaoCallbackHandler(d)(callbackRequest({ code: "c", state: "s".repeat(40) }))).status).toBe(400);
    expect(d.port.exchange).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { code: "", state: "s".repeat(40) },
    { code: "c", state: "short" },
    { code: "c", state: "s".repeat(40), error: "denied" },
  ])("does not consume state for malformed or provider-denied input", async (body) => {
    const d = deps();
    expect((await createKakaoCallbackHandler(d)(callbackRequest(body))).status).toBe(400);
    expect(d._repository.consumeState).not.toHaveBeenCalled();
  });

  it("revalidates a stored return path after consumption and before exchange", async () => {
    const d = deps();
    d._repository.consumeState.mockResolvedValue({ codeVerifier: "v".repeat(64), returnPath: "https://evil.test", purpose: "connection", consentVersion: null });
    expect((await createKakaoCallbackHandler(d)(callbackRequest({ code: "c", state: "s".repeat(40) }))).status).toBe(400);
    expect(d.port.exchange).not.toHaveBeenCalled();
  });

  it.each(["expired", "replayed", "owner mismatch"])("does not exchange an %s state", async () => {
    const d = deps();
    d._repository.consumeState.mockRejectedValue(new Error("invalid state"));
    expect((await createKakaoCallbackHandler(d)(callbackRequest({ code: "c", state: "s".repeat(40) }))).status).toBe(400);
    expect(d.port.exchange).not.toHaveBeenCalled();
  });

  it("returns a closed failure after an exchange error", async () => {
    const d = deps();
    d.port.exchange.mockRejectedValue(new Error("provider unavailable"));
    expect((await createKakaoCallbackHandler(d)(callbackRequest({ code: "c", state: "s".repeat(40) }))).status).toBe(400);
    expect(d.port.exchange).toHaveBeenCalledTimes(1);
    expect(d._repository.complete).not.toHaveBeenCalled();
  });
});
