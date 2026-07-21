import "server-only";
import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "../admin/admin-session-gate";
import { adminCorrelationId } from "./blockchain-job-route";
import type { BenefitAdminRepository } from "./benefit-admin-repository";
export type BenefitAdminDependencies = {
  authorize(input: {
    authorization: string;
    correlationId: string;
  }): Promise<AdminSession>;
  repository: BenefitAdminRepository;
  invalidatePublicContent(): void;
};
const uuid = z.string().uuid(),
  instant = z.string().datetime({ offset: true });
const save = z
  .object({
    action: z.literal("save"),
    id: uuid.nullable().optional(),
    expectedRevision: z.number().int().positive().nullable().optional(),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    celebrityId: uuid,
    allocationMode: z.enum(["direct_claim", "application_selection"]),
    deliveryType: z.enum([
      "text",
      "external_link",
      "shared_code",
      "unique_code",
    ]),
    claimOpensAt: instant,
    claimClosesAt: instant,
    stockLimit: z.number().int().positive().nullable(),
    perUserLimit: z.number().int().min(1).max(100),
    minimumScore: z.number().int().nonnegative(),
    minimumLevel: z.enum(["Bronze", "Silver", "Gold", "Platinum", "Diamond"]),
    requiredStampType: z
      .enum(["knowledge", "reservation", "attendance", "survey"])
      .nullable(),
    requiredActivityType: z
      .enum(["knowledge", "reservation", "attendance", "survey"])
      .nullable(),
    titleKo: z.string().trim().min(1).max(160),
    summaryKo: z.string().trim().min(1).max(1200),
    eligibilityKo: z.string().trim().min(1).max(300),
    deliveryKo: z.string().trim().min(1).max(300),
    titleEn: z.string().trim().min(1).max(160),
    summaryEn: z.string().trim().min(1).max(1200),
    eligibilityEn: z.string().trim().min(1).max(300),
    deliveryEn: z.string().trim().min(1).max(300),
    deliverySecret: z.string().max(4000).optional().default(""),
  })
  .superRefine((v, c) => {
    if (v.allocationMode === "application_selection" && v.perUserLimit !== 1)
      c.addIssue({
        code: "custom",
        path: ["perUserLimit"],
        message: "APPLICATION_LIMIT_ONE",
      });
  });
const command = z.discriminatedUnion("action", [
  save,
  z.object({
    action: z.literal("codes"),
    id: uuid,
    expectedRevision: z.number().int().positive(),
    codes: z.array(z.string().min(1).max(500)).max(10000),
  }),
  z.object({
    action: z.literal("clear_codes"),
    id: uuid,
    expectedRevision: z.number().int().positive(),
  }),
  z.object({
    action: z.enum(["publish", "unpublish"]),
    id: uuid,
    expectedRevision: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("archive"),
    id: uuid,
    expectedRevision: z.number().int().positive(),
    reason: z.string().trim().min(10).max(1000),
  }),
  z.object({
    action: z.literal("decide"),
    applicationId: uuid,
    selected: z.boolean(),
    idempotencyKey: uuid,
  }),
  z.object({ action: z.literal("use"), claimId: uuid, usedAt: instant }),
]);
const json = (body: unknown, status: number) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", vary: "Authorization" },
  });
async function auth(request: Request, d: BenefitAdminDependencies, c: string) {
  try {
    return await d.authorize({
      authorization: request.headers.get("authorization") ?? "",
      correlationId: c,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return json(
        { error: { code: e.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" } },
        e.status === 401 ? 401 : 403,
      );
    return json({ error: { code: "BENEFIT_MANAGER_UNAVAILABLE" } }, 503);
  }
}
export function createGetBenefitAdminHandler(d: BenefitAdminDependencies) {
  return async (request: Request) => {
    const c = adminCorrelationId(request),
      a = await auth(request, d, c);
    if (a instanceof Response) return a;
    try {
      return json(
        await d.repository.read({
          appUserId: a.appUserId,
          allowlistId: a.allowlistId,
        }),
        200,
      );
    } catch {
      return json({ error: { code: "BENEFIT_MANAGER_UNAVAILABLE" } }, 503);
    }
  };
}
export function createPostBenefitAdminHandler(d: BenefitAdminDependencies) {
  return async (request: Request) => {
    const c = adminCorrelationId(request),
      a = await auth(request, d, c);
    if (a instanceof Response) return a;
    if (a.role === "viewer") return json({ error: { code: "FORBIDDEN" } }, 403);
    let p: z.infer<typeof command>;
    try {
      p = command.parse(await request.json());
    } catch {
      return json({ error: { code: "INVALID_REQUEST" } }, 400);
    }
    const actor = { appUserId: a.appUserId, allowlistId: a.allowlistId };
    try {
      if (p.action === "save")
        return json(
          { id: await d.repository.save(actor, c, p) },
          p.id ? 200 : 201,
        );
      if (p.action === "codes")
        return json(
          await d.repository.codes(actor, c, p.id, p.expectedRevision, p.codes),
          200,
        );
      if (p.action === "clear_codes")
        return json(
          await d.repository.clearCodes(actor, c, p.id, p.expectedRevision),
          200,
        );
      if (
        p.action === "publish" ||
        p.action === "unpublish" ||
        p.action === "archive"
      ) {
        await d.repository.state(
          actor,
          c,
          p.id,
          p.expectedRevision,
          p.action,
          p.action === "archive" ? p.reason : undefined,
        );
        d.invalidatePublicContent();
        return json({ ok: true }, 200);
      }
      if (p.action === "decide")
        return json(
          await d.repository.decide(
            actor,
            c,
            p.applicationId,
            p.selected,
            p.idempotencyKey,
          ),
          200,
        );
      if (p.action === "use")
        return json(await d.repository.use(actor, c, p.claimId, p.usedAt), 200);
      return json({ error: { code: "INVALID_REQUEST" } }, 400);
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      const conflict =
        /conflict|immutable|archived|history|available|required|published|exhausted|decided|selection|timestamp|clear unique/i.test(
          m,
        );
      return json(
        {
          error: {
            code: conflict
              ? "BENEFIT_COMMAND_REJECTED"
              : "BENEFIT_MANAGER_UNAVAILABLE",
          },
        },
        conflict ? 409 : 503,
      );
    }
  };
}
