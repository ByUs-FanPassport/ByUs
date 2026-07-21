import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "../../features/auth/domain/auth-errors";
import { createPassportIssuanceHandler } from "./passport-issuance-route";

const passportId = "3ff058e6-8865-46c5-ae01-94a93f1dbe3c";
const aggregate = {
  passport: { id: passportId, businessStatus: "issued", mintStatus: "queued", tokenId: null, issuedAt: "2026-07-21T02:30:00.000Z" },
  celebrity: { slug: "kara", name: "KARA", image: { url: "/kara.jpg", alt: "KARA", position: "center" } },
  firstStamp: { type: "knowledge", businessStatus: "issued", mintStatus: "queued", tokenId: null, issuedAt: "2026-07-21T02:30:01.000Z" },
  score: { points: 1 },
} as const;

function dependencies(result: typeof aggregate | null = aggregate) {
  return {
    authorize: vi.fn().mockResolvedValue({ appUserId: "054dbe1b-a924-4957-bdbf-474906737a5e" }),
    repository: { findOwnedIssuance: vi.fn().mockResolvedValue(result) },
  };
}

describe("GET /api/passports/[id]/issuance", () => {
  it("returns the exact owned issuance DTO with no-store", async () => {
    const deps = dependencies();
    const response = await createPassportIssuanceHandler(deps)(
      new Request(`https://byus.kr/api/passports/${passportId}/issuance?locale=ko`, {
        headers: { authorization: "Bearer token" },
      }),
      { passportId },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(await response.json()).toStrictEqual({ issuance: aggregate });
    expect(deps.authorize).toHaveBeenCalledWith("Bearer token");
    expect(deps.repository.findOwnedIssuance).toHaveBeenCalledWith({
      passportId,
      ownerAppUserId: "054dbe1b-a924-4957-bdbf-474906737a5e",
      locale: "ko",
    });
  });

  it("repeated GETs only repeat the same read", async () => {
    const deps = dependencies();
    const handler = createPassportIssuanceHandler(deps);
    const request = () => new Request(`https://byus.kr/api/passports/${passportId}/issuance`, { headers: { authorization: "Bearer token" } });

    const first = await handler(request(), { passportId });
    const second = await handler(request(), { passportId });

    expect(await first.json()).toStrictEqual(await second.json());
    expect(deps.repository.findOwnedIssuance).toHaveBeenCalledTimes(2);
    expect(Object.keys(deps.repository)).toStrictEqual(["findOwnedIssuance"]);
  });

  it("uses the authenticated owner and never browser identity or wallet parameters", async () => {
    const deps = dependencies();
    await createPassportIssuanceHandler(deps)(
      new Request(`https://byus.kr/api/passports/${passportId}/issuance?app_user_id=attacker&wallet=0x1234`, { headers: { authorization: "Bearer token" } }),
      { passportId },
    );
    expect(deps.repository.findOwnedIssuance).toHaveBeenCalledWith({
      passportId,
      ownerAppUserId: "054dbe1b-a924-4957-bdbf-474906737a5e",
      locale: "ko",
    });
  });

  it.each([null, undefined])("returns one opaque 404 for missing or foreign ownership (%s)", async (result) => {
    const deps = dependencies(result ?? null);
    const response = await createPassportIssuanceHandler(deps)(
      new Request(`https://byus.kr/api/passports/${passportId}/issuance`, { headers: { authorization: "Bearer token" } }),
      { passportId },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toStrictEqual({ error: { code: "NOT_FOUND" } });
  });

  it("maps auth failures and repository failures without leaking internals", async () => {
    const unauthenticated = dependencies();
    unauthenticated.authorize.mockRejectedValue(new AuthError("AUTHENTICATION_REQUIRED", 401, "secret token"));
    const authResponse = await createPassportIssuanceHandler(unauthenticated)(new Request(`https://byus.kr/api/passports/${passportId}/issuance`), { passportId });
    expect(authResponse.status).toBe(401);
    expect(await authResponse.json()).toStrictEqual({ error: { code: "UNAUTHENTICATED" } });

    const unavailable = dependencies();
    unavailable.repository.findOwnedIssuance.mockRejectedValue(new Error("service key abc"));
    const unavailableResponse = await createPassportIssuanceHandler(unavailable)(new Request(`https://byus.kr/api/passports/${passportId}/issuance`, { headers: { authorization: "Bearer token" } }), { passportId });
    expect(unavailableResponse.status).toBe(503);
    expect(unavailableResponse.headers.get("cache-control")).toBe("no-store");
    expect(await unavailableResponse.json()).toStrictEqual({ error: { code: "ISSUANCE_UNAVAILABLE" } });
  });

  it("returns opaque 404 for a malformed passport identifier without reading storage", async () => {
    const deps = dependencies();
    const response = await createPassportIssuanceHandler(deps)(new Request("https://byus.kr/api/passports/not-a-uuid/issuance", { headers: { authorization: "Bearer token" } }), { passportId: "not-a-uuid" });
    expect(response.status).toBe(404);
    expect(deps.repository.findOwnedIssuance).not.toHaveBeenCalled();
  });
});
