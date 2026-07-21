import "server-only";

import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "../admin/admin-session-gate";
import type { LiveManagerRepository } from "./live-manager-repository";
import { adminCorrelationId } from "./blockchain-job-route";

export type LiveManagerDependencies = {
  authorize(input: {
    authorization: string;
    correlationId: string;
  }): Promise<AdminSession>;
  repository: LiveManagerRepository;
  invalidatePublicContent(): void;
};

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const save = z
  .object({
    action: z.literal("save"),
    id: uuid.nullable().optional(),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    celebrityId: uuid,
    brandId: uuid,
    startsAt: instant,
    endsAt: instant,
    reservationOpensAt: instant,
    reservationClosesAt: instant,
    youtubeUrl: z
      .string()
      .url()
      .regex(
        /^https:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?|live\/|embed\/)|youtu\.be\/)/,
      ),
    heroUrl: z.string().min(2).max(2000),
    fanCode: z.string().min(4).max(72).optional().default(""),
    titleKo: z.string().trim().min(1).max(160),
    summaryKo: z.string().trim().min(1).max(1200),
    heroAltKo: z.string().trim().min(1).max(300),
    titleEn: z.string().trim().min(1).max(160),
    summaryEn: z.string().trim().min(1).max(1200),
    heroAltEn: z.string().trim().min(1).max(300),
  })
  .superRefine((value, ctx) => {
    const open = Date.parse(value.reservationOpensAt),
      close = Date.parse(value.reservationClosesAt),
      start = Date.parse(value.startsAt),
      end = Date.parse(value.endsAt);
    if (!(open < close && close <= start && start < end))
      ctx.addIssue({
        code: "custom",
        path: ["startsAt"],
        message: "INVALID_SCHEDULE",
      });
    if (!value.id && !value.fanCode)
      ctx.addIssue({
        code: "custom",
        path: ["fanCode"],
        message: "FAN_CODE_REQUIRED",
      });
  });
const command = z.discriminatedUnion("action", [
  save,
  z.object({ action: z.enum(["publish", "unpublish"]), id: uuid }),
  z.object({
    action: z.literal("archive"),
    id: uuid,
    reason: z.string().trim().min(10).max(1000),
  }),
  z.object({
    action: z.literal("override"),
    id: uuid,
    status: z.enum(["scheduled", "live", "ended", "cancelled"]),
    effectiveFrom: instant,
    effectiveUntil: z.union([instant, z.literal("")]).optional(),
    reason: z.string().trim().min(1).max(1000),
  }),
]);

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", vary: "Authorization" },
  });
}

async function authorize(
  request: Request,
  deps: LiveManagerDependencies,
  correlationId: string,
) {
  try {
    return await deps.authorize({
      authorization: request.headers.get("authorization") ?? "",
      correlationId,
    });
  } catch (error) {
    if (error instanceof AuthError)
      return json(
        {
          error: {
            code: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN",
          },
        },
        error.status === 401 ? 401 : 403,
      );
    return json({ error: { code: "LIVE_MANAGER_UNAVAILABLE" } }, 503);
  }
}

export function createGetLiveManagerHandler(deps: LiveManagerDependencies) {
  return async (request: Request) => {
    const correlationId = adminCorrelationId(request);
    const admin = await authorize(request, deps, correlationId);
    if (admin instanceof Response) return admin;
    try {
      return json(
        await deps.repository.read({
          appUserId: admin.appUserId,
          allowlistId: admin.allowlistId,
        }),
        200,
      );
    } catch {
      return json({ error: { code: "LIVE_MANAGER_UNAVAILABLE" } }, 503);
    }
  };
}

export function createPostLiveManagerHandler(deps: LiveManagerDependencies) {
  return async (request: Request) => {
    const correlationId = adminCorrelationId(request);
    const admin = await authorize(request, deps, correlationId);
    if (admin instanceof Response) return admin;
    if (admin.role === "viewer")
      return json({ error: { code: "FORBIDDEN" } }, 403);
    let parsed: z.infer<typeof command>;
    try {
      parsed = command.parse(await request.json());
    } catch {
      return json({ error: { code: "INVALID_REQUEST" } }, 400);
    }
    const actor = {
      appUserId: admin.appUserId,
      allowlistId: admin.allowlistId,
    };
    try {
      if (parsed.action === "save")
        return json(
          { id: await deps.repository.save(actor, correlationId, parsed) },
          parsed.id ? 200 : 201,
        );
      if (parsed.action === "publish" || parsed.action === "unpublish") {
        await deps.repository.publication(
          actor,
          correlationId,
          parsed.id,
          parsed.action === "publish",
        );
        deps.invalidatePublicContent();
      } else if (parsed.action === "archive") {
        await deps.repository.archive(
          actor,
          correlationId,
          parsed.id,
          parsed.reason,
        );
        deps.invalidatePublicContent();
      } else {
        const overrideId = await deps.repository.override(
          actor,
          correlationId,
          parsed.id,
          parsed,
        );
        deps.invalidatePublicContent();
        return json({ overrideId }, 201);
      }
      return json({ ok: true }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const conflict =
        /not found|immutable|transition|overlap|published|requires|draft/i.test(
          message,
        );
      return json(
        {
          error: {
            code: conflict
              ? "LIVE_COMMAND_REJECTED"
              : "LIVE_MANAGER_UNAVAILABLE",
          },
        },
        conflict ? 409 : 503,
      );
    }
  };
}
