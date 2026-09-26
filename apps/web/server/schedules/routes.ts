import "server-only";
import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import { FanAuthUnavailableError } from "../fan-auth/fan-auth-gate";
import { boundedJson, CertificationBodyError } from "../certification/certification-http";
import { createFanpageDependencies } from "../fanpage/dependencies";
import type { FanpageDependencies } from "../fanpage/routes";
import { getLiveCalendarUtcBounds, liveCalendarMonthValueSchema } from "../../features/live/domain/live-calendar";
import * as s from "../../features/schedules/domain/participation";

export type ParticipationOperation = "schedules" | "schedule" | "subscription" | "suggestions" | "requests" | "request-check" | "live-submissions" | "live-submission"
  | "admin-schedules" | "admin-suggestions" | "admin-suggestion" | "admin-requests" | "admin-request" | "admin-live-submissions" | "admin-live-settings" | "admin-live-submission" | "admin-replay";
type Params = { id?: string; slug?: string };
const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const nullableReason = z.string().trim().min(1).max(1000).nullable();
const revision = z.number().int().nonnegative();

function failure(error: unknown): Response {
  if (error instanceof AuthError || error instanceof FanAuthUnavailableError) return json({ error: { code: error.code } }, error.status);
  if (error instanceof CertificationBodyError) return json({ error: { code: error.code } }, error.code === "BODY_TOO_LARGE" ? 413 : 422);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: { code: "FAN_WEB_INVALID_REQUEST" } }, 422);
  const message = error instanceof Error ? error.message : "";
  const code = message.match(/FAN_WEB_[A-Z_]+/)?.[0] ?? (/active admin required|viewer is read-only/.test(message) ? "FAN_WEB_ADMIN_REQUIRED" : "FAN_WEB_UNAVAILABLE");
  const status = code.includes("NOT_FOUND") ? 404 : code.includes("REQUIRED") ? 403 : code.includes("RATE_LIMIT") ? 429
    : /CONFLICT|CLOSED|ALREADY/.test(code) ? 409 : code.includes("INVALID") ? 422 : 503;
  return json({ error: { code } }, status);
}
function decodeCursor(value: string | null) {
  if (!value) return { at: null, id: null };
  if (value.length > 500 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new SyntaxError("Invalid cursor");
  return s.cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
}
function encodePage<T extends { nextCursor: z.infer<typeof s.cursorSchema> | null }>(value: T) {
  return { ...value, nextCursor: value.nextCursor ? Buffer.from(JSON.stringify(value.nextCursor)).toString("base64url") : null };
}

export function createParticipationHandler(deps: Pick<FanpageDependencies, "rpc" | "authorize" | "authorizeAdmin">) {
  return async function handle(operation: ParticipationOperation, request: Request, params: Params = {}): Promise<Response> {
    let parsingServerOutput = false;
    try {
      const url = new URL(request.url);
      const locale = s.contentLocale.parse(url.searchParams.get("locale") ?? "ko");
      const cursor = decodeCursor(url.searchParams.get("cursor"));
      const page = { p_before_at: cursor.at, p_before_id: cursor.id, p_limit: 20 };
      const authorization = request.headers.get("authorization");
      const correlationId = z.string().uuid().catch(crypto.randomUUID()).parse(request.headers.get("x-correlation-id"));
      const admin = operation.startsWith("admin-") ? await deps.authorizeAdmin(authorization, correlationId) : null;
      const publicRead = request.method === "GET" && ["schedules", "schedule", "live-submissions"].includes(operation) || operation === "request-check";
      const user = admin ? null : (!publicRead || authorization !== null) ? await deps.authorize(authorization) : null;
      if (admin && request.method !== "GET" && admin.role === "viewer") return json({ error: { code: "FAN_WEB_ADMIN_REQUIRED" } }, 403);
      const actor = admin ? { p_actor_app_user_id: admin.appUserId, p_actor_admin_allowlist_id: admin.allowlistId,
        p_correlation_id: correlationId } : {};
      const owner = { p_app_user_id: user?.appUserId ?? null };
      const body = request.method === "GET" || request.method === "DELETE" ? null : await boundedJson(request);
      const id = () => s.uuid.parse(params.id);
      const slug = () => s.creatorSlug.parse(params.slug);
      const rpc = async (name: string, args: Record<string, unknown>) => { const result = await deps.rpc(name, args); parsingServerOutput = true; return result; };
      const paged = async <T extends z.ZodType>(name: string, args: Record<string, unknown>, item: T) => encodePage(s.rpcPage(item).parse(await rpc(name, args)));
      switch (operation) {
        case "schedules": {
          const bounds = getLiveCalendarUtcBounds(liveCalendarMonthValueSchema.parse(url.searchParams.get("month")));
          const creator = url.searchParams.get("celebritySlug");
          return json(await paged("fan_web_list_schedules", { ...owner, p_locale: locale, p_starts_at: bounds.startsAt, p_ends_at: bounds.endsAt,
            p_celebrity_slug: creator === null ? null : s.creatorSlug.parse(creator), p_after_at: cursor.at, p_after_id: cursor.id, p_limit: 100 }, s.scheduleSchema));
        }
        case "schedule": {
          const item = await rpc("fan_web_get_schedule", { ...owner, p_schedule_id: id(), p_locale: locale });
          return item === null ? json({ error: { code: "FAN_WEB_NOT_FOUND" } }, 404) : json(s.scheduleSchema.parse(item));
        }
        case "subscription": {
          const input = z.object({ subscribed: z.boolean() }).strict().parse(body);
          return json(z.object({ scheduleId: s.uuid, subscribed: z.boolean() }).strict().parse(await rpc("fan_web_set_schedule_subscription", { ...owner, p_schedule_id: id(), p_subscribed: input.subscribed })));
        }
        case "suggestions": return request.method === "GET"
          ? json(await paged("fan_web_list_owned_schedule_suggestions", { ...owner, ...page }, s.suggestionSchema))
          : json(s.mutationSchema(s.suggestionSchema).parse(await rpc("fan_web_submit_schedule_suggestion", { ...owner, p_payload: s.scheduleInputSchema.parse(body) })), 201);
        case "requests": return request.method === "GET"
          ? json(await paged("fan_web_list_owned_fanpage_requests", { ...owner, p_locale: locale, ...page }, s.fanpageRequestSchema))
          : json(s.mutationSchema(s.fanpageRequestSchema).parse(await rpc("fan_web_submit_fanpage_request", { ...owner, p_payload: s.fanpageInputSchema.parse(body) })), 201);
        case "request-check": {
          const input = s.fanpageCheckSchema.parse(body);
          return json(z.object({ artists: z.array(s.artistLinkSchema).max(5) }).strict().parse(await rpc("fan_web_check_fanpage_request", { p_name: input.name, p_official_social_url: input.officialSocialUrl, p_locale: input.locale })));
        }
        case "live-submissions": {
          if (request.method === "GET") {
            const result = s.rpcPage(s.liveSubmissionSchema).extend({ settings: s.liveSubmissionSettingsSchema, access: z.enum(["public", "member", "members_required"]), mine: z.array(s.ownedLiveSubmissionSchema).max(2) })
              .parse(await rpc("fan_web_list_live_submissions", { ...owner, p_live_slug: slug(), p_locale: locale, ...page }));
            return json(encodePage(result));
          }
          const input = s.liveSubmissionInputSchema.parse(body);
          return json(s.mutationSchema(s.ownedLiveSubmissionSchema).parse(await rpc("fan_web_submit_live_submission", { ...owner, p_live_slug: slug(), p_kind: input.kind, p_body: input.body, p_idempotency_key: input.idempotencyKey })), 201);
        }
        case "live-submission": return json(z.object({ id: s.uuid, deleted: z.literal(true), replayed: z.boolean() }).strict().parse(await rpc("fan_web_delete_live_submission", { ...owner, p_submission_id: id() })));
        case "admin-schedules": {
          if (request.method === "GET") return json(await paged("fan_web_admin_list_schedules", { ...actor, p_status: z.enum(["draft", "published", "cancelled"]).nullable().parse(url.searchParams.get("status")), ...page }, s.adminScheduleSchema));
          const input = z.object({ id: s.uuid.nullable(), expectedRevision: revision, idempotencyKey: s.uuid, payload: s.scheduleWriteSchema }).strict().parse(body);
          return json(s.mutationSchema(s.adminScheduleSchema).parse(await rpc("fan_web_admin_save_schedule", { ...actor, p_schedule_id: input.id, p_expected_revision: input.expectedRevision, p_idempotency_key: input.idempotencyKey, p_payload: input.payload })));
        }
        case "admin-suggestions": return json(await paged("fan_web_admin_list_schedule_suggestions", { ...actor, p_status: s.reviewStatus.nullable().parse(url.searchParams.get("status")), ...page }, s.suggestionSchema));
        case "admin-suggestion": {
          const input = z.object({ expectedRevision: revision, decision: z.enum(["approve", "reject"]), reason: nullableReason, schedule: s.scheduleWriteSchema.nullable() }).strict().parse(body);
          if (input.decision === "approve" ? input.schedule?.status !== "published" : input.schedule !== null || !input.reason) throw new SyntaxError("Invalid review");
          return json(s.mutationSchema(s.suggestionSchema).parse(await rpc("fan_web_admin_review_schedule_suggestion", { ...actor, p_suggestion_id: id(), p_expected_revision: input.expectedRevision, p_decision: input.decision, p_reason: input.reason, p_schedule: input.schedule })));
        }
        case "admin-requests": return json(await paged("fan_web_admin_list_fanpage_requests", { ...actor, p_status: s.reviewStatus.nullable().parse(url.searchParams.get("status")), p_locale: locale, ...page }, s.fanpageRequestSchema));
        case "admin-request": {
          const input = z.object({ expectedRevision: revision, decision: z.enum(["approve", "reject"]), reason: nullableReason, celebrityId: s.uuid.nullable(), locale: s.contentLocale }).strict().parse(body);
          if (input.decision === "approve" ? !input.celebrityId : input.celebrityId !== null || !input.reason) throw new SyntaxError("Invalid review");
          return json(s.mutationSchema(s.fanpageRequestSchema).parse(await rpc("fan_web_admin_review_fanpage_request", { ...actor, p_request_id: id(), p_expected_revision: input.expectedRevision, p_decision: input.decision, p_reason: input.reason, p_celebrity_id: input.celebrityId, p_locale: input.locale })));
        }
        case "admin-live-submissions": return json(encodePage(s.rpcPage(s.adminLiveSubmissionSchema).extend({ settings: s.liveSubmissionSettingsSchema }).parse(await rpc("fan_web_admin_list_live_submissions", { ...actor, p_live_event_id: id(), p_status: z.enum(["submitted", "selected", "hidden"]).nullable().parse(url.searchParams.get("status")), ...page }))));
        case "admin-live-settings": {
          const input = z.object({ expectedRevision: revision, accepting: z.boolean(), closesAt: s.instant.nullable(), visibility: z.enum(["public", "members"]) }).strict().parse(body);
          if (input.accepting && !input.closesAt) throw new SyntaxError("Missing deadline");
          return json(s.liveSubmissionSettingsSchema.parse(await rpc("fan_web_admin_save_live_submission_settings", { ...actor, p_live_event_id: id(), p_expected_revision: input.expectedRevision, p_accepting: input.accepting, p_closes_at: input.closesAt, p_visibility: input.visibility })));
        }
        case "admin-live-submission": {
          const input = z.object({ action: z.enum(["select", "unselect", "hide"]), expectedRevision: revision, reason: nullableReason }).strict().parse(body);
          if (input.action === "hide" && !input.reason) throw new SyntaxError("Missing reason");
          return json(s.adminLiveSubmissionSchema.parse(await rpc("fan_web_admin_review_live_submission", { ...actor, p_submission_id: id(), p_expected_revision: input.expectedRevision, p_action: input.action, p_reason: input.reason })));
        }
        case "admin-replay": {
          const output = z.object({ liveEventId: s.uuid, replayProvider: z.string().nullable(), replayUrl: s.httpsUrl.nullable(), replayPublished: z.boolean(), replayRevision: z.number().int().positive() }).strict();
          if (request.method === "GET") return json(output.parse(await rpc("fan_web_admin_get_live_replay", { ...actor, p_live_event_id: id() })));
          const input = z.object({ expectedRevision: revision, replayProvider: z.enum(["youtube", "instagram", "tiktok", "chzzk"]).nullable(), replayUrl: s.httpsUrl.nullable(), replayPublished: z.boolean() }).strict().parse(body);
          if ((input.replayProvider === null) !== (input.replayUrl === null) || input.replayPublished && !input.replayUrl) throw new SyntaxError("Invalid replay");
          return json(output.parse(await rpc("fan_web_admin_save_live_replay", { ...actor, p_live_event_id: id(), p_expected_revision: input.expectedRevision, p_provider: input.replayProvider, p_url: input.replayUrl, p_published: input.replayPublished })));
        }
      }
    } catch (error) { return failure(parsingServerOutput && error instanceof z.ZodError ? new Error("FAN_WEB_UNAVAILABLE") : error); }
  };
}
export async function participationRoute(operation: ParticipationOperation, request: Request, params?: Params) {
  try { return await createParticipationHandler(createFanpageDependencies())(operation, request, params); } catch (error) { return failure(error); }
}
