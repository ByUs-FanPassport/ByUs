import "server-only";
import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "../admin/admin-session-gate";
import {
  SurveyBuilderRepositoryError,
  type SurveyBuilderRepository,
} from "./survey-builder-repository";

const uuid = z.string().uuid();
const option = z.object({
  position: z.number().int().positive(),
  label: z.object({
    ko: z.string().trim().min(1).max(300),
    en: z.string().trim().min(1).max(300),
  }),
});
const question = z
  .object({
    type: z.enum([
      "single_choice",
      "multiple_choice",
      "rating_1_5",
      "free_text",
    ]),
    commonKey: z
      .enum([
        "overall_satisfaction",
        "purchase_intent",
        "future_interest",
        "free_comment",
      ])
      .nullable(),
    required: z.boolean(),
    position: z.number().int().positive(),
    text: z.object({
      ko: z.string().trim().min(1).max(1000),
      en: z.string().trim().min(1).max(1000),
    }),
    options: z.array(option).max(20),
  })
  .superRefine((value, ctx) => {
    const choice =
      value.type === "single_choice" || value.type === "multiple_choice";
    if (choice && value.options.length < 2)
      ctx.addIssue({
        code: "custom",
        message: "Choice questions require at least two options",
      });
    if (!choice && value.options.length)
      ctx.addIssue({
        code: "custom",
        message: "This type cannot have options",
      });
    if (value.options.some((item, index) => item.position !== index + 1))
      ctx.addIssue({
        code: "custom",
        message: "Option positions must be contiguous",
      });
  });
const questions = z
  .array(question)
  .min(4)
  .max(6)
  .superRefine((items, ctx) => {
    const canonical = {
      overall_satisfaction: { type: "rating_1_5", required: true },
      purchase_intent: { type: "single_choice", required: true },
      future_interest: { type: "single_choice", required: true },
      free_comment: { type: "free_text", required: false },
    } as const;
    for (const [key, contract] of Object.entries(canonical)) {
      const matches = items.filter((item) => item.commonKey === key);
      if (
        matches.length !== 1 ||
        matches[0].type !== contract.type ||
        matches[0].required !== contract.required
      ) {
        ctx.addIssue({
          code: "custom",
          message: `Invalid canonical question: ${key}`,
        });
      }
    }
    if (items.some((item, index) => item.position !== index + 1)) {
      ctx.addIssue({
        code: "custom",
        message: "Question positions must be contiguous",
      });
    }
  });
const body = z.discriminatedUnion("command", [
  z.object({ command: z.literal("create") }),
  z.object({ command: z.literal("clone"), sourceSurveyId: uuid }),
  z.object({
    command: z.enum(["edit", "order"]),
    surveyId: uuid,
    expectedRevision: z.number().int().nonnegative(),
    questions,
  }),
  z.object({
    command: z.enum(["publish", "archive"]),
    surveyId: uuid,
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({ command: z.literal("close"), surveyId: uuid }),
]);
export interface SurveyBuilderRouteDependencies {
  repository: SurveyBuilderRepository;
  authorize(input: {
    authorization: string;
    correlationId: string;
  }): Promise<AdminSession>;
}
function correlation(request: Request) {
  const value = request.headers.get("x-correlation-id")?.trim();
  return value && uuid.safeParse(value).success ? value : crypto.randomUUID();
}
function json(value: unknown, status: number) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "private, no-store", vary: "Authorization" },
  });
}
async function auth(
  request: Request,
  deps: SurveyBuilderRouteDependencies,
  id: string,
) {
  try {
    return await deps.authorize({
      authorization: request.headers.get("authorization") ?? "",
      correlationId: id,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return json(
        { error: { code: e.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" } },
        e.status === 401 ? 401 : 403,
      );
    return json({ error: { code: "SURVEY_BUILDER_UNAVAILABLE" } }, 503);
  }
}
function failure(e: unknown) {
  if (e instanceof SurveyBuilderRepositoryError) {
    if (e.code === "NOT_FOUND")
      return json({ error: { code: "LIVE_OR_SURVEY_NOT_FOUND" } }, 404);
    if (e.code === "FORBIDDEN")
      return json({ error: { code: "FORBIDDEN" } }, 403);
    if (e.code === "INVALID")
      return json({ error: { code: "INVALID_SURVEY" } }, 400);
    if (e.code === "CONFLICT")
      return json({ error: { code: "SURVEY_STATE_CONFLICT" } }, 409);
  }
  return json({ error: { code: "SURVEY_BUILDER_UNAVAILABLE" } }, 503);
}
export function createGetSurveyBuilderHandler(
  deps: SurveyBuilderRouteDependencies,
) {
  return async (request: Request, input: { liveEventId: string }) => {
    const id = correlation(request);
    const admin = await auth(request, deps, id);
    if (admin instanceof Response) return admin;
    if (!uuid.safeParse(input.liveEventId).success)
      return json({ error: { code: "LIVE_OR_SURVEY_NOT_FOUND" } }, 404);
    try {
      return json(
        {
          data: await deps.repository.get({
            actorAppUserId: admin.appUserId,
            actorAllowlistId: admin.allowlistId,
            liveEventId: input.liveEventId,
          }),
        },
        200,
      );
    } catch (e) {
      return failure(e);
    }
  };
}
export function createWriteSurveyBuilderHandler(
  deps: SurveyBuilderRouteDependencies,
) {
  return async (request: Request, input: { liveEventId: string }) => {
    const id = correlation(request);
    const admin = await auth(request, deps, id);
    if (admin instanceof Response) return admin;
    if (admin.role === "viewer")
      return json({ error: { code: "FORBIDDEN" } }, 403);
    if (!uuid.safeParse(input.liveEventId).success)
      return json({ error: { code: "LIVE_OR_SURVEY_NOT_FOUND" } }, 404);
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: { code: "INVALID_REQUEST" } }, 400);
    }
    const parsed = body.safeParse(raw);
    if (!parsed.success)
      return json(
        {
          error: {
            code: "INVALID_REQUEST",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        400,
      );
    const { command, ...payload } = parsed.data;
    try {
      return json(
        {
          data: await deps.repository.write({
            actorAppUserId: admin.appUserId,
            actorAllowlistId: admin.allowlistId,
            liveEventId: input.liveEventId,
            command,
            payload,
            correlationId: id,
          }),
        },
        200,
      );
    } catch (e) {
      return failure(e);
    }
  };
}
