import { describe, expect, it } from "vitest";
import {
  AVATAR_CHARACTER_CATALOG,
  AVATAR_CHARACTER_IDS,
  avatarSchema,
} from "./avatar";

describe("avatar domain catalog", () => {
  it("contains the exact twelve immutable character IDs and local WebP paths", () => {
    expect(AVATAR_CHARACTER_IDS).toHaveLength(12);
    expect(new Set(AVATAR_CHARACTER_IDS)).toHaveProperty("size", 12);
    expect(AVATAR_CHARACTER_CATALOG).toEqual(
      AVATAR_CHARACTER_IDS.map((id) => ({ id, assetPath: `/images/avatars/${id}.webp` })),
    );
  });

  it("keeps storage paths out of the public API DTO", () => {
    expect(
      avatarSchema.safeParse({
        initialCharacterId: "star-cream",
        characterId: "star-cream",
        source: "default",
        hasImage: false,
        revision: 0,
        objectPath: "private/path.webp",
      }).success,
    ).toBe(false);
  });
});
