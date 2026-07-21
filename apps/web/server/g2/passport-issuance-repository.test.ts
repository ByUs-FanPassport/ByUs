import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabasePassportIssuanceRepository } from "./passport-issuance-repository";

const aggregate = {
  passport: {
    id: "3ff058e6-8865-46c5-ae01-94a93f1dbe3c",
    businessStatus: "issued",
    mintStatus: "queued",
    tokenId: null,
    issuedAt: "2026-07-21T02:30:00.000Z",
  },
  celebrity: {
    slug: "kara",
    name: "KARA",
    image: { url: "/kara.jpg", alt: "KARA", position: "center" },
  },
  firstStamp: {
    type: "knowledge",
    businessStatus: "issued",
    mintStatus: "queued",
    tokenId: null,
    issuedAt: "2026-07-21T02:30:01.000Z",
  },
  score: { points: 1 },
};

describe("SupabasePassportIssuanceRepository", () => {
  it("performs one owner-scoped read RPC with no mutation surface", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: aggregate, error: null });
    const repository = new SupabasePassportIssuanceRepository({ rpc });

    await expect(
      repository.findOwnedIssuance({
        passportId: aggregate.passport.id,
        ownerAppUserId: "054dbe1b-a924-4957-bdbf-474906737a5e",
        locale: "ko",
      }),
    ).resolves.toStrictEqual(aggregate);

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("get_owned_passport_issuance", {
      p_passport_id: aggregate.passport.id,
      p_app_user_id: "054dbe1b-a924-4957-bdbf-474906737a5e",
      p_locale: "ko",
    });
    expect(Object.keys(repository)).toStrictEqual(["client"]);
  });

  it("maps no owned row to null", async () => {
    const repository = new SupabasePassportIssuanceRepository({
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    await expect(
      repository.findOwnedIssuance({
        passportId: aggregate.passport.id,
        ownerAppUserId: "054dbe1b-a924-4957-bdbf-474906737a5e",
        locale: "en",
      }),
    ).resolves.toBeNull();
  });

  it("fails closed on database errors and malformed projections", async () => {
    const failed = new SupabasePassportIssuanceRepository({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "wallet secret" } }),
    });
    await expect(
      failed.findOwnedIssuance({
        passportId: aggregate.passport.id,
        ownerAppUserId: "054dbe1b-a924-4957-bdbf-474906737a5e",
        locale: "ko",
      }),
    ).rejects.toThrow("Passport issuance query failed");

    const malformed = new SupabasePassportIssuanceRepository({
      rpc: vi.fn().mockResolvedValue({
        data: { ...aggregate, wallet: "0x82162619589cfe3e0dcc58c43dfbf121844f8e9c" },
        error: null,
      }),
    });
    await expect(
      malformed.findOwnedIssuance({
        passportId: aggregate.passport.id,
        ownerAppUserId: "054dbe1b-a924-4957-bdbf-474906737a5e",
        locale: "ko",
      }),
    ).rejects.toThrow("Passport issuance projection is invalid");
  });
});
