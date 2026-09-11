export type SessionStorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Navigation and drafts only. Never use this as durable storage for ticket-spending requests. */
export function createSessionStorage(provider: () => SessionStorageAccess | null): SessionStorageAccess {
  const fallback = new Map<string, string>();
  const pending = new Map<string, string | null>();
  const store = () => {
    const storage = provider();
    if (!storage) throw new Error("Session storage unavailable");
    return storage;
  };
  return {
    getItem(key) {
      if (pending.has(key)) {
        const value = pending.get(key)!;
        try {
          if (value === null) store().removeItem(key);
          else store().setItem(key, value);
          pending.delete(key);
        } catch { /* Keep failed writes/deletions authoritative in this tab. */ }
        return value;
      }
      try {
        const value = store().getItem(key);
        if (value === null) fallback.delete(key);
        else fallback.set(key, value);
        return value;
      } catch {
        return fallback.get(key) ?? null;
      }
    },
    setItem(key, value) {
      fallback.set(key, value);
      try { store().setItem(key, value); pending.delete(key); }
      catch { pending.set(key, value); }
    },
    removeItem(key) {
      fallback.delete(key);
      try { store().removeItem(key); pending.delete(key); }
      catch { pending.set(key, null); }
    },
  };
}

const navigationStorage = createSessionStorage(() => typeof window === "undefined" ? null : window.sessionStorage);

export function getSessionStorage(): SessionStorageAccess {
  return navigationStorage;
}
