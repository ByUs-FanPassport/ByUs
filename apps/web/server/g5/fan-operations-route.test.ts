import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { AuthError } from "../../features/auth/domain/auth-errors";
import { FanOperationsRepositoryError } from "./fan-operations-repository";
import {
  createAdjustFanScoreHandler,
  createGetFanDetailHandler,
  createGetFansHandler,
} from "./fan-operations-route";

const fanId = "11111111-1111-4111-8111-111111111111";
const celebrityId = "22222222-2222-4222-8222-222222222222";
const admin = {
  appUserId: fanId,
  allowlistId: celebrityId,
  role: "operator" as const,
  email: "admin@example.com",
};
const authorize = vi.fn().mockResolvedValue(admin);

describe("Fan Operations HTTP boundary", () => {
  it("authorizes and validates list filters", async () => {
    const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const run = createGetFansHandler({
      authorize,
      repository: { list, detail: vi.fn(), adjust: vi.fn() },
    });
    const response = await run(
      new Request(
        "https://byus.test/api/admin/fans?q=Kamilia&status=active&limit=20",
        { headers: { authorization: "Bearer token" } },
      ),
    );
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "Kamilia",
        accountStatus: "active",
        limit: 20,
      }),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns fan detail without accepting identity from the body", async () => {
    const detail = vi
      .fn()
      .mockResolvedValue({
        fanId,
        nickname: null,
        accountStatus: "disabled",
        createdAt: "2026-07-21T00:00:00Z",
        wallets: [],
        passports: [],
      });
    const run = createGetFanDetailHandler({
      authorize,
      repository: { list: vi.fn(), detail, adjust: vi.fn() },
    });
    expect(
      (
        await run(
          new Request("https://byus.test/api/admin/fans/x?lang=en", {
            headers: { authorization: "Bearer token" },
          }),
          { fanId },
        )
      ).status,
    ).toBe(200);
  });

  it("allows Admin/Operator correction with strict body and blocks Viewer", async () => {
    const adjust = vi
      .fn()
      .mockResolvedValue({
        adjustmentId: fanId,
        points: 1,
        resultingScore: 6,
        createdAt: "2026-07-21T00:00:00Z",
      });
    const body = JSON.stringify({
      celebrityId,
      points: 1,
      reason: "Verified missing attendance",
      idempotencyKey: fanId,
    });
    const request = new Request(
      "https://byus.test/api/admin/fans/x/score-adjustments",
      {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "x-correlation-id": fanId,
        },
        body,
      },
    );
    const run = createAdjustFanScoreHandler({
      authorize,
      repository: { list: vi.fn(), detail: vi.fn(), adjust },
    });
    expect((await run(request, { fanId })).status).toBe(200);
    expect(adjust).toHaveBeenCalledWith(
      expect.objectContaining({ points: 1, fanId }),
    );

    const viewer = createAdjustFanScoreHandler({
      authorize: vi.fn().mockResolvedValue({ ...admin, role: "viewer" }),
      repository: { list: vi.fn(), detail: vi.fn(), adjust },
    });
    const denied = await viewer(
      new Request("https://byus.test/api/admin/fans/x/score-adjustments", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body,
      }),
      { fanId },
    );
    expect(denied.status).toBe(403);
  });

  it("maps auth and correction failures without database details", async () => {
    const unauth = createGetFansHandler({
      authorize: vi
        .fn()
        .mockRejectedValue(
          new AuthError("AUTHENTICATION_REQUIRED", 401, "secret"),
        ),
      repository: { list: vi.fn(), detail: vi.fn(), adjust: vi.fn() },
    });
    expect(
      (await unauth(new Request("https://byus.test/api/admin/fans"))).status,
    ).toBe(401);
    const adjust = createAdjustFanScoreHandler({
      authorize,
      repository: {
        list: vi.fn(),
        detail: vi.fn(),
        adjust: vi
          .fn()
          .mockRejectedValue(
            new FanOperationsRepositoryError("NEGATIVE_SCORE"),
          ),
      },
    });
    const response = await adjust(
      new Request("https://byus.test/api/admin/fans/x/score-adjustments", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          celebrityId,
          points: -10,
          reason: "Verified duplicate activity",
          idempotencyKey: fanId,
        }),
      }),
      { fanId },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "NEGATIVE_SCORE" },
    });

    const bounded = createAdjustFanScoreHandler({
      authorize,
      repository: {
        list: vi.fn(),
        detail: vi.fn(),
        adjust: vi
          .fn()
          .mockRejectedValue(new FanOperationsRepositoryError("SCORE_LIMIT")),
      },
    });
    const boundedResponse = await bounded(
      new Request("https://byus.test/api/admin/fans/x/score-adjustments", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          celebrityId,
          points: 10,
          reason: "Verified missing activity",
          idempotencyKey: fanId,
        }),
      }),
      { fanId },
    );
    expect(boundedResponse.status).toBe(409);
    expect(await boundedResponse.json()).toEqual({
      error: { code: "SCORE_LIMIT" },
    });
  });
});
