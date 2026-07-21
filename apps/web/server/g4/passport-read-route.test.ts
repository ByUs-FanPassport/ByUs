import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "../../features/auth/domain/auth-errors";
import { createPassportCollectionHandler, createPassportDetailHandler, createStampDetailHandler } from "./passport-read-route";

const passportId = "10000000-0000-4000-8000-000000000001";
const stampId = "20000000-0000-4000-8000-000000000001";
function dependencies() { return { authorize: vi.fn().mockResolvedValue({ appUserId: "owner" }), repository: { findCollection: vi.fn().mockResolvedValue([{ id: passportId }]), findPassport: vi.fn().mockResolvedValue({ id: passportId }), findStamp: vi.fn().mockResolvedValue({ id: stampId }) } }; }
function request(path: string, token = "Bearer token") { return new Request(`https://byus.kr${path}`, { headers: { authorization: token } }); }

describe("G4 owner read HTTP handlers", () => {
  it("returns collection/detail/stamp DTOs with no-store and canonical authenticated owner", async () => {
    const deps = dependencies();
    const collection = await createPassportCollectionHandler(deps)(request("/api/passports?locale=en&app_user_id=attacker&wallet=secret"));
    const detail = await createPassportDetailHandler(deps)(request(`/api/passports/${passportId}`), { passportId });
    const stamp = await createStampDetailHandler(deps)(request(`/api/stamps/${stampId}`), { stampId });
    expect(await collection.json()).toStrictEqual({ passports: [{ id: passportId }] });
    expect(await detail.json()).toStrictEqual({ passport: { id: passportId } });
    expect(await stamp.json()).toStrictEqual({ stamp: { id: stampId } });
    expect(collection.headers.get("cache-control")).toBe("no-store"); expect(collection.headers.get("vary")).toBe("Authorization");
    expect(deps.repository.findCollection).toHaveBeenCalledWith({ appUserId: "owner", locale: "en" });
    expect(deps.repository.findPassport).toHaveBeenCalledWith({ id: passportId, appUserId: "owner", locale: "ko" });
    expect(deps.repository.findStamp).toHaveBeenCalledWith({ id: stampId, appUserId: "owner", locale: "ko" });
  });

  it("uses the same opaque 404 for malformed, missing, and foreign detail IDs", async () => {
    const deps = dependencies(); deps.repository.findPassport.mockResolvedValue(null); deps.repository.findStamp.mockResolvedValue(null);
    const responses = [
      await createPassportDetailHandler(deps)(request("/api/passports/nope"), { passportId: "nope" }),
      await createPassportDetailHandler(deps)(request(`/api/passports/${passportId}`), { passportId }),
      await createStampDetailHandler(deps)(request(`/api/stamps/${stampId}`), { stampId }),
      await createPassportCollectionHandler(deps)(request("/api/passports?locale=fr")),
    ];
    for (const response of responses) { expect(response.status).toBe(404); expect(await response.json()).toStrictEqual({ error: { code: "NOT_FOUND" } }); }
  });

  it("redacts auth and storage failures", async () => {
    const unauthenticated = dependencies(); unauthenticated.authorize.mockRejectedValue(new AuthError("AUTHENTICATION_REQUIRED", 401, "token secret"));
    const auth = await createPassportCollectionHandler(unauthenticated)(request("/api/passports"));
    expect(auth.status).toBe(401); expect(await auth.json()).toStrictEqual({ error: { code: "UNAUTHENTICATED" } });
    const failed = dependencies(); failed.repository.findStamp.mockRejectedValue(new Error("service key"));
    const unavailable = await createStampDetailHandler(failed)(request(`/api/stamps/${stampId}`), { stampId });
    expect(unavailable.status).toBe(503); expect(await unavailable.json()).toStrictEqual({ error: { code: "STAMPS_UNAVAILABLE" } });
  });
});
