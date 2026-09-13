import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { homeBannerSchema, type HomeBanner } from "../../features/home/domain/home-banner";

type RpcClient = Pick<SupabaseClient, "rpc">;

export function createHomeBannerRepository(
  config: { url: string; serviceRoleKey: string },
  client?: RpcClient,
) {
  const db = client ?? createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async list(locale: "ko" | "en"): Promise<HomeBanner[]> {
      const { data, error } = await db.rpc("read_published_home_banners", { p_locale: locale });
      if (error) throw new Error(`HOME_BANNER_READ_FAILED: ${error.message}`);
      if (!Array.isArray(data)) throw new Error("HOME_BANNER_READ_FAILED: invalid RPC response");
      return data.flatMap((row) => {
        const parsed = homeBannerSchema.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      });
    },
  };
}
