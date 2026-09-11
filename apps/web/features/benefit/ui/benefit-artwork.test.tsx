import { describe, expect, it } from "vitest";

import { benefitArtworkSource } from "./benefit-artwork";

describe("benefit artwork", () => {
  it("prefers catalog metadata over an exact-id fallback", () => {
    expect(
      benefitArtworkSource({
        id: "81fc87bf-5264-43dd-ba08-95cf2ffc949b",
        imageUrl: "/images/raffles/catalog-image.webp",
      }),
    ).toBe("/images/raffles/catalog-image.webp");
  });

  it("uses only known benefit-id fallbacks when metadata is absent", () => {
    expect(
      benefitArtworkSource({
        id: "a2cd7407-282f-42a9-b562-aee70a271de4",
        imageUrl: null,
      }),
    ).toBe("/images/raffles/banksy-statue-20260911.jpg");
    expect(
      benefitArtworkSource({
        id: "11111111-1111-4111-8111-111111111111",
        imageUrl: null,
      }),
    ).toBeNull();
  });
});
