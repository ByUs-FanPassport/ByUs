import { z } from "zod";
import { acquisitionLanding, classifyAcquisitionChannel, readStoredAcquisitionTouch } from "../domain/acquisition-attribution";
import {
  signupContextSchema, signupProviderSchema, signupTriggerSchema, parseWalletDiagnostic, type WalletDiagnostic,
  type SignupAction, type SignupAudience, type SignupContext, type SignupGuide,
  type SignupPlacement, type SignupProvider, type SignupReason, type SignupStage, type SignupTrigger,
} from "../domain/signup-funnel-event";
import { recordProductEventV1 } from "./product-event-client";

const CONTEXT_KEY = "byus.signup.context.v1";
const ATTEMPT_KEY = "byus.signup.attempt.v1";
const VIEW_PREFIX = "byus.signup.guide-view.v1";
export const SIGNUP_CONTEXT_TTL_MS = 30 * 60_000;
const contextRecordSchema = z.object({ context: signupContextSchema, at: z.number() }).strict();
const attemptSchema = z.object({
  nonce: z.uuidv4(), at: z.number(), context: signupContextSchema,
  provider: signupProviderSchema, trigger: signupTriggerSchema,
  succeeded: z.boolean(), failed: z.boolean(),
}).strict();
export type LoginMeasurementAttempt = z.infer<typeof attemptSchema>;

type TrackerEnvironment = {
  storage(): Pick<Storage, "getItem" | "setItem" | "removeItem">;
  now(): number;
  uuid(): string;
  userAgent(): string;
  location(): { href: string; referrer: string };
  record: typeof recordProductEventV1;
};

function browserContext(ua: string): Pick<SignupContext, "browser" | "os"> {
  return {
    browser: /instagram/i.test(ua) ? "instagram" : /kakaotalk/i.test(ua) ? "kakao"
      : /chrome|crios/i.test(ua) ? "chrome" : /safari/i.test(ua) ? "safari" : "other",
    os: /iphone|ipad|ipod/i.test(ua) ? "ios" : /android/i.test(ua) ? "android" : "other",
  };
}

/** All environment/storage preparation and delivery is best effort; callers never await telemetry. */
export function createSignupFunnelTracker(environment: TrackerEnvironment) {
  const outcomes = new Set<string>();
  let pendingInvalidated = false;
  const fresh = (at: number) => at <= environment.now() && environment.now() - at < SIGNUP_CONTEXT_TTL_MS;
  function read<T>(key: string, schema: z.ZodType<T>): T | null {
    const raw = environment.storage().getItem(key);
    if (!raw) return null;
    try { return schema.parse(JSON.parse(raw)); } catch { return null; }
  }
  function write(key: string, value: unknown) {
    environment.storage().setItem(key, JSON.stringify(value));
  }
  function context(locale: "ko" | "en", guide?: SignupGuide): SignupContext {
    const stored = read(CONTEXT_KEY, contextRecordSchema);
    const location = environment.location();
    const url = new URL(location.href);
    const touch = readStoredAcquisitionTouch(environment.storage().getItem("byus.acquisition.session.v1"));
    const prior = stored && fresh(stored.at) ? stored.context : null;
    return signupContextSchema.parse({
      channel: prior?.channel ?? touch?.channel ?? classifyAcquisitionChannel({
        searchParams: url.searchParams, referrer: location.referrer, siteOrigin: url.origin,
      }),
      landing: prior?.landing ?? touch?.landing ?? acquisitionLanding(url.pathname) ?? "unknown",
      guide: guide ?? prior?.guide ?? "none",
      ...browserContext(environment.userAgent()), locale,
    });
  }
  function deliver(input: Parameters<typeof recordProductEventV1>[0]) {
    try {
      // Deliberately no access token: observations never become identified account events.
      void environment.record(input).catch(() => undefined);
    } catch { /* A synchronous recorder failure must not change navigation/auth. */ }
  }
  const emptyEntities = { celebrityId: null, liveEventId: null, missionId: null, benefitId: null } as const;

  function guideView(guide: SignupGuide, locale: "ko" | "en", audience: SignupAudience): void {
    try {
      const key = `${VIEW_PREFIX}:${guide}`;
      const existing = read(key, z.object({ at: z.number() }).strict());
      if (existing && fresh(existing.at)) return;
      const at = environment.now();
      const properties = context(locale, guide);
      const nonce = environment.uuid();
      write(CONTEXT_KEY, { context: properties, at });
      write(key, { at });
      deliver({ ...emptyEntities, eventName: "signup_guide_view", source: "signup.guide",
        idempotencyKey: `signup-guide:${nonce}:view`, occurredAt: new Date(at).toISOString(),
        properties: { ...properties, audience } });
    } catch { /* Missing or blocked browser storage is a measurement gap only. */ }
  }
  function guideCta(guide: SignupGuide, locale: "ko" | "en", audience: SignupAudience,
    action: SignupAction, placement: SignupPlacement): void {
    try {
      const at = environment.now();
      const properties = context(locale, guide);
      const nonce = environment.uuid();
      write(CONTEXT_KEY, { context: properties, at });
      deliver({ ...emptyEntities, eventName: "signup_guide_cta", source: "signup.guide",
        idempotencyKey: `signup-guide:${nonce}:cta`, occurredAt: new Date(at).toISOString(),
        properties: { ...properties, audience, action, placement } });
    } catch { /* Never prevent the link's default action. */ }
  }
  function beginLogin(provider: SignupProvider, trigger: SignupTrigger, locale: "ko" | "en"): LoginMeasurementAttempt | null {
    try {
      const attempt = attemptSchema.parse({
        nonce: environment.uuid(), at: environment.now(), context: context(locale), provider, trigger,
        succeeded: false, failed: false,
      });
      write(ATTEMPT_KEY, attempt);
      pendingInvalidated = false;
      deliver({ ...emptyEntities, eventName: "login_started", source: "signup.login",
        idempotencyKey: `signup-login:${attempt.nonce}:started`, occurredAt: new Date(attempt.at).toISOString(),
        properties: { ...attempt.context, provider, trigger } });
      return attempt;
    } catch { return null; }
  }
  function pendingLogin(): LoginMeasurementAttempt | null {
    try {
      if (pendingInvalidated) return null;
      const attempt = read(ATTEMPT_KEY, attemptSchema);
      return attempt && fresh(attempt.at) && !attempt.succeeded ? attempt : null;
    } catch { return null; }
  }
  function resumeLogin(locale: "ko" | "en"): LoginMeasurementAttempt | null {
    return pendingLogin() ?? beginLogin("unknown", "session_restore", locale);
  }
  function forgetLoginAttempt(): void {
    pendingInvalidated = true;
    try { environment.storage().removeItem(ATTEMPT_KEY); } catch { /* Auth state still changes normally. */ }
  }
  function result(attempt: LoginMeasurementAttempt | null, outcome: "succeeded" | "failed",
    stage: SignupStage, reason: SignupReason, walletDiagnostic?: WalletDiagnostic): void {
    if (!attempt) return;
    try {
      if (!fresh(attempt.at)) return;
      const key = `signup-login:${attempt.nonce}:${outcome}`;
      const stored = read(ATTEMPT_KEY, attemptSchema);
      if (outcomes.has(key) || attempt[outcome] || (stored?.nonce === attempt.nonce && stored[outcome])) return;
      if (outcome === "failed" && (attempt.succeeded || (stored?.nonce === attempt.nonce && stored.succeeded))) return;
      const diagnostic = parseWalletDiagnostic(walletDiagnostic, outcome, stage, reason);
      outcomes.add(key);
      attempt[outcome] = true;
      // Late outcomes retain their captured attempt, never replacing a newer attempt in storage.
      if (stored?.nonce === attempt.nonce) write(ATTEMPT_KEY, { ...stored, [outcome]: true });
      deliver({ ...emptyEntities, eventName: "login_result", source: "signup.login",
        idempotencyKey: key, occurredAt: new Date(environment.now()).toISOString(),
        properties: { ...attempt.context, provider: attempt.provider, trigger: attempt.trigger, outcome, stage, reason, ...diagnostic } });
    } catch { /* Telemetry does not establish or revoke a session. */ }
  }
  return { guideView, guideCta, beginLogin, pendingLogin, resumeLogin, forgetLoginAttempt, result };
}

export const signupFunnelTracker = createSignupFunnelTracker({
  storage: () => window.sessionStorage,
  now: () => Date.now(), uuid: () => crypto.randomUUID(), userAgent: () => navigator.userAgent,
  location: () => ({ href: window.location.href, referrer: document.referrer }),
  record: recordProductEventV1,
});
