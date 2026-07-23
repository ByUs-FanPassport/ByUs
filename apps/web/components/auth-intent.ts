import { z } from "zod";

export const authActionTypeSchema = z.enum([
  "START_FAN_VERIFICATION",
  "RESERVE_LIVE",
  "SUBMIT_FAN_CODE",
  "OPEN_SURVEY",
  "CLAIM_BENEFIT",
  "APPLY_BENEFIT",
  "OPEN_PASSPORT",
]);

export type AuthActionType = z.infer<typeof authActionTypeSchema>;

const safePathSchema = z
  .string()
  .max(1024)
  .refine((value) => {
    if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return false;
    try {
      const parsed = new URL(value, "https://byus.local");
      return parsed.origin === "https://byus.local"
        && !parsed.username
        && !parsed.password
        && parsed.pathname === value
        && !parsed.search
        && !parsed.hash;
    } catch {
      return false;
    }
  });

const safeQuerySchema = z
  .string()
  .max(1024)
  .refine((value) => value === "" || value.startsWith("?"));

const safeAnchorSchema = z
  .string()
  .max(128)
  .regex(/^#[A-Za-z][A-Za-z0-9_-]*$/);

const safeTargetIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

const safeDraftPayloadSchema = z
  .record(z.string().max(48), z.union([z.string().max(256), z.number().finite(), z.boolean(), z.null()]))
  .refine((value) => Object.keys(value).every((key) => key === "draftRef"), "Only opaque draft references are allowed")
  .refine((value) => typeof value.draftRef !== "string" || /^byus:[a-z0-9:-]{1,240}$/i.test(value.draftRef), "Draft references must be scoped storage keys")
  .refine((value) => JSON.stringify(value).length <= 1024);

export const authIntentSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    sourcePath: safePathSchema,
    sourceQuery: safeQuerySchema,
    actionType: authActionTypeSchema,
    targetType: z.enum(["celebrity", "live_event", "survey", "benefit", "passport"]),
    targetId: safeTargetIdSchema,
    draftPayload: safeDraftPayloadSchema,
    returnAnchor: safeAnchorSchema.nullable(),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedTargetByAction: Record<AuthActionType, AuthIntent["targetType"]> = {
      START_FAN_VERIFICATION: "celebrity",
      RESERVE_LIVE: "live_event",
      SUBMIT_FAN_CODE: "live_event",
      OPEN_SURVEY: "survey",
      CLAIM_BENEFIT: "benefit",
      APPLY_BENEFIT: "benefit",
      OPEN_PASSPORT: "passport",
    };
    const expectedPath = value.actionType === "START_FAN_VERIFICATION"
      ? `/c/${value.targetId}/verify`
      : value.actionType === "RESERVE_LIVE" || value.actionType === "SUBMIT_FAN_CODE"
        ? `/live/${value.targetId}`
        : value.actionType === "OPEN_SURVEY"
          ? `/live/${value.targetId}/survey`
          : value.actionType === "CLAIM_BENEFIT" || value.actionType === "APPLY_BENEFIT"
            ? `/benefits/${value.targetId}`
            : value.targetId === "collection"
              ? "/passports"
              : `/passports/${value.targetId}`;
    if (value.targetType !== expectedTargetByAction[value.actionType]) {
      context.addIssue({ code: "custom", path: ["targetType"], message: "Intent action and target type do not match" });
    }
    if (value.sourcePath !== expectedPath && !(value.actionType === "OPEN_PASSPORT" && value.sourcePath === `${expectedPath}/issuance`)) {
      context.addIssue({ code: "custom", path: ["sourcePath"], message: "Intent action and source path do not match" });
    }
    if (value.draftPayload.draftRef && value.actionType !== "SUBMIT_FAN_CODE") {
      context.addIssue({ code: "custom", path: ["draftPayload"], message: "Only Fan Code submission may carry a draft reference" });
    }
    if (value.expiresAt <= value.createdAt) {
      context.addIssue({ code: "custom", path: ["expiresAt"], message: "Intent expiry must be after creation" });
    }
    if (value.expiresAt - value.createdAt > AUTH_INTENT_MAX_AGE_MS) {
      context.addIssue({ code: "custom", path: ["expiresAt"], message: "Intent lifetime is too long" });
    }
  });

export type AuthIntent = z.infer<typeof authIntentSchema>;

export type CreateAuthIntentInput = Pick<
  AuthIntent,
  "sourcePath" | "sourceQuery" | "actionType" | "targetType" | "targetId"
> & {
  draftPayload?: AuthIntent["draftPayload"];
  returnAnchor?: string | null;
};

export const AUTH_INTENT_MAX_AGE_MS = 30 * 60 * 1000;
export const AUTH_INTENT_STORAGE_PREFIX = "byus:auth-intent:v1:";

const legacyIntentByAction: Record<AuthActionType, string> = {
  START_FAN_VERIFICATION: "passport",
  RESERVE_LIVE: "reserve",
  SUBMIT_FAN_CODE: "attendance",
  OPEN_SURVEY: "survey",
  CLAIM_BENEFIT: "benefit-claim",
  APPLY_BENEFIT: "benefit-application",
  OPEN_PASSPORT: "passport",
};

export function legacyIntentForAction(actionType: AuthActionType): string {
  return legacyIntentByAction[actionType];
}

function storageKey(id: string): string {
  return `${AUTH_INTENT_STORAGE_PREFIX}${id}`;
}

function removeAssociatedDraft(storage: Storage, intent: AuthIntent): void {
  const draftRef = intent.draftPayload.draftRef;
  if (typeof draftRef === "string" && /^byus:fan-code-draft:[a-z0-9][a-z0-9-]{0,127}$/i.test(draftRef)) {
    storage.removeItem(draftRef);
  }
}

export function createAuthIntent(
  input: CreateAuthIntentInput,
  options: { now?: number; id?: string } = {},
): AuthIntent {
  const createdAt = options.now ?? Date.now();
  return authIntentSchema.parse({
    version: 1,
    id: options.id ?? crypto.randomUUID(),
    ...input,
    draftPayload: input.draftPayload ?? {},
    returnAnchor: input.returnAnchor ?? null,
    createdAt,
    expiresAt: createdAt + AUTH_INTENT_MAX_AGE_MS,
  });
}

export function persistAuthIntent(storage: Storage, intent: AuthIntent): void {
  const parsed = authIntentSchema.parse(intent);
  storage.setItem(storageKey(parsed.id), JSON.stringify(parsed));
}

export function readAuthIntent(
  storage: Storage,
  id: string | null | undefined,
  now = Date.now(),
): AuthIntent | null {
  if (!id || !z.uuid().safeParse(id).success) return null;
  const key = storageKey(id);
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = authIntentSchema.parse(JSON.parse(raw));
    if (parsed.expiresAt <= now) {
      removeAssociatedDraft(storage, parsed);
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function consumeAuthIntent(storage: Storage, id: string, now = Date.now()): AuthIntent | null {
  const intent = readAuthIntent(storage, id, now);
  if (intent) {
    removeAssociatedDraft(storage, intent);
    storage.removeItem(storageKey(intent.id));
  }
  return intent;
}

export function authIntentReturnTo(intent: AuthIntent): string {
  const query = new URLSearchParams(intent.sourceQuery.startsWith("?") ? intent.sourceQuery.slice(1) : intent.sourceQuery);
  query.set("authIntent", intent.id);
  return `${intent.sourcePath}?${query.toString()}${intent.returnAnchor ?? ""}`;
}

export function buildAuthLoginHref(intent: AuthIntent, locale: "ko" | "en"): string {
  const query = new URLSearchParams({
    returnTo: authIntentReturnTo(intent),
    locale,
    intent: legacyIntentForAction(intent.actionType),
    entity: intent.targetId,
    authIntent: intent.id,
  });
  return `/login?${query.toString()}`;
}
