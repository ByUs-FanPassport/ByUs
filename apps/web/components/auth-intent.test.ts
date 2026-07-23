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

describe("durable auth intent", () => {
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
