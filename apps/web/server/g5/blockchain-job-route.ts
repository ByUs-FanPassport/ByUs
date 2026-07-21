import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "../admin/admin-session-gate";
import {
  BlockchainJobRepositoryError,
  type BlockchainJobRepository,
  type BlockchainJobStatus,
} from "./blockchain-job-repository";

export interface BlockchainJobRouteDependencies {
  repository: BlockchainJobRepository;
  authorize(input: { authorization: string; correlationId: string }): Promise<AdminSession>;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = new Set<BlockchainJobStatus>(["PENDING", "PROCESSING", "COMPLETED", "RETRYING", "FAILED"]);

export function adminCorrelationId(request: Request): string {
  const supplied = request.headers.get("x-correlation-id")?.trim();
  return supplied && uuidPattern.test(supplied) ? supplied : crypto.randomUUID();
}

function response(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store", vary: "Authorization" } });
}

async function authorize(request: Request, dependencies: BlockchainJobRouteDependencies, correlationId: string) {
  try {
    return await dependencies.authorize({
      authorization: request.headers.get("authorization") ?? "",
      correlationId,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return response({ error: { code: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" } }, error.status === 401 ? 401 : 403);
    }
    return response({ error: { code: "BLOCKCHAIN_JOBS_UNAVAILABLE" } }, 503);
  }
}

export function createGetBlockchainJobsHandler(dependencies: BlockchainJobRouteDependencies) {
  return async function GET(request: Request): Promise<Response> {
    const correlationId = adminCorrelationId(request);
    const admin = await authorize(request, dependencies, correlationId);
    if (admin instanceof Response) return admin;

    const params = new URL(request.url).searchParams;
    const jobId = params.get("jobId");
    const status = params.get("status");
    const before = params.get("before");
    const limit = Number(params.get("limit") ?? "50");
    if ((jobId !== null && !uuidPattern.test(jobId))
      || (status !== null && !statuses.has(status as BlockchainJobStatus))
      || (before !== null && Number.isNaN(Date.parse(before)))
      || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return response({ error: { code: "INVALID_REQUEST" } }, 400);
    }

    try {
      const jobs = await dependencies.repository.list({
        actor: { appUserId: admin.appUserId, allowlistId: admin.allowlistId },
        jobId,
        status: status as BlockchainJobStatus | null,
        limit,
        beforeCreatedAt: before,
      });
      if (jobId !== null) {
        return jobs[0]
          ? response({ job: jobs[0] }, 200)
          : response({ error: { code: "BLOCKCHAIN_JOB_NOT_FOUND" } }, 404);
      }
      return response({ jobs }, 200);
    } catch {
      return response({ error: { code: "BLOCKCHAIN_JOBS_UNAVAILABLE" } }, 503);
    }
  };
}

export function createRetryBlockchainJobHandler(dependencies: BlockchainJobRouteDependencies) {
  return async function POST(request: Request, input: { jobId: string }): Promise<Response> {
    const correlationId = adminCorrelationId(request);
    const admin = await authorize(request, dependencies, correlationId);
    if (admin instanceof Response) return admin;
    if (!uuidPattern.test(input.jobId)) return response({ error: { code: "BLOCKCHAIN_JOB_NOT_FOUND" } }, 404);
    if (admin.role === "viewer") return response({ error: { code: "FORBIDDEN" } }, 403);

    try {
      const job = await dependencies.repository.retry({
        actor: { appUserId: admin.appUserId, allowlistId: admin.allowlistId },
        jobId: input.jobId,
        correlationId,
      });
      return response({ job }, 202);
    } catch (error) {
      if (error instanceof BlockchainJobRepositoryError) {
        if (error.code === "NOT_FOUND") return response({ error: { code: "BLOCKCHAIN_JOB_NOT_FOUND" } }, 404);
        if (error.code === "NOT_RETRYABLE") return response({ error: { code: "BLOCKCHAIN_JOB_NOT_RETRYABLE" } }, 409);
        if (error.code === "FORBIDDEN") return response({ error: { code: "FORBIDDEN" } }, 403);
      }
      return response({ error: { code: "BLOCKCHAIN_JOBS_UNAVAILABLE" } }, 503);
    }
  };
}
