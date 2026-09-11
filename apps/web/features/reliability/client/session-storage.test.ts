import { describe, expect, it } from "vitest";
import { createSessionStorage } from "./session-storage";

describe("navigation storage fallback", () => {
  it("keeps navigation data when the storage getter itself is blocked", () => {
    const storage = createSessionStorage(() => { throw new DOMException("blocked", "SecurityError"); });
    storage.setItem("intent", "same action");
    expect(storage.getItem("intent")).toBe("same action");
    storage.removeItem("intent");
    expect(storage.getItem("intent")).toBeNull();
  });

  it("keeps writes and deletions authoritative when a full store later recovers", () => {
    let blocked = true;
    const values = new Map([["intent", "old"], ["consumed", "old action"]]);
    const underlying = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { if (blocked) throw new DOMException("full", "QuotaExceededError"); values.set(key, value); },
      removeItem: (key: string) => { if (blocked) throw new DOMException("blocked", "SecurityError"); values.delete(key); },
    };
    const storage = createSessionStorage(() => underlying);
    storage.setItem("intent", "new");
    storage.removeItem("consumed");
    expect(storage.getItem("intent")).toBe("new");
    expect(storage.getItem("consumed")).toBeNull();
    blocked = false;
    expect(storage.getItem("intent")).toBe("new");
    expect(storage.getItem("consumed")).toBeNull();
    expect(values.get("intent")).toBe("new");
    expect(values.has("consumed")).toBe(false);
  });

  it("observes normal external clearing rather than reviving an old draft", () => {
    const values = new Map<string, string>();
    const storage = createSessionStorage(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
    }));
    storage.setItem("draft", "old");
    values.clear();
    expect(storage.getItem("draft")).toBeNull();
  });
});
