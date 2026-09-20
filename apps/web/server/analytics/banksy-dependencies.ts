import "server-only";
import { createBanksyPublicHandlers, createBanksyRepository } from "./banksy-campaign";
import { loadServerEnv } from "../config/env";

export function banksyRepository() {
  const env = loadServerEnv();
  return createBanksyRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
}
export function banksyPublicHandlers() { return createBanksyPublicHandlers(banksyRepository()); }
