import { describe, expect, it } from "vitest";

import { parseIssuanceAggregate } from "./issuance-aggregate";

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
    mintStatus: "processing",
    tokenId: null,
    issuedAt: "2026-07-21T02:30:01.000Z",
  },
  score: { points: 1 },
};

describe("issuance aggregate DTO", () => {
  it("accepts only the answer-free FAN-009 aggregate", () => {
    expect(parseIssuanceAggregate(aggregate)).toStrictEqual(aggregate);
  });

  it.each(["queued", "processing", "minted", "retryable", "permanent_failure"])(
    "accepts the %s Passport mint state independently",
    (mintStatus) => {
      expect(
        parseIssuanceAggregate({
          ...aggregate,
          passport: { ...aggregate.passport, mintStatus, tokenId: mintStatus === "minted" ? "42" : null },
        }),
      ).toBeDefined();
    },
  );

  it.each(["queued", "processing", "minted", "retryable", "permanent_failure"])(
    "accepts the %s Stamp mint state independently",
    (mintStatus) => {
      expect(
        parseIssuanceAggregate({
          ...aggregate,
          firstStamp: { ...aggregate.firstStamp, mintStatus, tokenId: mintStatus === "minted" ? "43" : null },
        }),
      ).toBeDefined();
    },
  );

  it.each([
    ["owner", { appUserId: "054dbe1b-a924-4957-bdbf-474906737a5e" }],
    ["wallet", { wallet: "0x82162619589cfe3e0dcc58c43dfbf121844f8e9c" }],
    ["answer", { isCorrect: true }],
    ["job", { blockchainJobId: "82479946-5c2b-4cb7-838a-cd48f260bbcf" }],
    ["navigation", { href: "/passport/3ff058e6-8865-46c5-ae01-94a93f1dbe3c" }],
  ])("rejects an unexpected %s field", (_label, forbidden) => {
    expect(() => parseIssuanceAggregate({ ...aggregate, ...forbidden })).toThrow();
  });

  it("rejects an aggregate that is not the issued Knowledge reward", () => {
    expect(() =>
      parseIssuanceAggregate({
        ...aggregate,
        firstStamp: { ...aggregate.firstStamp, type: "attendance" },
      }),
    ).toThrow();
    expect(() =>
      parseIssuanceAggregate({ ...aggregate, score: { points: 3 } }),
    ).toThrow();
  });

  it("rejects token shapes that contradict mint state", () => {
    expect(() =>
      parseIssuanceAggregate({
        ...aggregate,
        passport: { ...aggregate.passport, mintStatus: "minted", tokenId: null },
      }),
    ).toThrow();
    expect(() =>
      parseIssuanceAggregate({
        ...aggregate,
        firstStamp: { ...aggregate.firstStamp, tokenId: "42" },
      }),
    ).toThrow();
    expect(() =>
      parseIssuanceAggregate({
        ...aggregate,
        passport: { ...aggregate.passport, mintStatus: "minted", tokenId: "0042" },
      }),
    ).toThrow();
  });
});
