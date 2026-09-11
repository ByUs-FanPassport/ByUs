import { AuthError, type AuthErrorCode } from "../../features/auth/domain/auth-errors";
import { RequestTimeoutError } from "../../features/reliability/client/request-deadline";
import type { PrivySessionResolver, SessionSyncRepository } from "./session-sync";

const AUTH_ERROR_CODES = new Set<AuthErrorCode>([
  "AUTHENTICATION_REQUIRED",
  "INVALID_PRIVY_IDENTITY",
  "VERIFIED_EMAIL_REQUIRED",
  "APPLE_REAUTHENTICATION_REQUIRED",
  "INVALID_EMAIL",
  "INVALID_WALLET",
  "WALLET_ALREADY_LINKED",
  "WALLET_RELINK_REQUIRES_REVIEW",
  "ADMIN_NOT_ALLOWLISTED",
  "ADMIN_DISABLED",
  "ADMIN_GOOGLE_REQUIRED",
  "ADMIN_EMAIL_MISMATCH",
]);

type SessionDiagnosticStage =
  | "request"
  | "privy_resolver"
  | "supabase_repository"
  | "complete";
type SessionDiagnosticOutcome = "success" | "failure" | "timeout";
type SessionDiagnosticCode = AuthErrorCode
  | "OK"
  | "INVALID_SESSION_REQUEST"
  | "STAGE_TIMEOUT"
  | "OUTER_TIMEOUT"
  | "SESSION_SYNC_FAILED";
type SessionErrorName =
  | "AuthError"
  | "SyntaxError"
  | "ZodError"
  | "RequestTimeoutError"
  | "TypeError"
  | "Error"
  | "UnknownError";

export type SessionTimingSnapshot = Readonly<{
  stage: SessionDiagnosticStage;
  outcome: SessionDiagnosticOutcome;
  code: SessionDiagnosticCode;
  totalMs: number;
  privyMs: number;
  repositoryMs: number;
}>;

type SessionTimingLogger = (
  message: "[auth/session] timing",
  snapshot: SessionTimingSnapshot,
) => void;

function isKnownAuthErrorCode(code: unknown): code is AuthErrorCode {
  return typeof code === "string" && AUTH_ERROR_CODES.has(code as AuthErrorCode);
}

function diagnosticCode(error: unknown): Exclude<SessionDiagnosticCode, "OK" | "STAGE_TIMEOUT" | "OUTER_TIMEOUT"> {
  if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) {
    return "INVALID_SESSION_REQUEST";
  }
  if (error instanceof AuthError && isKnownAuthErrorCode(error.code)) return error.code;
  return "SESSION_SYNC_FAILED";
}

export function normalizedSessionError(error: unknown, outerTimeoutMs?: number): Readonly<{
  name: SessionErrorName;
  code: Exclude<SessionDiagnosticCode, "OK">;
}> {
  const name: SessionErrorName = error instanceof AuthError ? "AuthError"
    : error instanceof SyntaxError ? "SyntaxError"
    : error instanceof Error && error.name === "ZodError" ? "ZodError"
    : error instanceof RequestTimeoutError ? "RequestTimeoutError"
    : error instanceof TypeError ? "TypeError"
    : error instanceof Error ? "Error"
    : "UnknownError";
  const code = error instanceof RequestTimeoutError
    ? error.timeoutMs === outerTimeoutMs ? "OUTER_TIMEOUT" : "STAGE_TIMEOUT"
    : diagnosticCode(error);
  return Object.freeze({ name, code });
}

export function createSessionTimingDiagnostics(options: {
  timeoutMs: number;
  now?: () => number;
  logger?: SessionTimingLogger;
}) {
  const now = options.now ?? Date.now;
  const logger = options.logger ?? ((message, snapshot) => console.info(message, snapshot));
  const startedAt = now();
  let stage: SessionDiagnosticStage = "request";
  let stageStartedAt = startedAt;
  let privyMs = 0;
  let repositoryMs = 0;
  let sealed = false;

  const boundedMs = (value: number) => Math.min(
    options.timeoutMs,
    Math.max(0, Math.round(Number.isFinite(value) ? value : 0)),
  );

  const emit = (outcome: SessionDiagnosticOutcome, code: SessionDiagnosticCode) => {
    if (sealed) return;
    sealed = true;
    const endedAt = now();
    const snapshot = Object.freeze({
      stage,
      outcome,
      code,
      totalMs: boundedMs(endedAt - startedAt),
      privyMs: stage === "privy_resolver" ? boundedMs(endedAt - stageStartedAt) : privyMs,
      repositoryMs: stage === "supabase_repository" ? boundedMs(endedAt - stageStartedAt) : repositoryMs,
    });
    try {
      logger("[auth/session] timing", snapshot);
    } catch {
      // Diagnostics must never affect authentication.
    }
  };

  const wrapResolver = (resolver: PrivySessionResolver): PrivySessionResolver => ({
    async resolve(accessToken, chainId) {
      if (!sealed) {
        stage = "privy_resolver";
        stageStartedAt = now();
      }
      try {
        const result = await resolver.resolve(accessToken, chainId);
        if (!sealed) privyMs = boundedMs(now() - stageStartedAt);
        return result;
      } catch (error) {
        emit(
          error instanceof RequestTimeoutError ? "timeout" : "failure",
          error instanceof RequestTimeoutError ? "STAGE_TIMEOUT" : diagnosticCode(error),
        );
        throw error;
      }
    },
  });

  const wrapRepository = (repository: SessionSyncRepository): SessionSyncRepository => ({
    async sync(identity, wallet, preferredLocale) {
      if (!sealed) {
        stage = "supabase_repository";
        stageStartedAt = now();
      }
      try {
        const result = await repository.sync(identity, wallet, preferredLocale);
        if (!sealed) repositoryMs = boundedMs(now() - stageStartedAt);
        return result;
      } catch (error) {
        emit(
          error instanceof RequestTimeoutError ? "timeout" : "failure",
          error instanceof RequestTimeoutError ? "STAGE_TIMEOUT" : diagnosticCode(error),
        );
        throw error;
      }
    },
  });

  return {
    wrapResolver,
    wrapRepository,
    success() {
      if (!sealed) stage = "complete";
      emit("success", "OK");
    },
    failure(error: unknown) {
      emit(
        error instanceof RequestTimeoutError ? "timeout" : "failure",
        error instanceof RequestTimeoutError ? "OUTER_TIMEOUT" : diagnosticCode(error),
      );
    },
  };
}
