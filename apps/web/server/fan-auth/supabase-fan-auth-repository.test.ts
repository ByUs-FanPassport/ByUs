import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSupabaseFanAuthRepository } from "./supabase-fan-auth-repository";

function queryResult(data: unknown, error: unknown = null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data, error });
  return query;
}

describe("Supabase fan auth repository", () => {
  it("resolves the canonical app user by verified Privy subject", async () => {
    const query = queryResult({
      id: "054dbe1b-a924-4957-bdbf-474906737a5e",
      privy_user_id: "did:privy:fan",
      verified_email: "fan@example.com",
      status: "active",
    });
    const client = { from: vi.fn(() => query) };
    const repository = createSupabaseFanAuthRepository(
      { url: "https://example.supabase.co", serviceRoleKey: "unused-in-test" },
      client as never,
    );

    await expect(repository.findUserByPrivyId("did:privy:fan")).resolves.toStrictEqual({
      id: "054dbe1b-a924-4957-bdbf-474906737a5e",
      privyUserId: "did:privy:fan",
      verifiedEmail: "fan@example.com",
      status: "active",
    });
    expect(client.from).toHaveBeenCalledWith("app_users");
    expect(query.select).toHaveBeenCalledWith("id, privy_user_id, verified_email, status");
    expect(query.eq).toHaveBeenCalledWith("privy_user_id", "did:privy:fan");
  });

  it("returns null for an unknown subject and hides database details", async () => {
    const missing = queryResult(null);
    await expect(
      createSupabaseFanAuthRepository(
        { url: "https://example.supabase.co", serviceRoleKey: "unused-in-test" },
        { from: () => missing } as never,
      ).findUserByPrivyId("did:privy:missing"),
    ).resolves.toBeNull();

    const failed = queryResult(null, { message: "service role secret" });
    await expect(
      createSupabaseFanAuthRepository(
        { url: "https://example.supabase.co", serviceRoleKey: "unused-in-test" },
        { from: () => failed } as never,
      ).findUserByPrivyId("did:privy:fan"),
    ).rejects.toThrow("Fan identity lookup failed");
  });
});
