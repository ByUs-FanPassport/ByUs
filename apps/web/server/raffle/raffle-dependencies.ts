import "server-only";
import { loadServerEnv } from "../config/env";
import { createSupabaseRaffleRepository } from "./raffle-repository";

export function createRaffleDependencies() {
  const environment = loadServerEnv();
  return createSupabaseRaffleRepository({
    url: environment.SUPABASE_URL,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  });
}
