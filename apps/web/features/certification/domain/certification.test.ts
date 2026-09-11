import { describe, expect, it } from "vitest";
import { manualCertificationSchema } from "./certification";

const base = {
  id: "22222222-2222-4222-8222-222222222222",
  kind: "manual" as const,
  celebrity: { slug: "kara", name: "KARA" },
  category: "유료 멤버십",
  title: "YouTube 유료 멤버십 인증",
  description: "현재 유료 멤버십을 인증해 주세요.",
  instructions: "필수 정보를 제출해 주세요.",
  status: "available" as const,
  opensAt: "2026-09-08T00:00:00+09:00",
  closesAt: "2026-09-30T00:00:00+09:00",
  reward: { scorePoints: 1, ticketAmount: 0 },
};

describe("manual certification membership contract", () => {
  it("keeps generic manual payloads valid without membership fields", () => {
    expect(manualCertificationSchema.parse(base)).not.toHaveProperty("membershipPlatform");
  });

  it("accepts an optional safe creator profile URL and membership Stamp", () => {
    expect(manualCertificationSchema.parse({
      ...base,
      membershipPlatform: "youtube",
      creatorAccountUrl: "https://www.youtube.com/@kara",
      reward: { scorePoints: 1, ticketAmount: 0, stampCount: 1 },
    })).toMatchObject({ membershipPlatform: "youtube", reward: { stampCount: 1 } });
  });

  it("rejects non-HTTPS or credential-bearing creator account URLs", () => {
    expect(manualCertificationSchema.safeParse({ ...base, creatorAccountUrl: "http://youtube.com/@kara" }).success).toBe(false);
    expect(manualCertificationSchema.safeParse({ ...base, creatorAccountUrl: "https://user:secret@youtube.com/@kara" }).success).toBe(false);
  });
});
