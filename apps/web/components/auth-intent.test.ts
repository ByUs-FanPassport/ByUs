import { describe, expect, it } from "vitest";
import {
  AUTH_INTENT_MAX_AGE_MS,
  authIntentReturnTo,
  buildAuthLoginHref,
  consumeAuthIntent,
  createAuthIntent,
  persistAuthIntent,
  readAuthIntent,
} from "./auth-intent";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const id = "11111111-1111-4111-8111-111111111111";

describe("creator home login compatibility", () => {
  it.each(["/ifewknow", "/c/ifewknow"])("restores and consumes %s with the same internal target", (sourcePath) => {
    const storage = new MemoryStorage();
    const intent = createAuthIntent({ sourcePath, sourceQuery: "?locale=en", actionType: "CREATE_REACTION", targetType: "celebrity", targetId: "ifewknow", returnAnchor: "#first-reaction" }, { id });
    persistAuthIntent(storage, intent);
    expect(authIntentReturnTo(readAuthIntent(storage, id)!)).toBe(`${sourcePath}?locale=en&authIntent=${id}#first-reaction`);
    expect(consumeAuthIntent(storage, id)?.targetId).toBe("ifewknow");
    expect(consumeAuthIntent(storage, id)).toBeNull();
  });
  it.each([["/elina", "ifewknow"], ["/login", "login"], ["/c/admin", "admin"], ["/ifew", "ifewknow"]])("rejects mismatched or reserved target %s %s", (sourcePath, targetId) => {
    expect(() => createAuthIntent({ sourcePath, sourceQuery: "", actionType: "CREATE_REACTION", targetType: "celebrity", targetId }, { id })).toThrow();
  });
});

describe("durable auth intent", () => {
  it("does not throw when browser storage reads or writes are unavailable", () => {
    const storage = new MemoryStorage();
    storage.getItem = () => { throw new DOMException("blocked", "SecurityError"); };
    storage.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
    storage.removeItem = () => { throw new DOMException("blocked", "SecurityError"); };
    const intent = createAuthIntent({ sourcePath: "/c/kara/verify", sourceQuery: "", actionType: "START_FAN_VERIFICATION", targetType: "celebrity", targetId: "kara" }, { id });
    expect(() => persistAuthIntent(storage, intent)).not.toThrow();
    expect(readAuthIntent(storage, id)).toBeNull();
    expect(consumeAuthIntent(storage, id)).toBeNull();
  });

  it("creates a bounded exact-action record and restores its URL", () => {
    const intent = createAuthIntent({
      sourcePath: "/live/kara-nualeaf",
      sourceQuery: "?locale=ko",
      actionType: "SUBMIT_FAN_CODE",
      targetType: "live_event",
      targetId: "kara-nualeaf",
      draftPayload: { draftRef: "byus:fan-code-draft:kara-nualeaf" },
      returnAnchor: "#fan-code",
    }, { id, now: 1_000 });

    expect(authIntentReturnTo(intent)).toBe("/live/kara-nualeaf?locale=ko&authIntent=11111111-1111-4111-8111-111111111111#fan-code");
    expect(buildAuthLoginHref(intent, "ko")).toBe(
      "/login?returnTo=%2Flive%2Fkara-nualeaf%3Flocale%3Dko%26authIntent%3D11111111-1111-4111-8111-111111111111%23fan-code&locale=ko&intent=attendance&entity=kara-nualeaf&authIntent=11111111-1111-4111-8111-111111111111",
    );
  });

  it("persists through navigation, expires safely, and is consumed once", () => {
    const storage = new MemoryStorage();
    const intent = createAuthIntent({
      sourcePath: "/live/kara-nualeaf",
      sourceQuery: "",
      actionType: "SUBMIT_FAN_CODE",
      targetType: "live_event",
      targetId: "kara-nualeaf",
      draftPayload: { draftRef: "byus:fan-code-draft:kara-nualeaf" },
    }, { id, now: 5_000 });
    persistAuthIntent(storage, intent);

    expect(readAuthIntent(storage, id, 5_001)).toEqual(intent);
    expect(consumeAuthIntent(storage, id, 5_001)).toEqual(intent);
    expect(readAuthIntent(storage, id)).toBeNull();

    persistAuthIntent(storage, intent);
    storage.setItem("byus:fan-code-draft:kara-nualeaf", "KARA-2026");
    expect(readAuthIntent(storage, id, 5_000 + AUTH_INTENT_MAX_AGE_MS)).toBeNull();
    expect(storage.getItem("byus:fan-code-draft:kara-nualeaf")).toBeNull();
  });

  it("retains only attendance drafts until their bounded event deadline", () => {
    const storage = new MemoryStorage();
    const input = { sourcePath: "/live/kara-nualeaf", sourceQuery: "?locale=ko", actionType: "SUBMIT_FAN_CODE" as const, targetType: "live_event" as const, targetId: "kara-nualeaf", draftPayload: { draftRef: "byus:fan-code-draft:kara-nualeaf" } };
    const intent = createAuthIntent(input, { id, now: 1_000, expiresAt: 10_801_000 });
    persistAuthIntent(storage, intent);
    storage.setItem(input.draftPayload.draftRef, "5VSD6N");
    expect(readAuthIntent(storage, id, 3_601_000)).not.toBeNull();
    expect(storage.getItem(input.draftPayload.draftRef)).toBe("5VSD6N");
    expect(readAuthIntent(storage, id, 10_801_000)).toBeNull();
    expect(storage.getItem(input.draftPayload.draftRef)).toBeNull();
    expect(() => createAuthIntent(input, { now: 1_000, expiresAt: 86_401_001 })).toThrow();
    expect(() => createAuthIntent({ ...input, actionType: "RESERVE_LIVE", draftPayload: {} }, { now: 1_000, expiresAt: 10_801_000 })).toThrow();
  });

  it("rejects unsafe routes, anchors, target identifiers, and oversized drafts", () => {
    const base = {
      sourceQuery: "",
      actionType: "OPEN_PASSPORT" as const,
      targetType: "passport" as const,
      targetId: "kara",
    };
    expect(() => createAuthIntent({ ...base, sourcePath: "https://evil.example" }, { id })).toThrow();
    expect(() => createAuthIntent({ ...base, sourcePath: "/passports", returnAnchor: "#bad value" }, { id })).toThrow();
    expect(() => createAuthIntent({ ...base, sourcePath: "/passports", targetId: "../secret" }, { id })).toThrow();
    expect(() => createAuthIntent({ ...base, sourcePath: "/passports", draftPayload: { value: "x".repeat(300) } }, { id })).toThrow();
    expect(() => createAuthIntent({ ...base, sourcePath: "/passports?locale=ko" }, { id })).toThrow();
    expect(() => createAuthIntent({ ...base, sourcePath: "/passports", targetType: "benefit" }, { id })).toThrow();
    expect(() => createAuthIntent({ ...base, sourcePath: "/benefits/kara" }, { id })).toThrow();
  });

  it("deletes malformed storage instead of restoring an untrusted action", () => {
    const storage = new MemoryStorage();
    storage.setItem(`byus:auth-intent:v1:${id}`, JSON.stringify({ actionType: "DELETE_ACCOUNT" }));
    expect(readAuthIntent(storage, id)).toBeNull();
    expect(storage.length).toBe(0);
  });
});

it("allows only the collection-view intent from the exact MY hub", () => {
  const input = {sourcePath:"/my", sourceQuery:"?locale=ko", actionType:"OPEN_PASSPORT", targetType:"passport", targetId:"collection"} as const;
  expect(createAuthIntent(input)).toMatchObject(input);
  for (const sourcePath of ["/my/other", "/my/issuance", "/settings", "https://evil.example", "//evil.example"]) {
    expect(() => createAuthIntent({...input, sourcePath})).toThrow();
  }
  expect(() => createAuthIntent({...input, targetId:"someone-else"})).toThrow();
  expect(() => createAuthIntent({...input, actionType:"RESERVE_LIVE", targetType:"live_event"})).toThrow();
  expect(() => createAuthIntent({...input, targetType:"benefit"})).toThrow();
});

it("allows APPLY_BENEFIT only from the exact matching creator raffle detail", () => {
  const benefitId = "22222222-2222-4222-8222-222222222222";
  const input = {
    sourcePath: `/c/kara/raffles/${benefitId}`,
    sourceQuery: "?locale=ko",
    actionType: "APPLY_BENEFIT",
    targetType: "benefit",
    targetId: benefitId,
  } as const;

  expect(createAuthIntent(input, { id })).toMatchObject(input);
  expect(() => createAuthIntent({
    ...input,
    targetId: "33333333-3333-4333-8333-333333333333",
  }, { id })).toThrow();
  expect(() => createAuthIntent({
    ...input,
    sourcePath: `/c/kara/gifts/${benefitId}`,
  }, { id })).toThrow();
  expect(() => createAuthIntent({
    ...input,
    actionType: "CLAIM_BENEFIT",
  }, { id })).toThrow();

  for (const sourcePath of [
    `/c/../raffles/${benefitId}`,
    `/c/%2e%2e/raffles/${benefitId}`,
    `/c/kara/raffles/${benefitId}/extra`,
    `/c/kara/raffles/${benefitId}%2Fextra`,
  ]) {
    expect(() => createAuthIntent({ ...input, sourcePath }, { id })).toThrow();
  }
});
