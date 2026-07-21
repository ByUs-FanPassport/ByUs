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
      save: vi.fn(async () => "33333333-3333-4333-8333-333333333333"),
      publication: vi.fn(async () => undefined),
      archive: vi.fn(async () => undefined),
      override: vi.fn(async () => "44444444-4444-4444-8444-444444444444"),
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
  it("rejects a non-YouTube URL and invalid reservation ordering", async () => {
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
          reservationOpensAt: "2026-07-21T09:30:00Z",
          reservationClosesAt: "2026-07-21T09:00:00Z",
          youtubeUrl: "https://example.com/watch",
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
});
