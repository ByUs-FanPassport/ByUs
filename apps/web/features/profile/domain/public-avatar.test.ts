import { describe, expect, it } from "vitest";
import { publicAvatarUrlSchema } from "./avatar";
import { fanCommunitySchema } from "../../fanpage/domain/fan-community";
import { fanpageSummarySchema, leaderboardSchema, commentSchema } from "../../fanpage/domain/community";
import { loungeMessageSchema } from "../../lounge/domain/lounge";
import { authorSchema } from "../../fan-posts/domain/content";

const id = "11111111-1111-4111-8111-111111111111";
const photo = `/api/fan-avatars/${id}?revision=2`;
const createdAt = "2026-10-11T00:00:00Z";
const author = { nickname: "사진 팬", avatarUrl: photo };

describe("shared public avatar contract", () => {
  it.each([photo, `/api/fan-avatars/${id}?revision=2147483647`, "/images/avatars/heart-pink.webp"])("accepts current and legacy URLs: %s", value => {
    expect(publicAvatarUrlSchema.safeParse(value).success).toBe(true);
  });
  it.each([
    "https://example.com/photo.webp", "//example.com/photo.webp", "/api/me/avatar/image?revision=2",
    `/api/fan-avatars/${id}?revision=2147483648`, `/api/fan-avatars/${id}?revision=-1`,
    `/api/fan-avatars/${id}?revision=02`, `/api/fan-avatars/${id}?revision=2&extra=1`,
    `/api/fan-avatars/${id}?revision=2#private`, "/api/fan-avatars/not-a-uuid?revision=2",
  ])("rejects arbitrary or invalid image URLs: %s", value => {
    expect(publicAvatarUrlSchema.safeParse(value).success).toBe(false);
  });
  it("parses photos across fans, activity, rank, comments, lounge, and post authors", () => {
    expect(fanCommunitySchema.safeParse({ likeCount: 1, fanCount: 1, publicFanCount: 1, fans: [author] }).success).toBe(true);
    expect(fanpageSummarySchema.safeParse({ membershipCount: 100, fanCount: 100, leaderboardAvailable: true,
      activity: [{ ...author, kind: "joined", tier: null, occurredAt: createdAt }] }).success).toBe(true);
    expect(leaderboardSchema.safeParse({ membershipCount: 100, fanCount: 100, available: true, asOf: createdAt,
      rows: [{ ...author, rank: 1, points: 5 }], me: null }).success).toBe(true);
    const comment = { ...author, id, body: "응원해요", createdAt, isOwner: false };
    expect(commentSchema.safeParse(comment).success).toBe(true);
    expect(loungeMessageSchema.safeParse({ ...comment, replyTo: null, reactions: [] }).success).toBe(true);
    expect(authorSchema.safeParse(author).success).toBe(true);
  });
});
