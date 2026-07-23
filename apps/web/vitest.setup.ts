import "@testing-library/jest-dom/vitest";

// Node 24 exposes an incomplete global localStorage when --localstorage-file is
// present without a path. Keep tests deterministic with the Storage contract.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    get length() { return storage.size; },
    clear() { storage.clear(); },
    getItem(key: string) { return storage.get(String(key)) ?? null; },
    key(index: number) { return [...storage.keys()][index] ?? null; },
    removeItem(key: string) { storage.delete(String(key)); },
    setItem(key: string, value: string) { storage.set(String(key), String(value)); },
  } satisfies Storage,
});
