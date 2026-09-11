import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BenefitCatalogItem } from "../domain/benefit";
import type { BenefitEntryResult } from "../domain/benefit-entry";
import { useRaffleEntry } from "./use-raffle-entry";

const benefitId = "11111111-1111-4111-8111-111111111111";
const operationId = "33333333-3333-4333-8333-333333333333";
const entryResult: BenefitEntryResult = {
  entryId: "44444444-4444-4444-8444-444444444444",
  benefitId,
  campaignId: "22222222-2222-4222-8222-222222222222",
  ticketAmount: 2,
  benefitTicketTotal: 2,
  perFanTicketLimit: 10,
  remainingBenefitTickets: 48,
  ticketLedgerId: "55555555-5555-4555-8555-555555555555",
  resultingBalance: 8,
  replayed: false,
};
const freshBenefit: BenefitCatalogItem = {
  id: benefitId,
  slug: "kara-raffle",
  title: "KARA 럭키드로우",
  summary: "응모권으로 참여합니다.",
  eligibilityLabel: "Silver 이상",
  deliveryLabel: "국내 배송",
  deliveryType: "unique_code",
  allocationMode: "direct_claim",
  applicationStatus: null,
  claimOpensAt: "2026-09-01T00:00:00.000Z",
  claimClosesAt: "2026-09-28T00:00:00.000Z",
  minimumScore: 0,
  minimumLevel: "Silver",
  requiredStampType: null,
  requiredActivityType: null,
  state: "eligible",
  entry: {
    fulfillmentPolicy: null,
    campaignId: entryResult.campaignId,
    creatorTicketBalance: 8,
    enteredTickets: 7,
    perFanTicketLimit: 10,
    remainingBenefitTickets: 43,
    entryOpensAt: "2026-09-01T00:00:00.000Z",
    entryClosesAt: "2026-09-28T00:00:00.000Z",
    canEnter: true,
    entries: [{
      entryId: entryResult.entryId,
      ticketAmount: 2,
      enteredAt: "2026-09-11T00:00:00.000Z",
    }],
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };
const jsonError = (status: number, code: string) =>
  Response.json({ error: { code } }, { status });

function renderEntry(
  ownerId: string | null = "owner-a",
  getAccessToken: () => Promise<string | null> = async () => "token",
) {
  const onAccepted = vi.fn();
  const onReconciled = vi.fn();
  const hook = renderHook(
    ({ owner, token }) => useRaffleEntry({
      ownerId: owner,
      benefitId,
      locale: "ko",
      getAccessToken: token,
      onAccepted,
      onReconciled,
    }),
    { initialProps: { owner: ownerId, token: getAccessToken } },
  );
  return { ...hook, onAccepted, onReconciled };
}

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(operationId);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("raffle entry controller", () => {
  it("times out token acquisition before POST and unlocks the same durable request", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderEntry("owner-a", () => new Promise<string | null>(() => undefined));

    let submission!: Promise<void>;
    act(() => { submission = result.current.submit({ ticketAmount: 2 }); });
    await vi.advanceTimersByTimeAsync(20_000);
    await act(async () => { await submission; });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBe("unavailable");
    expect(result.current.unresolvedRequest?.idempotencyKey).toBe(operationId);
    expect(sessionStorage).toHaveLength(1);
    vi.useRealTimers();
  });

  it("times out a stalled POST body, preserves the immutable request, and unlocks retry", async () => {
    vi.useFakeTimers();
    const stalledBody = new Response();
    vi.spyOn(stalledBody, "json").mockImplementation(() => new Promise(() => undefined));
    const fetcher = vi.fn().mockResolvedValue(stalledBody);
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderEntry();

    let submission!: Promise<void>;
    act(() => { submission = result.current.submit({ ticketAmount: 2 }); });
    await vi.advanceTimersByTimeAsync(20_000);
    await act(async () => { await submission; });

    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBe("uncertain");
    expect(result.current.unresolvedRequest).toEqual({ idempotencyKey: operationId, ticketAmount: 2 });
    expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!)).toEqual(result.current.unresolvedRequest);
    vi.useRealTimers();
  });

  it("keeps an accepted receipt when reconciliation times out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json(entryResult))
      .mockImplementationOnce(() => new Promise<Response>(() => undefined)));
    const { result } = renderEntry();

    let submission!: Promise<void>;
    act(() => { submission = result.current.submit({ ticketAmount: 2 }); });
    await vi.advanceTimersByTimeAsync(20_000);
    await act(async () => { await submission; });

    expect(result.current.receipt).toEqual(entryResult);
    expect(result.current.error).toBe("reconcile");
    expect(result.current.reconciling).toBe(false);
    vi.useRealTimers();
  });

  it("publishes a validated receipt immediately, then reconciles from the private benefit read", async () => {
    const read = deferred<Response>();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(entryResult))
      .mockImplementationOnce(() => read.promise);
    vi.stubGlobal("fetch", fetcher);
    const { result, onAccepted, onReconciled } = renderEntry();

    let submission!: Promise<void>;
    act(() => { submission = result.current.submit({ ticketAmount: 2 }); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    expect(result.current.receipt).toEqual(entryResult);
    expect(result.current.reconciling).toBe(true);
    expect(onAccepted).toHaveBeenCalledOnce();
    expect(onAccepted).toHaveBeenCalledWith(entryResult);
    expect(fetcher.mock.calls[0]).toEqual([
      `/api/benefits/${benefitId}/entries`,
      expect.objectContaining({
        method: "POST",
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: operationId, ticketAmount: 2 }),
      }),
    ]);
    expect(fetcher.mock.calls[1][0]).toBe(`/api/benefits/${benefitId}?locale=ko`);
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      headers: { authorization: "Bearer token" },
      cache: "no-store",
    });

    await act(async () => { read.resolve(Response.json({ benefit: freshBenefit })); await submission; });
    expect(onReconciled).toHaveBeenCalledWith(freshBenefit);
    expect(result.current.reconciled).toBe(true);
    expect(result.current.unresolvedRequest).toBeNull();
    expect(sessionStorage).toHaveLength(0);
  });

  it("clears a definitively rejected operation without publishing success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonError(409, "INSUFFICIENT_TICKETS")));
    const { result, onAccepted, onReconciled } = renderEntry();

    await act(async () => { await result.current.submit({ ticketAmount: 2 }); });

    expect(result.current.error).toBe("rejected");
    expect(result.current.unresolvedRequest).toBeNull();
    expect(onAccepted).not.toHaveBeenCalled();
    expect(onReconciled).not.toHaveBeenCalled();
    expect(sessionStorage).toHaveLength(0);
  });

  it("guards a double click before React has published pending state", async () => {
    const token = deferred<string | null>();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(entryResult))
      .mockResolvedValueOnce(Response.json({ benefit: freshBenefit }));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderEntry("owner-a", () => token.promise);

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.submit({ ticketAmount: 2 });
      second = result.current.submit({ ticketAmount: 2 });
    });
    await act(async () => { token.resolve("token"); await Promise.all([first, second]); });

    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("treats a missing token as a definite auth failure before POST", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderEntry("owner-a", async () => null);

    await act(async () => { await result.current.submit({ ticketAmount: 2 }); });

    expect(result.current.error).toBe("auth");
    expect(result.current.unresolvedRequest).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(sessionStorage).toHaveLength(0);
  });

  it.each([
    ["network failure", () => Promise.reject(new Error("offline"))],
    ["503 response", () => Promise.resolve(jsonError(503, "BENEFIT_UNAVAILABLE"))],
    ["malformed 200 response", () => Promise.resolve(Response.json({ replayed: false }))],
  ])("keeps the original operation after %s", async (_label, post) => {
    vi.stubGlobal("fetch", vi.fn(post));
    const { result } = renderEntry();

    await act(async () => { await result.current.submit({
      ticketAmount: 2,
      policyAcknowledgment: { policyVersion: "shipping-v1", canReceiveInKorea: true },
    }); });

    expect(result.current.error).toBe("uncertain");
    expect(result.current.unresolvedRequest).toEqual({
      idempotencyKey: operationId,
      ticketAmount: 2,
      policyAcknowledgment: { policyVersion: "shipping-v1", canReceiveInKorea: true },
    });
    expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!)).toEqual(result.current.unresolvedRequest);
  });

  it("uses the private read as current state when an idempotent replay follows another transaction", async () => {
    const replay = { ...entryResult, benefitTicketTotal: 2, remainingBenefitTickets: 48, replayed: true };
    const current = { ...freshBenefit, entry: { ...freshBenefit.entry!, enteredTickets: 7, remainingBenefitTickets: 43 } };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json(replay))
      .mockResolvedValueOnce(Response.json({ benefit: current })));
    const { result, onAccepted, onReconciled } = renderEntry();

    await act(async () => { await result.current.submit({ ticketAmount: 2 }); });

    expect(onAccepted).toHaveBeenCalledWith(replay);
    expect(onReconciled).toHaveBeenCalledWith(current);
    expect(result.current.receipt?.replayed).toBe(true);
    expect(result.current.reconciled).toBe(true);
  });

  it("clears a policy-conflict operation and signals the parent to refetch policy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonError(409, "RAFFLE_POLICY_ACK_REQUIRED")));
    const { result } = renderEntry();

    await act(async () => { await result.current.submit({
      ticketAmount: 2,
      policyAcknowledgment: { policyVersion: "shipping-v1", canReceiveInKorea: true },
    }); });

    expect(result.current.error).toBe("policy");
    expect(result.current.unresolvedRequest).toBeNull();
    expect(sessionStorage).toHaveLength(0);
  });

  it("restores an unresolved operation and retries its original payload despite changed input", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(Response.json({ ...entryResult, replayed: true }))
      .mockResolvedValueOnce(Response.json({ benefit: freshBenefit }));
    vi.stubGlobal("fetch", fetcher);
    const first = renderEntry();
    await act(async () => { await first.result.current.submit({ ticketAmount: 2 }); });
    first.unmount();

    const second = renderEntry();
    await waitFor(() => expect(second.result.current.unresolvedRequest?.ticketAmount).toBe(2));
    await act(async () => { await second.result.current.submit({
      ticketAmount: 9,
      policyAcknowledgment: { policyVersion: "changed", canReceiveInKorea: false },
    }); });

    const retriedBody = JSON.parse(fetcher.mock.calls[1][1].body as string);
    expect(retriedBody).toEqual({ idempotencyKey: operationId, ticketAmount: 2 });
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it("ignores and aborts owner A's late POST after switching to owner B", async () => {
    const latePost = deferred<Response>();
    const fetcher = vi.fn().mockImplementation(() => latePost.promise);
    vi.stubGlobal("fetch", fetcher);
    const onAccepted = vi.fn();
    const onReconciled = vi.fn();
    const { result, rerender } = renderHook(({ owner }) => useRaffleEntry({
      ownerId: owner,
      benefitId,
      getAccessToken: async () => "token",
      onAccepted,
      onReconciled,
    }), { initialProps: { owner: "owner-a" } });

    let submission!: Promise<void>;
    act(() => { submission = result.current.submit({ ticketAmount: 2 }); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
    rerender({ owner: "owner-b" });
    expect(signal.aborted).toBe(true);
    await act(async () => { latePost.resolve(Response.json(entryResult)); await submission; });

    expect(onAccepted).not.toHaveBeenCalled();
    expect(onReconciled).not.toHaveBeenCalled();
    expect(result.current.receipt).toBeNull();
    expect(result.current.unresolvedRequest).toBeNull();
  });

  it("does not POST when the owner changes while awaiting owner A's token", async () => {
    const oldToken = deferred<string | null>();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { result, rerender } = renderHook(({ owner, token }) => useRaffleEntry({
      ownerId: owner,
      benefitId,
      getAccessToken: token,
      onAccepted: vi.fn(),
      onReconciled: vi.fn(),
    }), { initialProps: { owner: "owner-a", token: () => oldToken.promise } });

    let submission!: Promise<void>;
    act(() => { submission = result.current.submit({ ticketAmount: 2 }); });
    rerender({ owner: "owner-b", token: async () => "owner-b-token" });
    await act(async () => { oldToken.resolve("owner-a-token"); await submission; });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });

  it("does not POST or publish callbacks after unmounting while the access token is pending", async () => {
    const token = deferred<string | null>();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { result, unmount, onAccepted, onReconciled } = renderEntry(
      "owner-a",
      () => token.promise,
    );

    let submission!: Promise<void>;
    act(() => { submission = result.current.submit({ ticketAmount: 2 }); });
    unmount();
    await act(async () => { token.resolve("owner-a-token"); await submission; });

    expect(fetcher).not.toHaveBeenCalled();
    expect(onAccepted).not.toHaveBeenCalled();
    expect(onReconciled).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing retry token", null],
    ["a retry 401", 401],
    ["a retry 403", 403],
    ["a retry 429", 429],
  ] as const)("preserves a possibly committed request through %s until a valid replay", async (_label, retryFailure) => {
    let tokenRead = 0;
    const getToken = vi.fn(async () => {
      tokenRead += 1;
      return retryFailure === null && tokenRead === 2 ? null : "token";
    });
    let postCount = 0;
    const fetcher = vi.fn().mockImplementation((input, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        if (postCount === 1) return Promise.reject(new Error("response lost"));
        if (retryFailure !== null && postCount === 2) {
          return Promise.resolve(Response.json(
            { error: { code: retryFailure === 429 ? "RATE_LIMITED" : "AUTHENTICATION_REQUIRED" } },
            { status: retryFailure },
          ));
        }
        return Promise.resolve(Response.json({ ...entryResult, replayed: true }));
      }
      expect(String(input)).toBe(`/api/benefits/${benefitId}?locale=ko`);
      return Promise.resolve(Response.json({ benefit: freshBenefit }));
    });
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderEntry("owner-a", getToken);

    await act(async () => { await result.current.submit({
      ticketAmount: 2,
      policyAcknowledgment: { policyVersion: "shipping-v1", canReceiveInKorea: true },
    }); });
    const original = result.current.unresolvedRequest;
    expect(original).not.toBeNull();

    await act(async () => { await result.current.retry(); });
    expect(result.current.unresolvedRequest).toEqual(original);
    expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!)).toEqual(original);

    await act(async () => { await result.current.retry(); });
    const postBodies = fetcher.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => init?.body);
    expect(postBodies.length).toBe(retryFailure === null ? 2 : 3);
    expect(new Set(postBodies)).toEqual(new Set([JSON.stringify(original)]));
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
    expect(result.current.unresolvedRequest).toBeNull();
    expect(result.current.reconciled).toBe(true);
  });

  it("blocks POST on durable storage failure and retries the same in-memory key once storage recovers", async () => {
    const originalSetItem = Storage.prototype.setItem;
    let fail = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (fail) { fail = false; throw new Error("quota exceeded"); }
      return Reflect.apply(originalSetItem, this, [key, value]);
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(entryResult))
      .mockResolvedValueOnce(Response.json({ benefit: freshBenefit }));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderEntry();

    await act(async () => { await result.current.submit({ ticketAmount: 2 }); });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.error).toBe("storage");
    expect(result.current.unresolvedRequest?.idempotencyKey).toBe(operationId);

    await act(async () => { await result.current.retry(); });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string).idempotencyKey).toBe(operationId);
    expect(result.current.reconciled).toBe(true);
  });

  it("retries reconciliation without repeating an accepted POST", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(entryResult))
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValueOnce(Response.json({ benefit: freshBenefit }));
    vi.stubGlobal("fetch", fetcher);
    const { result, onAccepted, onReconciled } = renderEntry();

    await act(async () => { await result.current.submit({ ticketAmount: 2 }); });
    expect(result.current.error).toBe("reconcile");
    expect(result.current.reconciled).toBe(false);
    act(() => result.current.clearReceipt());
    expect(result.current.receipt).toEqual(entryResult);

    await act(async () => { await result.current.retryReconciliation(); });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(onAccepted).toHaveBeenCalledOnce();
    expect(onReconciled).toHaveBeenCalledWith(freshBenefit);
    expect(result.current.error).toBeNull();
    expect(result.current.reconciled).toBe(true);
    act(() => result.current.clearReceipt());
    expect(result.current.receipt).toBeNull();
  });

  it("does not let parent callback errors turn a validated server result into an uncertain retry", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(entryResult))
      .mockResolvedValueOnce(Response.json({ benefit: freshBenefit }));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useRaffleEntry({
      ownerId: "owner-a",
      benefitId,
      getAccessToken: async () => "token",
      onAccepted: () => { throw new Error("parent update failed"); },
      onReconciled: () => { throw new Error("parent reconciliation failed"); },
    }));

    await act(async () => { await result.current.submit({ ticketAmount: 2 }); });

    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.reconciled).toBe(true);
    expect(result.current.unresolvedRequest).toBeNull();
  });
});
