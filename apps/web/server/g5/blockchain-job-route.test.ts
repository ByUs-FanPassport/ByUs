import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AuthError } from "../../features/auth/domain/auth-errors";
import { BlockchainJobRepositoryError } from "./blockchain-job-repository";
import { createGetBlockchainJobsHandler, createRetryBlockchainJobHandler } from "./blockchain-job-route";

const ids = {
  job: "33333333-3333-4333-8333-333333333333",
  user: "11111111-1111-4111-8111-111111111111",
  allow: "22222222-2222-4222-8222-222222222222",
  correlation: "55555555-5555-4555-8555-555555555555",
};
const session = { email: "ops@byus.example", role: "operator" as const, appUserId: ids.user, allowlistId: ids.allow };

describe("blockchain job admin routes", () => {
  it("allows viewer reads and returns private no-store responses", async () => {
    const repository = { list: vi.fn().mockResolvedValue([]), retry: vi.fn() };
    const handler = createGetBlockchainJobsHandler({ repository, authorize: vi.fn().mockResolvedValue({ ...session, role: "viewer" }) });
    const response = await handler(new Request("https://byus.example/api/admin/blockchain-jobs?status=FAILED&limit=25", { headers: { authorization: "Bearer token" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ jobs: [] });
  });

  it("blocks viewers before retry reaches the repository", async () => {
    const repository = { list: vi.fn(), retry: vi.fn() };
    const handler = createRetryBlockchainJobHandler({ repository, authorize: vi.fn().mockResolvedValue({ ...session, role: "viewer" }) });
    const response = await handler(new Request(`https://byus.example/api/admin/blockchain-jobs/${ids.job}/retry`, { method: "POST" }), { jobId: ids.job });
    expect(response.status).toBe(403);
    expect(repository.retry).not.toHaveBeenCalled();
  });

  it("passes a trusted correlation and immutable actor identifiers to retry", async () => {
    const repository = { list: vi.fn(), retry: vi.fn().mockResolvedValue({ id: ids.job, status: "RETRYING", attempts: 8, maxAttempts: 9, nextAttemptAt: "now", chainState: "not_submitted" }) };
    const handler = createRetryBlockchainJobHandler({ repository, authorize: vi.fn().mockResolvedValue(session) });
    const response = await handler(new Request(`https://byus.example/api/admin/blockchain-jobs/${ids.job}/retry`, { method: "POST", headers: { authorization: "Bearer token", "x-correlation-id": ids.correlation } }), { jobId: ids.job });
    expect(response.status).toBe(202);
    expect(repository.retry).toHaveBeenCalledWith({ actor: { appUserId: ids.user, allowlistId: ids.allow }, jobId: ids.job, correlationId: ids.correlation });
  });

  it("maps auth and retry conflicts to stable redacted errors", async () => {
    const unauthorized = createGetBlockchainJobsHandler({ repository: { list: vi.fn(), retry: vi.fn() }, authorize: vi.fn().mockRejectedValue(new AuthError("AUTHENTICATION_REQUIRED", 401, "token leaked")) });
    const authResponse = await unauthorized(new Request("https://byus.example/api/admin/blockchain-jobs"));
    expect(authResponse.status).toBe(401);
    expect(await authResponse.json()).toEqual({ error: { code: "UNAUTHENTICATED" } });

    const conflict = createRetryBlockchainJobHandler({ repository: { list: vi.fn(), retry: vi.fn().mockRejectedValue(new BlockchainJobRepositoryError("NOT_RETRYABLE")) }, authorize: vi.fn().mockResolvedValue(session) });
    const conflictResponse = await conflict(new Request("https://byus.example/retry", { method: "POST" }), { jobId: ids.job });
    expect(conflictResponse.status).toBe(409);
    expect(await conflictResponse.json()).toEqual({ error: { code: "BLOCKCHAIN_JOB_NOT_RETRYABLE" } });
  });
});
