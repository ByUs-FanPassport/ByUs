import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FanOperationsRepositoryError, type FanOperationsRepository } from "./fan-operations-repository";

export type FanLoginProvider = "google" | "apple" | "email";
type PrivyUser = { id: string; linked_accounts: Array<{ type: string; verified_at?: number | null }> };
export type FanProviderClient = {
  users(): { _get(id: string, options: { signal: AbortSignal; timeout: number; maxRetries: number }): PromiseLike<PrivyUser> };
};
type CacheEntry = { expiresAt: number; providers: FanLoginProvider[] };
type ProviderCache = Map<string, CacheEntry>;
const providerCache: ProviderCache = new Map();
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_LIMIT = 500;

// Cache only provider enums, never emails or raw Privy user objects.
export function createFanProviderReader(input: {
  appId: string;
  client: FanProviderClient;
  cache?: ProviderCache;
  now?: () => number;
}) {
  const cache = input.cache ?? providerCache;
  const now = input.now ?? Date.now;
  return async (ids: string[]): Promise<Map<string, FanLoginProvider[] | null>> => {
    const result = new Map<string, FanLoginProvider[] | null>();
    const pending: string[] = [];
    for (const id of new Set(ids)) {
      const key = JSON.stringify([input.appId, id]);
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) result.set(id, [...cached.providers]);
      else {
        cache.delete(key);
        result.set(id, null);
        pending.push(id);
      }
    }
    if (!pending.length) return result;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_500);
    let next = 0;
    try {
      await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
        while (!controller.signal.aborted && next < pending.length) {
          const id = pending[next++];
          try {
            const user = await input.client.users()._get(id, { signal: controller.signal, timeout: 2_000, maxRetries: 0 });
            if (controller.signal.aborted || user.id !== id) continue;
            const verifiedTypes = new Set(user.linked_accounts.filter((account) =>
              typeof account.verified_at === "number" && account.verified_at > 0,
            ).map((account) => account.type));
            const providers = (["google", "apple", "email"] as const).filter((provider) =>
              verifiedTypes.has(provider === "email" ? "email" : `${provider}_oauth`),
            );
            result.set(id, providers);
            const key = JSON.stringify([input.appId, id]);
            if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
            cache.set(key, { expiresAt: now() + CACHE_TTL_MS, providers: [...providers] });
          } catch {
            // A provider outage must not hide the independently verified member email.
            // No raw upstream errors or user objects enter logs or the response.
          }
        }
      }));
    } finally {
      clearTimeout(timer);
    }
    return result;
  };
}

export function withFanAccountInfo(
  repository: FanOperationsRepository,
  database: Pick<SupabaseClient, "from">,
  readProviders: ReturnType<typeof createFanProviderReader>,
): FanOperationsRepository {
  return {
    ...repository,
    async list(input) {
      // Authorization and the read audit happen inside the existing RPC first.
      const page = await repository.list(input);
      if (!page.items.length) return page;
      const ids = page.items.map((fan) => fan.fanId);
      const { data, error } = await database.from("app_users")
        .select("id,verified_email,privy_user_id").in("id", ids);
      if (error || !data) throw new FanOperationsRepositoryError("UNAVAILABLE");
      const allowed = new Set(ids);
      const users = new Map(data.filter((user) => allowed.has(user.id)).map((user) => [user.id, user]));
      const providers = await readProviders([...users.values()].map((user) => user.privy_user_id));
      return {
        ...page,
        items: page.items.map((fan) => {
          const user = users.get(fan.fanId);
          return {
            ...fan,
            email: user?.verified_email ?? null,
            loginProviders: user ? providers.get(user.privy_user_id) ?? null : null,
          };
        }),
      };
    },
  };
}
