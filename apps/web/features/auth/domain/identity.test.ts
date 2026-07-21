import { describe, expect, it } from "vitest";

import {
  decideWalletLink,
  mapPrivyIdentity,
  normalizeEmail,
  normalizeEvmAddress,
} from "./identity";

describe("Privy canonical identity mapping", () => {
  it("uses the Privy subject as the canonical external identity", () => {
    expect(
      mapPrivyIdentity({
        privyUserId: " did:privy:fan-123 ",
        verifiedEmail: " Fan.User+ByUs@Example.COM ",
      }),
    ).toEqual({
      privyUserId: "did:privy:fan-123",
      verifiedEmail: "fan.user+byus@example.com",
    });
  });

  it("does not manufacture an identity from email", () => {
    expect(() =>
      mapPrivyIdentity({
        privyUserId: " ",
        verifiedEmail: "fan@example.com",
      }),
    ).toThrowError(/Privy user ID/i);
  });

  it("rejects unverified or malformed email instead of silently accepting it", () => {
    expect(() => normalizeEmail("not-an-email")).toThrowError(/email/i);
    expect(() =>
      mapPrivyIdentity({ privyUserId: "did:privy:1", verifiedEmail: null }),
    ).toThrowError(/verified email/i);
  });
});

describe("embedded wallet linkage", () => {
  it("normalizes EVM addresses to the database canonical form", () => {
    expect(
      normalizeEvmAddress("0xEEE82F960476C888950C798C444C1FD92CBBFE50"),
    ).toBe("0xeee82f960476c888950c798c444c1fd92cbbfe50");
  });

  it("establishes an unseen wallet and leaves an exact existing link unchanged", () => {
    const incoming = {
      chainId: 91342,
      address: "0xeee82f960476c888950c798c444c1fd92cbbfe50",
    };

    expect(decideWalletLink({ incoming, existingForUser: null, owner: null })).toEqual({
      kind: "create",
      wallet: incoming,
    });
    expect(
      decideWalletLink({
        incoming,
        existingForUser: incoming,
        owner: { appUserId: "user-1" },
        appUserId: "user-1",
      }),
    ).toEqual({ kind: "unchanged", wallet: incoming });
  });

  it("rejects one wallet being attached to two Privy subjects", () => {
    expect(() =>
      decideWalletLink({
        appUserId: "user-2",
        incoming: {
          chainId: 91342,
          address: "0xeee82f960476c888950c798c444c1fd92cbbfe50",
        },
        existingForUser: null,
        owner: { appUserId: "user-1" },
      }),
    ).toThrowError(/already linked/i);
  });

  it("rejects silently replacing a subject's existing wallet", () => {
    expect(() =>
      decideWalletLink({
        appUserId: "user-1",
        incoming: {
          chainId: 91342,
          address: "0x1111111111111111111111111111111111111111",
        },
        existingForUser: {
          chainId: 91342,
          address: "0x2222222222222222222222222222222222222222",
        },
        owner: null,
      }),
    ).toThrowError(/relink/i);
  });
});
