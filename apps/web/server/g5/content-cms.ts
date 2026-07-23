import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AdminSession } from "../admin/admin-session-gate";

const uuid = z.string().uuid();
const localization = z.object({
  name: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(1000),
  imageAlt: z.string().trim().min(1).max(300),
});
export const celebrityPayload = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  imageUrl: z
    .string()
    .refine((v) => v.startsWith("/") || v.startsWith("https://")),
  imagePosition: z.string().trim().min(1).max(100),
  displayOrder: z.number().int().min(0),
  fanCount: z.number().int().min(0).nullable(),
  localizations: z.object({ ko: localization, en: localization }),
  themes: z
    .array(
      z.object({
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        nameKo: z.string().trim().min(1).max(100),
        nameEn: z.string().trim().min(1).max(100),
        position: z.number().int().min(0),
      }),
    )
    .max(12),
  socialLinks: z
    .array(
      z.object({
        platform: z.enum(["youtube", "tiktok", "instagram"]),
        url: z.string().url().startsWith("https://"),
        position: z.number().int().min(0),
        active: z.boolean(),
      }),
    )
    .max(3),
});
const option = z.object({
  position: z.number().int().min(1).max(4),
  labelKo: z.string().trim().min(1).max(500),
  labelEn: z.string().trim().min(1).max(500),
  isCorrect: z.boolean(),
  active: z.boolean(),
});
const question = z.object({
  position: z.number().int().min(1),
  promptKo: z.string().trim().min(1).max(1000),
  promptEn: z.string().trim().min(1).max(1000),
  active: z.boolean(),
  options: z
    .array(option)
    .length(4)
    .refine(
      (items) => items.filter((x) => x.isCorrect).length === 1,
      "one correct option required",
    ),
});
export const quizPayload = z.object({
  quizId: uuid.nullable(),
  questions: z.array(question).min(1).max(100),
});
export const commandPayload = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    celebrityId: uuid.nullable(),
    payload: celebrityPayload,
  }),
  z.object({ action: z.enum(["publish", "unpublish"]), celebrityId: uuid }),
  z.object({
    action: z.literal("archive"),
    celebrityId: uuid,
    reason: z.string().trim().min(10).max(1000),
  }),
]);
export const quizCommandPayload = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), payload: quizPayload }),
  z.object({ action: z.enum(["clone", "publish"]), quizId: uuid }),
]);

type Rpc = Pick<SupabaseClient, "rpc">;
export class CmsError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "FORBIDDEN" | "INVALID" | "UNAVAILABLE",
    message: string = code,
  ) {
    super(message);
  }
}
const classify = (message: string) =>
  new CmsError(
    message.includes("not found")
      ? "NOT_FOUND"
      : message.includes("authorized") || message.includes("viewer")
        ? "FORBIDDEN"
        : message.includes("requires") ||
            message.includes("duplicate key") ||
            message.includes("invalid") ||
            message.includes("immutable")
          ? "INVALID"
          : "UNAVAILABLE",
    message,
  );
export class ContentCmsRepository {
  constructor(private readonly db: Rpc) {}
  private async call(name: string, args: Record<string, unknown>) {
    const { data, error } = await this.db.rpc(name, args);
    if (error) throw classify(error.message);
    return data;
  }
  celebrities(actor: AdminSession, id: string | null) {
    return this.call("read_admin_celebrity_cms", {
      p_actor: actor.allowlistId,
      p_celebrity: id,
    });
  }
  saveCelebrity(
    actor: AdminSession,
    correlation: string,
    id: string | null,
    payload: z.infer<typeof celebrityPayload>,
  ) {
    return this.call("save_admin_celebrity", {
      p_actor: actor.allowlistId,
      p_correlation: correlation,
      p_celebrity: id,
      p_payload: payload,
    });
  }
  publication(
    actor: AdminSession,
    correlation: string,
    id: string,
    publish: boolean,
  ) {
    return this.call("set_admin_celebrity_publication", {
      p_actor: actor.allowlistId,
      p_correlation: correlation,
      p_celebrity: id,
      p_publish: publish,
    });
  }
  archive(
    actor: AdminSession,
    correlation: string,
    id: string,
    reason: string,
  ) {
    return this.call("archive_admin_content", {
      p_entity_type: "celebrity",
      p_entity_id: id,
      p_actor_admin_allowlist_id: actor.allowlistId,
      p_reason: reason,
      p_correlation_id: correlation,
    });
  }
  quizzes(actor: AdminSession, celebrityId: string) {
    return this.call("read_admin_quiz_cms", {
      p_actor: actor.allowlistId,
      p_celebrity: celebrityId,
    });
  }
  saveQuiz(
    actor: AdminSession,
    correlation: string,
    celebrityId: string,
    payload: z.infer<typeof quizPayload>,
  ) {
    return this.call("save_admin_quiz_version", {
      p_actor: actor.allowlistId,
      p_correlation: correlation,
      p_celebrity: celebrityId,
      p_quiz: payload.quizId,
      p_questions: payload.questions,
    });
  }
  quizCommand(
    actor: AdminSession,
    correlation: string,
    celebrityId: string,
    action: "clone" | "publish",
    quizId: string,
  ) {
    return this.call(
      action === "clone"
        ? "clone_admin_quiz_version"
        : "publish_admin_quiz_version",
      {
        p_actor: actor.allowlistId,
        p_correlation: correlation,
        p_celebrity: celebrityId,
        p_quiz: quizId,
      },
    );
  }
}
export function createContentCmsRepository(
  config: { url: string; serviceRoleKey: string },
  client?: Rpc,
) {
  return new ContentCmsRepository(
    client ??
      createClient(config.url, config.serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }),
  );
}
