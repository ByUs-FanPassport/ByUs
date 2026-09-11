"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  benefitCatalogItemSchema,
  type BenefitCatalogItem,
  type BenefitLocale,
} from "../domain/benefit";
import {
  benefitEntryResultSchema,
  enterBenefitRequestSchema,
  type BenefitEntryResult,
} from "../domain/benefit-entry";
import type { EntryPolicyAcknowledgment } from "../domain/raffle-fulfillment-policy";
import {
  reportRecoveryFailure,
  withOperationDeadline,
  withRequestDeadline,
} from "@/features/reliability/client/request-deadline";

export type RaffleEntryRequest = Readonly<{
  idempotencyKey: string;
  ticketAmount: number;
  policyAcknowledgment?: Readonly<EntryPolicyAcknowledgment>;
}>;

export type RaffleEntryError =
  | "auth"
  | "rejected"
  | "uncertain"
  | "unavailable"
  | "storage"
  | "policy"
  | "reconcile";

type SubmitInput = {
  ticketAmount: number;
  policyAcknowledgment?: EntryPolicyAcknowledgment;
};

type UseRaffleEntryInput = {
  ownerId: string | null;
  benefitId: string;
  locale?: BenefitLocale;
  getAccessToken: () => Promise<string | null>;
  onAccepted: (result: BenefitEntryResult) => void;
  onReconciled: (benefit: BenefitCatalogItem) => void;
};

type PublicState = {
  pending: boolean;
  unresolvedRequest: RaffleEntryRequest | null;
  receipt: BenefitEntryResult | null;
  error: RaffleEntryError | null;
  reconciling: boolean;
  reconciled: boolean;
};

type Snapshot = PublicState & { identity: string };

type Runtime = {
  identity: string;
  generation: number;
  operation: Promise<void> | null;
  reconciliation: Promise<void> | null;
  controllers: Set<AbortController>;
  unresolvedRequest: RaffleEntryRequest | null;
  requestIsDurable: boolean;
  mayHaveCommitted: boolean;
  storageBlocked: boolean;
  receipt: BenefitEntryResult | null;
  reconciled: boolean;
};

const emptyState: PublicState = {
  pending: false,
  unresolvedRequest: null,
  receipt: null,
  error: null,
  reconciling: false,
  reconciled: false,
};

function storageKey(ownerId: string, benefitId: string) {
  return `byus:raffle-entry:v1:${encodeURIComponent(ownerId)}:${encodeURIComponent(benefitId)}`;
}

function freezeRequest(value: {
  idempotencyKey: string;
  ticketAmount: number;
  policyAcknowledgment?: EntryPolicyAcknowledgment;
}): RaffleEntryRequest {
  const policyAcknowledgment = value.policyAcknowledgment
    ? Object.freeze({ ...value.policyAcknowledgment })
    : undefined;
  return Object.freeze({
    idempotencyKey: value.idempotencyKey,
    ticketAmount: value.ticketAmount,
    ...(policyAcknowledgment ? { policyAcknowledgment } : {}),
  });
}

function readErrorCode(response: Response): Promise<string | null> {
  return response.clone().json().then((body: unknown) => {
    if (!body || typeof body !== "object") return null;
    const value = body as { code?: unknown; error?: unknown };
    if (typeof value.code === "string") return value.code;
    if (typeof value.error === "string") return value.error;
    if (value.error && typeof value.error === "object") {
      const code = (value.error as { code?: unknown }).code;
      return typeof code === "string" ? code : null;
    }
    return null;
  }).catch(() => null);
}

function notifyParent(callback: () => void) {
  try {
    callback();
  } catch {
    // A parent render/update failure cannot change the server transaction state.
  }
}

export function useRaffleEntry({
  ownerId,
  benefitId,
  locale = "ko",
  getAccessToken,
  onAccepted,
  onReconciled,
}: UseRaffleEntryInput) {
  const identity = `${ownerId ?? ""}:${benefitId}`;
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const callbacksRef = useRef({ getAccessToken, onAccepted, onReconciled });
  const runtimeRef = useRef<Runtime>({
    identity,
    generation: 0,
    operation: null,
    reconciliation: null,
    controllers: new Set(),
    unresolvedRequest: null,
    requestIsDurable: false,
    mayHaveCommitted: false,
    storageBlocked: false,
    receipt: null,
    reconciled: false,
  });

  useEffect(() => {
    callbacksRef.current = { getAccessToken, onAccepted, onReconciled };
  }, [getAccessToken, onAccepted, onReconciled]);

  const publish = useCallback(
    (runtime: Runtime, next: Partial<PublicState>) => {
      if (runtimeRef.current !== runtime || runtime.identity !== identity) return;
      setSnapshot((current) => ({
        ...(current?.identity === identity ? current : emptyState),
        ...next,
        identity,
      }));
    },
    [identity],
  );

  useEffect(() => {
    const previous = runtimeRef.current;
    previous.controllers.forEach((controller) => controller.abort());
    let restoredRequest: RaffleEntryRequest | null = null;
    let storageBlocked = false;
    try {
      if (ownerId) {
        const serialized = window.sessionStorage.getItem(storageKey(ownerId, benefitId));
        if (serialized) {
          const parsed = enterBenefitRequestSchema.safeParse(JSON.parse(serialized));
          if (parsed.success) restoredRequest = freezeRequest(parsed.data);
          else storageBlocked = true;
        }
      }
    } catch {
      storageBlocked = true;
    }
    const runtime: Runtime = {
      identity,
      generation: previous.generation + 1,
      operation: null,
      reconciliation: null,
      controllers: new Set(),
      unresolvedRequest: restoredRequest,
      requestIsDurable: restoredRequest !== null,
      mayHaveCommitted: restoredRequest !== null,
      storageBlocked,
      receipt: null,
      reconciled: false,
    };
    runtimeRef.current = runtime;
    const generation = runtime.generation;
    publish(runtime, restoredRequest
      ? { ...emptyState, unresolvedRequest: restoredRequest, error: "uncertain" }
      : storageBlocked
        ? { ...emptyState, error: "storage" }
        : emptyState);
    return () => {
      if (runtime.generation === generation) {
        runtime.generation += 1;
        runtime.controllers.forEach((controller) => controller.abort());
      }
    };
  }, [benefitId, identity, ownerId, publish]);

  const isCurrent = useCallback(
    (runtime: Runtime, generation: number) =>
      runtimeRef.current === runtime &&
      runtime.identity === identity &&
      runtime.generation === generation,
    [identity],
  );

  const clearStoredRequest = useCallback((runtime: Runtime) => {
    if (ownerId) {
      try {
        window.sessionStorage.removeItem(storageKey(ownerId, benefitId));
      } catch {
        // Replaying the same idempotency key on a later mount remains safe.
      }
    }
    runtime.unresolvedRequest = null;
    runtime.requestIsDurable = false;
    runtime.mayHaveCommitted = false;
  }, [benefitId, ownerId]);

  const reconcile = useCallback(async (runtime: Runtime, generation: number) => {
    if (!isCurrent(runtime, generation) || runtime.reconciliation) {
      return runtime.reconciliation ?? Promise.resolve();
    }
    const operation = (async () => {
      publish(runtime, { reconciling: true, reconciled: false, error: null });
      let controller: AbortController | null = null;
      try {
        const token = await withOperationDeadline(callbacksRef.current.getAccessToken());
        if (!isCurrent(runtime, generation)) return;
        if (!token) throw new Error("Missing reconciliation token");
        controller = new AbortController();
        runtime.controllers.add(controller);
        const benefit = await withRequestDeadline(async (signal) => {
          const response = await fetch(`/api/benefits/${encodeURIComponent(benefitId)}?locale=${locale}`, {
            headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal,
          });
          if (!response.ok) throw new Error("Benefit reconciliation failed");
          return benefitCatalogItemSchema.parse((await response.json() as { benefit?: unknown }).benefit);
        }, { signal: controller.signal });
        if (benefit.id !== benefitId || !benefit.entry) throw new Error("Invalid reconciliation identity");
        if (!isCurrent(runtime, generation)) return;
        runtime.reconciled = true;
        publish(runtime, { reconciling: false, reconciled: true, error: null });
        notifyParent(() => callbacksRef.current.onReconciled(benefit));
      } catch (error) {
        reportRecoveryFailure("raffle.reconcile", error);
        if (!isCurrent(runtime, generation)) return;
        runtime.reconciled = false;
        publish(runtime, { reconciling: false, reconciled: false, error: "reconcile" });
      } finally {
        if (controller) runtime.controllers.delete(controller);
      }
    })();
    runtime.reconciliation = operation;
    try {
      await operation;
    } finally {
      if (runtime.reconciliation === operation) runtime.reconciliation = null;
    }
  }, [benefitId, isCurrent, locale, publish]);

  const runRequest = useCallback(async (runtime: Runtime, request: RaffleEntryRequest) => {
    const generation = runtime.generation;
    publish(runtime, {
      pending: true,
      error: null,
      unresolvedRequest: request,
      receipt: null,
      reconciled: false,
      reconciling: false,
    });

    if (!runtime.requestIsDurable) {
      try {
        if (!ownerId) throw new Error("Missing owner");
        window.sessionStorage.setItem(storageKey(ownerId, benefitId), JSON.stringify(request));
        runtime.requestIsDurable = true;
      } catch {
        if (isCurrent(runtime, generation)) {
          publish(runtime, { pending: false, error: "storage", unresolvedRequest: request });
        }
        return;
      }
    }

    let token: string | null;
    try {
      token = await withOperationDeadline(callbacksRef.current.getAccessToken());
    } catch (error) {
      reportRecoveryFailure("raffle.token", error);
      if (isCurrent(runtime, generation)) {
        publish(runtime, { pending: false, unresolvedRequest: request, error: "unavailable" });
      }
      return;
    }
    if (!isCurrent(runtime, generation)) return;
    if (!token) {
      token = null;
      if (!runtime.mayHaveCommitted) clearStoredRequest(runtime);
      publish(runtime, { pending: false, unresolvedRequest: runtime.unresolvedRequest, error: "auth" });
      return;
    }

    const controller = new AbortController();
    runtime.controllers.add(controller);
    const previousAttemptUncertain = runtime.mayHaveCommitted;
    runtime.mayHaveCommitted = true;
    try {
      const outcome = await withRequestDeadline(async (signal) => {
        const response = await fetch(`/api/benefits/${encodeURIComponent(benefitId)}/entries`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(request), signal,
        });
        if (!response.ok) return { ok: false as const, status: response.status, code: await readErrorCode(response) };
        return { ok: true as const, result: benefitEntryResultSchema.parse(await response.json()) };
      }, { signal: controller.signal });
      if (!isCurrent(runtime, generation)) return;
      if (!outcome.ok) {
        if (outcome.status >= 400 && outcome.status < 500) {
          const code = outcome.code;
          if (!isCurrent(runtime, generation)) return;
          if (previousAttemptUncertain) {
            // An auth/proxy rejection on this retry says nothing about the earlier POST.
            publish(runtime, { pending: false, unresolvedRequest: request, error: "uncertain" });
            return;
          }
          clearStoredRequest(runtime);
          publish(runtime, {
            pending: false,
            unresolvedRequest: null,
            error: code === "RAFFLE_POLICY_ACK_REQUIRED"
              ? "policy"
              : outcome.status === 401 || outcome.status === 403
                ? "auth"
                : "rejected",
          });
          return;
        }
        throw new Error("Uncertain raffle response");
      }
      const result = outcome.result;
      if (result.benefitId !== benefitId || result.ticketAmount !== request.ticketAmount) throw new Error("Invalid entry receipt identity");
      if (!isCurrent(runtime, generation)) return;
      clearStoredRequest(runtime);
      runtime.receipt = result;
      runtime.reconciled = false;
      publish(runtime, {
        pending: false,
        unresolvedRequest: null,
        receipt: result,
        error: null,
        reconciled: false,
      });
      notifyParent(() => callbacksRef.current.onAccepted(result));
      await reconcile(runtime, generation);
    } catch (error) {
      reportRecoveryFailure("raffle.submit", error);
      if (!isCurrent(runtime, generation)) return;
      publish(runtime, {
        pending: false,
        unresolvedRequest: request,
        error: "uncertain",
      });
    } finally {
      runtime.controllers.delete(controller);
      if (isCurrent(runtime, generation)) publish(runtime, { pending: false });
    }
  }, [benefitId, clearStoredRequest, isCurrent, ownerId, publish, reconcile]);

  const submit = useCallback((input: SubmitInput): Promise<void> => {
    const runtime = runtimeRef.current;
    if (runtime.identity !== identity) return Promise.resolve();
    if (runtime.operation) return runtime.operation;
    if (!ownerId) {
      publish(runtime, { error: "auth" });
      return Promise.resolve();
    }
    if (runtime.receipt && !runtime.reconciled) return Promise.resolve();

    let request = runtime.unresolvedRequest;
    if (!request) {
      if (runtime.storageBlocked) {
        publish(runtime, { error: "storage" });
        return Promise.resolve();
      }
      let candidate;
      try {
        candidate = enterBenefitRequestSchema.parse({
          idempotencyKey: crypto.randomUUID(),
          ticketAmount: input.ticketAmount,
          ...(input.policyAcknowledgment
            ? { policyAcknowledgment: input.policyAcknowledgment }
            : {}),
        });
      } catch {
        publish(runtime, { error: "rejected" });
        return Promise.resolve();
      }
      request = freezeRequest(candidate);
      runtime.unresolvedRequest = request;
      runtime.requestIsDurable = false;
    }

    const operation = runRequest(runtime, request);
    runtime.operation = operation;
    void operation.finally(() => {
      if (runtime.operation === operation) runtime.operation = null;
    });
    return operation;
  }, [identity, ownerId, publish, runRequest]);

  const retry = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime.unresolvedRequest || runtime.operation) return runtime.operation ?? Promise.resolve();
    const operation = runRequest(runtime, runtime.unresolvedRequest);
    runtime.operation = operation;
    void operation.finally(() => {
      if (runtime.operation === operation) runtime.operation = null;
    });
    return operation;
  }, [runRequest]);

  const retryReconciliation = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime.receipt || runtime.reconciled) return Promise.resolve();
    return reconcile(runtime, runtime.generation);
  }, [reconcile]);

  const clearReceipt = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime.receipt || !runtime.reconciled || runtime.unresolvedRequest) return;
    runtime.receipt = null;
    publish(runtime, { receipt: null });
  }, [publish]);

  const state = snapshot?.identity === identity ? snapshot : emptyState;
  return {
    pending: state.pending,
    unresolvedRequest: state.unresolvedRequest,
    receipt: state.receipt,
    error: state.error,
    reconciling: state.reconciling,
    reconciled: state.reconciled,
    submit,
    retry,
    retryReconciliation,
    clearReceipt,
  };
}
