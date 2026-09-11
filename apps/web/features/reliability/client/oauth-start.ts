import { RequestTimeoutError, withOperationDeadline } from "./request-deadline";

type OAuthStartState = "idle" | "starting" | "restart-required";

export function createOAuthStartGuard() {
  let state: OAuthStartState = "idle";
  const listeners = new Set<() => void>();
  const publish = (next: OAuthStartState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => state,
    getServerSnapshot: (): OAuthStartState => "idle",
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start(operation: () => Promise<void>, timeoutMs: number): Promise<void> | undefined {
      if (state !== "idle") return undefined;
      publish("starting");
      let pending: Promise<void>;
      try { pending = operation(); } catch (error) { pending = Promise.reject(error); }
      return withOperationDeadline(pending, timeoutMs).then(
        () => { publish("idle"); },
        (error: unknown) => {
          // A timeout does not cancel the SDK's redirect. Only a new document
          // can safely start over; keep this lock even if the old promise settles.
          publish(error instanceof RequestTimeoutError ? "restart-required" : "idle");
          throw error;
        },
      );
    },
  };
}

// Survives closing/reopening a login overlay or navigating within the SPA.
// No provider, account, token or redirect URL is stored here.
const documentGuard = createOAuthStartGuard();
export const getOAuthStartGuard = () => documentGuard;
