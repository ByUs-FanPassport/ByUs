import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSupabaseLiveManagerRepository } from "./live-manager-repository";

describe("LiveManagerRepository", () => {
  it("writes the canonical provider and external LIVE URL through v3", async () => {
    const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
      data: { id: "33333333-3333-4333-8333-333333333333" },
      error: null,
    }));
    const repository = createSupabaseLiveManagerRepository(
      { url: "https://supabase.example", serviceRoleKey: "test" },
      { rpc } as never,
    );

    await repository.save(
      {
        appUserId: "11111111-1111-4111-8111-111111111111",
        allowlistId: "22222222-2222-4222-8222-222222222222",
      },
      "44444444-4444-4444-8444-444444444444",
      {
        id: null,
        slug: "artist-live",
        celebrityId: "55555555-5555-4555-8555-555555555555",
        brandId: "66666666-6666-4666-8666-666666666666",
        startsAt: "2026-09-10T10:00:00Z",
        endsAt: "2026-09-10T11:00:00Z",
        reservationOpensAt: "2026-09-09T10:00:00Z",
        reservationClosesAt: "2026-09-10T10:00:00Z",
        liveProvider: "instagram",
        externalLiveUrl: "https://www.instagram.com/example/live/",
        heroUrl: "/hero.jpg",
        titleKo: "제목",
        summaryKo: "요약",
        heroAltKo: "이미지",
        titleEn: "Title",
        summaryEn: "Summary",
        heroAltEn: "Image",
      },
    );

    expect(rpc).toHaveBeenCalledWith(
      "save_admin_live_draft_v3",
      expect.objectContaining({
        p_live_provider: "instagram",
        p_external_live_url: "https://www.instagram.com/example/live/",
      }),
    );
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_youtube_url");
  });
});
