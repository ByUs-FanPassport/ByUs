import { describe, expect, it } from "vitest";
import { communityStampSchema, communityStampKstDate, AVAILABLE_COMMUNITY_STAMPS } from "./community-stamps";
const stamp = { id: "11111111-1111-4111-8111-111111111111", kind: "welcome", celebritySlug: null, issuedAt: "2026-09-12T15:00:00Z", mint: { status: "queued", txHash: null, tokenId: null } };
describe("community stamp projection", () => {
 it("accepts global welcome without invented celebrity", () => expect(communityStampSchema.parse(stamp)).toEqual(stamp));
 it.each([{ kind:"welcome",celebritySlug:"elina" }, {kind:"first_comment",celebritySlug:null}, {kind:"invite",celebritySlug:"elina"}])("rejects wrong scope %j", override => expect(communityStampSchema.safeParse({...stamp,...override}).success).toBe(false));
 it("uses KST midnight boundary", () => {expect(communityStampKstDate("2026-09-12T14:59:59Z")).toBe("2026-09-12");expect(communityStampKstDate(stamp.issuedAt)).toBe("2026-09-13");});
 it("keeps unverified external awards unavailable", () => {expect(AVAILABLE_COMMUNITY_STAMPS).not.toContain("subscription");expect(AVAILABLE_COMMUNITY_STAMPS).not.toContain("support");expect(AVAILABLE_COMMUNITY_STAMPS).toContain("share");});
});
