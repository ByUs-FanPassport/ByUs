import "server-only";

import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import {
  hasDuplicateJourneyMissionIds,
  journeyMissionRequirementSelectionSchema,
} from "../../features/journey/domain/journey";
import { REWARD_POLICY_V2 } from "../../features/rewards/domain/reward-policy";
import {
  externalLiveProviderSchema,
  parseExternalLiveUrl,
} from "../../features/live/domain/live-event";
import {
  isLiveWindowOrdered,
  liveScheduleRevisionSchema,
} from "../../features/live/domain/live-schedule";
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
    liveProvider: externalLiveProviderSchema,
    externalLiveUrl: z.string().url(),
    heroUrl: z.string().min(2).max(2000),
    titleKo: z.string().trim().min(1).max(160),
    summaryKo: z.string().trim().min(1).max(1200),
    heroAltKo: z.string().trim().min(1).max(300),
    titleEn: z.string().trim().min(1).max(160),
    summaryEn: z.string().trim().min(1).max(1200),
    heroAltEn: z.string().trim().min(1).max(300),
  })
  .superRefine((value, ctx) => {
    if (!isLiveWindowOrdered(value))
      ctx.addIssue({
        code: "custom",
        path: ["startsAt"],
        message: "INVALID_SCHEDULE",
      });
    try {
      parseExternalLiveUrl(value.liveProvider, value.externalLiveUrl);
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["externalLiveUrl"],
        message: "INVALID_EXTERNAL_LIVE_URL",
      });
    }
  });
const reschedule = liveScheduleRevisionSchema.safeExtend({
  action: z.literal("reschedule"),
});
const saveJourneyRequirements = z.object({
  action: z.literal("save_journey_requirements"),
  liveEventId: uuid,
  expectedRevision: z.number().int().min(0),
  requirePassport: z.boolean(),
  requireReservation: z.boolean(),
  requireAttendance: z.boolean(),
  bonusTicketAmount: z.number().int().min(REWARD_POLICY_V2.journey.minimumCompletionTicket).max(REWARD_POLICY_V2.journey.maximumCompletionTicket),
  missions: z.array(journeyMissionRequirementSelectionSchema).max(100),
}).strict().superRefine((value, ctx) => {
  if (!(value.requirePassport || value.requireReservation || value.requireAttendance || value.missions.length > 0)) {
    ctx.addIssue({ code: "custom", path: ["missions"], message: "EMPTY_JOURNEY_REQUIREMENTS" });
  }
  if (hasDuplicateJourneyMissionIds(value.missions)) {
    ctx.addIssue({ code: "custom", path: ["missions"], message: "DUPLICATE_JOURNEY_MISSION" });
  }
});
const publishJourneyRequirements = z.object({
  action: z.literal("publish_journey_requirements"),
  liveEventId: uuid,
  expectedRevision: z.number().int().positive(),
}).strict();
const command = z.discriminatedUnion("action", [
  save,
  reschedule,
  saveJourneyRequirements,
  publishJourneyRequirements,
  z.object({
    action: z.literal("save_reward_settings"),
    liveEventId: uuid,
    expectedRevision: z.number().int().min(0),
    missionScore: z.number().int().min(REWARD_POLICY_V2.mission.minimumScore).max(REWARD_POLICY_V2.mission.maximumScore),
    missionTicket: z.number().int().min(REWARD_POLICY_V2.mission.minimumTicket).max(REWARD_POLICY_V2.mission.maximumTicket),
    journeyBonusTicket: z.number().int().min(REWARD_POLICY_V2.journey.minimumCompletionTicket).max(REWARD_POLICY_V2.journey.maximumCompletionTicket),
  }),
  z.object({
    action: z.literal("publish_reward_settings"),
    liveEventId: uuid,
    expectedRevision: z.number().int().positive(),
  }),
  z.object({ action: z.enum(["publish", "unpublish"]), id: uuid }),
  z.object({
    action: z.literal("generate_attendance_code"),
    liveEventId: uuid,
    validFrom: instant,
    validUntil: instant,
  }).refine((value) => Date.parse(value.validFrom) < Date.parse(value.validUntil), { message: "INVALID_WINDOW" }),
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
  z.object({
    action: z.enum([
      "preview_publish",
      "preview_unpublish",
      "preview_archive",
    ]),
    id: uuid,
    reason: z.string().trim().min(10).max(1000).optional(),
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
      if (parsed.action === "save") {
        const saved = await deps.repository.save(actor, correlationId, {
          ...parsed,
          externalLiveUrl: parseExternalLiveUrl(
            parsed.liveProvider,
            parsed.externalLiveUrl,
          ),
        });
        return json(saved, parsed.id ? 200 : 201);
      }
      if (parsed.action === "generate_attendance_code")
        return json(await deps.repository.generateAttendanceCode(actor, correlationId, parsed), 200);
      if (parsed.action === "save_reward_settings")
        return json(await deps.repository.saveRewardSettings(actor, correlationId, parsed), 200);
      if (parsed.action === "publish_reward_settings")
        return json(await deps.repository.publishRewardSettings(actor, correlationId, parsed), 200);
      if (parsed.action === "save_journey_requirements")
        return json(await deps.repository.saveJourneyRequirements(actor, correlationId, parsed), 200);
      if (parsed.action === "publish_journey_requirements") {
        const revision = await deps.repository.publishJourneyRequirements(actor, correlationId, parsed);
        deps.invalidatePublicContent();
        return json(revision, 200);
      }
      if (parsed.action === "reschedule") {
        const revision = await deps.repository.reschedule(
          actor,
          correlationId,
          parsed,
        );
        deps.invalidatePublicContent();
        return json(revision, 200);
      }
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
      } else if (parsed.action === "override") {
        const overrideId = await deps.repository.override(
          actor,
          correlationId,
          parsed.id,
          parsed,
        );
        deps.invalidatePublicContent();
        return json({ overrideId }, 201);
      } else {
        if (!parsed.action.startsWith("preview_")) {
          throw new Error("unsupported preview command");
        }
        const previewAction = parsed.action.replace(
          "preview_",
          "",
        ) as "publish" | "unpublish" | "archive";
        const reason = "reason" in parsed ? parsed.reason : undefined;
        if (previewAction === "archive" && !reason) {
          return json({ error: { code: "INVALID_REQUEST" } }, 400);
        }
        await deps.repository.previewStatus(
          actor,
          correlationId,
          parsed.id,
          previewAction,
          reason,
        );
        deps.invalidatePublicContent();
      }
      return json({ ok: true }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const conflict =
        /not found|immutable|transition|overlap|published|requires|draft|stale|started|ended|cancelled|archived|attendance history|status override|effectively scheduled|unchanged/i.test(
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
