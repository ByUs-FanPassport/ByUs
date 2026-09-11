import { z } from "zod";

export const SIGNUP_CLIENT_EVENT_NAMES = [
  "signup_guide_view", "signup_guide_cta", "login_started", "login_result",
] as const;
export const SIGNUP_SERVER_EVENT_NAMES = ["account_created", "profile_completed"] as const;
export type SignupClientEventName = (typeof SIGNUP_CLIENT_EVENT_NAMES)[number];

export const signupContextSchema = z.object({
  channel: z.enum(["direct", "search", "social", "email", "paid", "referral", "internal", "unknown"]),
  landing: z.enum(["home", "creator_directory", "creator", "live_directory", "live", "benefit", "fan_guide", "unknown"]),
  guide: z.enum(["elina", "ifew", "none"]),
  browser: z.enum(["instagram", "kakao", "safari", "chrome", "other"]),
  os: z.enum(["ios", "android", "other"]),
  locale: z.enum(["ko", "en"]),
}).strict();
export type SignupContext = z.infer<typeof signupContextSchema>;
export type SignupGuide = Exclude<SignupContext["guide"], "none">;
export const signupAudienceSchema = z.enum(["guest", "member", "unknown"]);
export type SignupAudience = z.infer<typeof signupAudienceSchema>;
export const signupActionSchema = z.enum(["verify", "live", "raffles", "steps", "certifications", "my"]);
export type SignupAction = z.infer<typeof signupActionSchema>;
export const signupPlacementSchema = z.enum(["hero", "step", "closing", "history"]);
export type SignupPlacement = z.infer<typeof signupPlacementSchema>;
export const signupProviderSchema = z.enum(["google", "apple", "test", "unknown"]);
export type SignupProvider = z.infer<typeof signupProviderSchema>;
export const signupTriggerSchema = z.enum(["provider", "session_restore", "retry", "reauth"]);
export type SignupTrigger = z.infer<typeof signupTriggerSchema>;
export const signupStageSchema = z.enum(["oauth", "user", "wallet", "token", "session", "ready", "reauthentication"]);
export type SignupStage = z.infer<typeof signupStageSchema>;
export const signupReasonSchema = z.enum(["none", "timeout", "provider_error", "session_error", "verified_email_required", "reauthentication_required", "unknown"]);
export type SignupReason = z.infer<typeof signupReasonSchema>;

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const loginProperties = signupContextSchema.extend({ provider: signupProviderSchema, trigger: signupTriggerSchema }).strict();
const detailsSchema = z.discriminatedUnion("eventName", [
  z.object({
    eventName: z.literal("signup_guide_view"), source: z.literal("signup.guide"),
    idempotencyKey: z.string().regex(new RegExp(`^signup-guide:${uuid}:view$`)),
    properties: signupContextSchema.extend({ audience: signupAudienceSchema }).strict(),
  }),
  z.object({
    eventName: z.literal("signup_guide_cta"), source: z.literal("signup.guide"),
    idempotencyKey: z.string().regex(new RegExp(`^signup-guide:${uuid}:cta$`)),
    properties: signupContextSchema.extend({ audience: signupAudienceSchema, action: signupActionSchema, placement: signupPlacementSchema }).strict(),
  }),
  z.object({
    eventName: z.literal("login_started"), source: z.literal("signup.login"),
    idempotencyKey: z.string().regex(new RegExp(`^signup-login:${uuid}:started$`)),
    properties: loginProperties,
  }),
  z.object({
    eventName: z.literal("login_result"), source: z.literal("signup.login"),
    idempotencyKey: z.string().regex(new RegExp(`^signup-login:${uuid}:(succeeded|failed)$`)),
    properties: loginProperties.extend({
      outcome: z.enum(["succeeded", "failed"]), stage: signupStageSchema, reason: signupReasonSchema,
    }).strict(),
  }),
]);

export function isSignupClientEvent(name: string): name is SignupClientEventName {
  return (SIGNUP_CLIENT_EVENT_NAMES as readonly string[]).includes(name);
}

/** Only allow fixed, non-identifying properties for the anonymous signup observations. */
export function validateSignupEvent(input: {
  eventName: string; source: string; idempotencyKey: string; properties: unknown;
  appUserId?: string | null; anonymousSessionId: string | null;
  celebrityId: string | null; liveEventId: string | null; missionId: string | null; benefitId: string | null;
}, context: z.RefinementCtx): void {
  if (!isSignupClientEvent(input.eventName)) return;
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) {
    parsed.error.issues.forEach((issue) => context.addIssue({ code: "custom", path: issue.path, message: issue.message }));
    return;
  }
  if (input.appUserId != null || !input.anonymousSessionId
    || [input.celebrityId, input.liveEventId, input.missionId, input.benefitId].some((id) => id !== null)) {
    context.addIssue({ code: "custom", message: "Signup observations must be anonymous and have no entity owners" });
  }
  if (parsed.data.eventName === "login_result") {
    const { outcome, stage, reason } = parsed.data.properties;
    if (!input.idempotencyKey.endsWith(`:${outcome}`)
      || (outcome === "succeeded" ? stage !== "session" || reason !== "none" : reason === "none")) {
      context.addIssue({ code: "custom", message: "Invalid observed login result" });
    }
  }
}
