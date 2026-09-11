export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export class RequestTimeoutError extends Error {
  constructor(readonly timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    super("Request deadline exceeded");
    this.name = "RequestTimeoutError";
  }
}

/** A deadline is an unknown outcome, never evidence that a mutation was rolled back. */
export function withRequestDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new RangeError("Invalid request deadline"));
  if (options.signal?.aborted) return Promise.reject(new DOMException("Request cancelled", "AbortError"));

  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      done();
    };
    const onAbort = () => {
      finish(() => reject(new DOMException("Request cancelled", "AbortError")));
      controller.abort();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new RequestTimeoutError(timeoutMs)));
      controller.abort();
    }, timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new DOMException("Request cancelled", "AbortError");
      return request(controller.signal);
    }).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

/** Does not cancel the SDK operation. Callers must retain in-flight mutations until they settle. */
export function withOperationDeadline<T>(operation: Promise<T>, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
  return withRequestDeadline(() => operation, { timeoutMs });
}

const recoveryStages = new Set([
  "login.ready", "login.oauth", "login.user", "login.wallet", "login.token", "login.session", "login.reauthentication",
  "reservation.submit", "reservation.reconcile", "attendance.submit", "live.load",
  "quiz.load", "quiz.submit", "quiz.reconcile",
  "raffle.token", "raffle.submit", "raffle.reconcile",
  "storage.read", "storage.write", "profile.load", "profile.save",
  "session.request", "session.identity", "session.locale", "session.notification", "session.notification_fallback", "session.profile",
]);

export function reportRecoveryFailure(stage: string, error: unknown): void {
  const code = error instanceof RequestTimeoutError ? "TIMEOUT"
    : error instanceof Error && error.name === "AbortError" ? "ABORTED"
    : error instanceof TypeError ? "NETWORK_ERROR" : "FAILED";
  console.warn("[fan-flow] recovery required", {
    stage: recoveryStages.has(stage) ? stage : "unknown",
    code,
  });
}
