import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  createGetLiveManagerHandler,
  createPostLiveManagerHandler,
  type LiveManagerDependencies,
} from "./live-manager-route";

const actor = {
  email: "ops@byus.test",
  role: "operator" as const,
  appUserId: "11111111-1111-4111-8111-111111111111",
  allowlistId: "22222222-2222-4222-8222-222222222222",
};
function deps(
  overrides: Partial<LiveManagerDependencies["repository"]> = {},
): LiveManagerDependencies {
  return {
    authorize: vi.fn(async () => actor),
    invalidatePublicContent: vi.fn(),
    repository: {
      read: vi.fn(async () => ({ lives: [], celebrities: [], brands: [] })),
      save: vi.fn(async () => ({ id: "33333333-3333-4333-8333-333333333333" })),
      generateAttendanceCode: vi.fn(async () => ({ fanCode: "AB12CD", validFrom: "2026-09-02T10:00:00Z", validUntil: "2026-09-02T11:00:00Z" })),
      publication: vi.fn(async () => undefined),
      archive: vi.fn(async () => undefined),
      override: vi.fn(async () => "44444444-4444-4444-8444-444444444444"),
      previewStatus: vi.fn(async () => undefined),
      saveRewardSettings: vi.fn(async () => ({ revisionId: "66666666-6666-4666-8666-666666666666", revision: 2 })),
      publishRewardSettings: vi.fn(async () => ({ revisionId: "66666666-6666-4666-8666-666666666666", revision: 2 })),
      reschedule: vi.fn(async () => ({ revisionId: "77777777-7777-4777-8777-777777777777", revision: 3 })),
      saveJourneyRequirements: vi.fn(async () => ({ revisionId: "88888888-8888-4888-8888-888888888888", revision: 1 })),
      publishJourneyRequirements: vi.fn(async () => ({ revisionId: "88888888-8888-4888-8888-888888888888", revision: 2 })),
      ...overrides,
    },
  };
}

describe("ADM-005 live manager route", () => {
  it("allows viewer reads and returns only the repository projection", async () => {
    const d = deps();
    d.authorize = vi.fn(async () => ({ ...actor, role: "viewer" as const }));
    const response = await createGetLiveManagerHandler(d)(
      new Request("https://byus.test/api/admin/lives", {
        headers: { authorization: "Bearer secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      lives: [],
      celebrities: [],
      brands: [],
    });
  });
  it("rejects viewer mutations before calling a command", async () => {
    const d = deps();
    d.authorize = vi.fn(async () => ({ ...actor, role: "viewer" as const }));
    const response = await createPostLiveManagerHandler(d)(
      new Request("https://byus.test/api/admin/lives", {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "publish",
          id: "33333333-3333-4333-8333-333333333333",
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(d.repository.publication).not.toHaveBeenCalled();
  });

  it("saves bounded reward settings with an optimistic revision", async () => {
    const saveRewardSettings = vi.fn(async () => ({ revisionId: "66666666-6666-4666-8666-666666666666", revision: 2 }));
    const d = deps({ saveRewardSettings });
    const response = await createPostLiveManagerHandler(d)(new Request("https://byus.test/api/admin/lives", {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json", "x-correlation-id": "55555555-5555-4555-8555-555555555555" },
      body: JSON.stringify({ action: "save_reward_settings", liveEventId: "33333333-3333-4333-8333-333333333333", expectedRevision: 1, missionScore: 3, missionTicket: 2, journeyBonusTicket: 5 }),
    }));
    expect(response.status).toBe(200);
    expect(saveRewardSettings).toHaveBeenCalledWith(
      { appUserId: actor.appUserId, allowlistId: actor.allowlistId },
      "55555555-5555-4555-8555-555555555555",
      expect.objectContaining({ expectedRevision: 1, missionScore: 3, missionTicket: 2, journeyBonusTicket: 5 }),
    );
    expect(await response.json()).toEqual({ revisionId: "66666666-6666-4666-8666-666666666666", revision: 2 });
  });

  it("rejects reward values outside policy bounds", async () => {
    const d = deps();
    const response = await createPostLiveManagerHandler(d)(new Request("https://byus.test/api/admin/lives", {
      method: "POST", headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ action: "save_reward_settings", liveEventId: "33333333-3333-4333-8333-333333333333", expectedRevision: 0, missionScore: 4, missionTicket: 1, journeyBonusTicket: 3 }),
    }));
    expect(response.status).toBe(400);
    expect(d.repository.saveRewardSettings).not.toHaveBeenCalled();
  });

  it("publishes one immutable reward revision", async () => {
    const publishRewardSettings = vi.fn(async () => ({ revisionId: "66666666-6666-4666-8666-666666666666", revision: 1 }));
    const d = deps({ publishRewardSettings });
    const response = await createPostLiveManagerHandler(d)(new Request("https://byus.test/api/admin/lives", {
      method: "POST", headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ action: "publish_reward_settings", liveEventId: "33333333-3333-4333-8333-333333333333", expectedRevision: 1 }),
    }));
    expect(response.status).toBe(200);
    expect(publishRewardSettings).toHaveBeenCalledOnce();
  });

  it("maps a stale reward revision to a conflict", async () => {
    const d = deps({
      saveRewardSettings: vi.fn(async () => {
        throw new Error("stale reward settings revision");
      }),
    });
    const response = await createPostLiveManagerHandler(d)(new Request("https://byus.test/api/admin/lives", {
      method: "POST", headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ action: "save_reward_settings", liveEventId: "33333333-3333-4333-8333-333333333333", expectedRevision: 1, missionScore: 1, missionTicket: 1, journeyBonusTicket: 3 }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "LIVE_COMMAND_REJECTED" } });
  });

  it("saves strict non-empty Journey requirements with optimistic revision", async () => {
    const saveJourneyRequirements = vi.fn(async () => ({ revisionId: "77777777-7777-4777-8777-777777777777", revision: 2 }));
    const d = deps({ saveJourneyRequirements } as never);
    const payload = {
      action: "save_journey_requirements",
      liveEventId: "33333333-3333-4333-8333-333333333333",
      expectedRevision: 1,
      requirePassport: true,
      requireReservation: false,
      requireAttendance: true,
      bonusTicketAmount: 3,
      missions: [{ missionId: "88888888-8888-4888-8888-888888888888", version: 2 }],
    };
    const response = await createPostLiveManagerHandler(d)(new Request("https://byus.test/api/admin/lives", {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json", "x-correlation-id": "55555555-5555-4555-8555-555555555555" },
      body: JSON.stringify(payload),
    }));
    expect(response.status).toBe(200);
    expect(saveJourneyRequirements).toHaveBeenCalledWith(
      { appUserId: actor.appUserId, allowlistId: actor.allowlistId },
      "55555555-5555-4555-8555-555555555555",
      expect.objectContaining(payload),
    );
  });

  it.each([
    ["empty requirements", { requirePassport: false, requireReservation: false, requireAttendance: false, missions: [] }],
    ["unversioned Mission", { missions: [{ missionId: "88888888-8888-4888-8888-888888888888", version: 0 }] }],
    ["duplicate Mission identity", { missions: [{ missionId: "88888888-8888-4888-8888-888888888888", version: 1 }, { missionId: "88888888-8888-4888-8888-888888888888", version: 2 }] }],
    ["content mutation", { titleKo: "must not pass" }],
  ])("rejects Journey %s before the repository boundary", async (_case, override) => {
    const saveJourneyRequirements = vi.fn();
    const d = deps({ saveJourneyRequirements } as never);
    const response = await createPostLiveManagerHandler(d)(new Request("https://byus.test/api/admin/lives", {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({
        action: "save_journey_requirements",
        liveEventId: "33333333-3333-4333-8333-333333333333",
        expectedRevision: 1,
        requirePassport: true,
        requireReservation: false,
        requireAttendance: false,
        bonusTicketAmount: 3,
        missions: [],
        ...override,
      }),
    }));
    expect(response.status).toBe(400);
    expect(saveJourneyRequirements).not.toHaveBeenCalled();
  });

  it("publishes one Journey requirement revision", async () => {
    const publishJourneyRequirements = vi.fn(async () => ({ revisionId: "77777777-7777-4777-8777-777777777777", revision: 2 }));
    const d = deps({ publishJourneyRequirements } as never);
    const response = await createPostLiveManagerHandler(d)(new Request("https://byus.test/api/admin/lives", {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ action: "publish_journey_requirements", liveEventId: "33333333-3333-4333-8333-333333333333", expectedRevision: 2 }),
    }));
    expect(response.status).toBe(200);
    expect(publishJourneyRequirements).toHaveBeenCalledOnce();
  });

  it("publishes a validated Preview through the audited repository command", async () => {
    const previewStatus = vi.fn(async () => undefined);
    const d = deps({ previewStatus });
    const response = await createPostLiveManagerHandler(d)(
      new Request("https://byus.test/api/admin/lives", {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
          "x-correlation-id": "55555555-5555-4555-8555-555555555555",
        },
        body: JSON.stringify({
          action: "preview_publish",
          id: "33333333-3333-4333-8333-333333333333",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(previewStatus).toHaveBeenCalledWith(
      {
        appUserId: actor.appUserId,
        allowlistId: actor.allowlistId,
      },
      "55555555-5555-4555-8555-555555555555",
      "33333333-3333-4333-8333-333333333333",
      "publish",
      undefined,
    );
    expect(d.invalidatePublicContent).toHaveBeenCalled();
  });
  it("passes a trusted correlation and actor to publication", async () => {
    const d = deps();
    const correlation = "55555555-5555-4555-8555-555555555555";
    const response = await createPostLiveManagerHandler(d)(
      new Request("https://byus.test/api/admin/lives", {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
          "x-correlation-id": correlation,
        },
        body: JSON.stringify({
          action: "publish",
          id: "33333333-3333-4333-8333-333333333333",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(d.repository.publication).toHaveBeenCalledWith(
      { appUserId: actor.appUserId, allowlistId: actor.allowlistId },
      correlation,
      "33333333-3333-4333-8333-333333333333",
      true,
    );
    expect(d.invalidatePublicContent).toHaveBeenCalledOnce();
  });
  it("rejects a provider URL mismatch", async () => {
    const d = deps();
    const response = await createPostLiveManagerHandler(d)(
      new Request("https://byus.test/api/admin/lives", {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "save",
          slug: "test",
          celebrityId: actor.appUserId,
          brandId: actor.allowlistId,
          startsAt: "2026-07-21T10:00:00Z",
          endsAt: "2026-07-21T11:00:00Z",
          reservationOpensAt: "2026-07-21T08:00:00Z",
          reservationClosesAt: "2026-07-21T09:00:00Z",
          liveProvider: "tiktok",
          externalLiveUrl: "https://www.youtube.com/watch?v=abc123",
          heroUrl: "/hero.jpg",
          fanCode: "1234",
          titleKo: "제목",
          summaryKo: "요약",
          heroAltKo: "이미지",
          titleEn: "Title",
          summaryEn: "Summary",
          heroAltEn: "Image",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(d.repository.save).not.toHaveBeenCalled();
  });
  it("rejects invalid reservation ordering with a valid provider URL", async () => {
    const d = deps();
    const response = await createPostLiveManagerHandler(d)(
      new Request("https://byus.test/api/admin/lives", {
        method: "POST",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify({
          action: "save",
          slug: "test",
          celebrityId: actor.appUserId,
          brandId: actor.allowlistId,
          startsAt: "2026-07-21T10:00:00Z",
          endsAt: "2026-07-21T11:00:00Z",
          reservationOpensAt: "2026-07-21T09:30:00Z",
          reservationClosesAt: "2026-07-21T09:00:00Z",
          liveProvider: "youtube",
          externalLiveUrl: "https://www.youtube.com/watch?v=abc123",
          heroUrl: "/hero.jpg",
          titleKo: "제목",
          summaryKo: "요약",
          heroAltKo: "이미지",
          titleEn: "Title",
          summaryEn: "Summary",
          heroAltEn: "Image",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(d.repository.save).not.toHaveBeenCalled();
  });

  it.each([
    ["youtube", "https://www.youtube.com/watch?v=abc123"],
    ["instagram", "https://www.instagram.com/example/live/"],
    ["tiktok", "https://www.tiktok.com/@artist/live"],
  ])("accepts a validated %s LIVE provider target", async (liveProvider, externalLiveUrl) => {
    const save = vi.fn(async () => ({ id: "33333333-3333-4333-8333-333333333333" }));
    const d = deps({ save });
    const response = await createPostLiveManagerHandler(d)(
      new Request("https://byus.test/api/admin/lives", {
        method: "POST",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify({
          action: "save",
          slug: "test",
          celebrityId: actor.appUserId,
          brandId: actor.allowlistId,
          startsAt: "2026-07-21T10:00:00Z",
          endsAt: "2026-07-21T11:00:00Z",
          reservationOpensAt: "2026-07-21T08:00:00Z",
          reservationClosesAt: "2026-07-21T09:00:00Z",
          liveProvider,
          externalLiveUrl,
          heroUrl: "/hero.jpg",
          titleKo: "제목",
          summaryKo: "요약",
          heroAltKo: "이미지",
          titleEn: "Title",
          summaryEn: "Summary",
          heroAltEn: "Image",
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(save).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({ liveProvider, externalLiveUrl }),
    );
  });

  it("canonicalizes an accepted external URL before persistence", async () => {
    const save = vi.fn(async () => ({ id: "33333333-3333-4333-8333-333333333333" }));
    const d = deps({ save });
    const response = await createPostLiveManagerHandler(d)(
      new Request("https://byus.test/api/admin/lives", {
        method: "POST",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify({
          action: "save",
          slug: "test",
          celebrityId: actor.appUserId,
          brandId: actor.allowlistId,
          startsAt: "2026-07-21T10:00:00Z",
          endsAt: "2026-07-21T11:00:00Z",
          reservationOpensAt: "2026-07-21T08:00:00Z",
          reservationClosesAt: "2026-07-21T09:00:00Z",
          liveProvider: "instagram",
          externalLiveUrl: "HTTPS://WWW.INSTAGRAM.COM/example/live",
          heroUrl: "/hero.jpg",
          titleKo: "제목",
          summaryKo: "요약",
          heroAltKo: "이미지",
          titleEn: "Title",
          summaryEn: "Summary",
          heroAltEn: "Image",
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(save).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({
        externalLiveUrl: "https://www.instagram.com/example/live",
      }),
    );
  });
  it("invalidates public content after an effective-status override succeeds", async () => {
    const d = deps();
    const response = await createPostLiveManagerHandler(d)(
      new Request("https://byus.test/api/admin/lives", {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "override",
          id: "33333333-3333-4333-8333-333333333333",
          status: "live",
          effectiveFrom: "2026-07-21T10:00:00Z",
          effectiveUntil: "2026-07-21T11:00:00Z",
          reason: "Operator started the live event",
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(d.invalidatePublicContent).toHaveBeenCalledOnce();
  });

  it("passes an audited optimistic schedule revision with trusted actor and correlation", async () => {
    const reschedule = vi.fn(async () => ({
      revisionId: "77777777-7777-4777-8777-777777777777",
      revision: 3,
    }));
    const d = deps({ reschedule });
    const correlationId = "55555555-5555-4555-8555-555555555555";
    const payload = {
      action: "reschedule",
      liveEventId: "33333333-3333-4333-8333-333333333333",
      expectedRevision: 2,
      reason: "Artist travel requires a later broadcast window",
      reservationOpensAt: "2026-09-09T01:00:00.000Z",
      reservationClosesAt: "2026-09-10T09:00:00.000Z",
      startsAt: "2026-09-10T10:00:00.000Z",
      endsAt: "2026-09-10T11:00:00.000Z",
      attendanceValidFrom: "2026-09-10T09:55:00.000Z",
      attendanceValidUntil: "2026-09-10T11:05:00.000Z",
    };
    const response = await createPostLiveManagerHandler(d)(new Request("https://byus.test/api/admin/lives", {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json", "x-correlation-id": correlationId },
      body: JSON.stringify(payload),
    }));

    expect(response.status).toBe(200);
    expect(reschedule).toHaveBeenCalledWith(
      { appUserId: actor.appUserId, allowlistId: actor.allowlistId },
      correlationId,
      expect.objectContaining({ ...payload, action: "reschedule" }),
    );
    expect(d.invalidatePublicContent).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({ revisionId: "77777777-7777-4777-8777-777777777777", revision: 3 });
  });

  it.each([
    ["missing expected revision", { expectedRevision: undefined }],
    ["zero expected revision", { expectedRevision: 0 }],
    ["blank reason", { reason: "   " }],
    ["invalid LIVE window", { endsAt: "2026-09-10T10:00:00.000Z" }],
    ["invalid attendance window", { attendanceValidUntil: "2026-09-10T09:55:00.000Z" }],
  ])("rejects a reschedule with %s before the repository boundary", async (_case, override) => {
    const d = deps();
    const body = {
      action: "reschedule",
      liveEventId: "33333333-3333-4333-8333-333333333333",
      expectedRevision: 2,
      reason: "Artist travel requires a later broadcast window",
      reservationOpensAt: "2026-09-09T01:00:00.000Z",
      reservationClosesAt: "2026-09-10T09:00:00.000Z",
      startsAt: "2026-09-10T10:00:00.000Z",
      endsAt: "2026-09-10T11:00:00.000Z",
      attendanceValidFrom: "2026-09-10T09:55:00.000Z",
      attendanceValidUntil: "2026-09-10T11:05:00.000Z",
      ...override,
    };
    const response = await createPostLiveManagerHandler(d)(new Request("https://byus.test/api/admin/lives", {
      method: "POST", headers: { authorization: "Bearer secret", "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(400);
    expect(d.repository.reschedule).not.toHaveBeenCalled();
  });

  it.each(["stale schedule revision", "LIVE has started", "LIVE has ended", "LIVE is cancelled", "LIVE is archived", "attendance history exists", "incompatible status override"])(
    "maps repository rejection '%s' to a conflict",
    async (message) => {
      const d = deps({ reschedule: vi.fn(async () => { throw new Error(message); }) });
      const response = await createPostLiveManagerHandler(d)(new Request("https://byus.test/api/admin/lives", {
        method: "POST", headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify({
          action: "reschedule", liveEventId: "33333333-3333-4333-8333-333333333333", expectedRevision: 2,
          reason: "Artist travel requires a later broadcast window", reservationOpensAt: "2026-09-09T01:00:00.000Z",
          reservationClosesAt: "2026-09-10T09:00:00.000Z", startsAt: "2026-09-10T10:00:00.000Z",
          endsAt: "2026-09-10T11:00:00.000Z", attendanceValidFrom: "2026-09-10T09:55:00.000Z",
          attendanceValidUntil: "2026-09-10T11:05:00.000Z",
        }),
      }));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { code: "LIVE_COMMAND_REJECTED" } });
    },
  );
});
