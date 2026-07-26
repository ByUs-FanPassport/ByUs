import { describe, expect, it } from "vitest";
import {
  parsePassportCollection,
  parsePassportCollectionResponse,
} from "./passport-collection";

const rawPassport = {
  id: "11111111-1111-4111-8111-111111111111",
  owner: { nickname: "Jewel_KAT" },
  celebrity: {
    slug: "katseye",
    name: "KATSEYE",
    image: {
      url: "/images/celebrities/katseye/card.webp",
      alt: "KATSEYE",
      position: "center",
    },
  },
  businessStatus: "issued",
  mint: {
    status: "queued",
    txHash: null,
    tokenId: null,
  },
  issuedAt: "2026-07-26T00:00:00.000Z",
  score: {
    points: 1,
    level: "Bronze",
  },
  stampSummary: {
    knowledge: 1,
    reservation: 0,
    attendance: 0,
    survey: 0,
    total: 1,
  },
} as const;

describe("Passport collection API contract", () => {
  it("accepts the localized DTO produced by the server projection parser", () => {
    const projected = parsePassportCollection([rawPassport], "ko");

    expect(parsePassportCollectionResponse({ passports: projected })).toStrictEqual({
      passports: projected,
    });
  });

  it.each([
    ["missing display", { ...rawPassport }],
    [
      "unknown field",
      {
        ...parsePassportCollection([rawPassport], "ko")[0],
        wallet: "must-not-leak",
      },
    ],
    [
      "inconsistent Stamp total",
      {
        ...parsePassportCollection([rawPassport], "ko")[0],
        stampSummary: {
          knowledge: 1,
          reservation: 0,
          attendance: 0,
          survey: 0,
          total: 2,
        },
      },
    ],
    [
      "invalid minted chain facts",
      {
        ...parsePassportCollection([rawPassport], "ko")[0],
        mint: {
          status: "minted",
          txHash: null,
          tokenId: null,
        },
      },
    ],
  ])("rejects %s", (_label, passport) => {
    expect(() => parsePassportCollectionResponse({ passports: [passport] })).toThrow();
  });

  it("rejects an unknown response envelope field", () => {
    const projected = parsePassportCollection([rawPassport], "en");

    expect(() => parsePassportCollectionResponse({
      passports: projected,
      internalUserId: "must-not-leak",
    })).toThrow();
  });
});
