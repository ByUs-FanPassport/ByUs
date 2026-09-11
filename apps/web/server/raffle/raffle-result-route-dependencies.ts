import "server-only";
import { loadServerEnv } from "../config/env";
import { createBenefitFulfillmentRouteDependencies } from "../g4/benefit-fulfillment-route-dependencies";
import { createSupabaseRaffleResultRepository } from "./raffle-result-repository";
import type { RaffleResultRouteDependencies } from "./raffle-result-route";

export function createRaffleResultRouteDependencies(): RaffleResultRouteDependencies {
  const env = loadServerEnv();
  const { authorize } = createBenefitFulfillmentRouteDependencies();
  return { authorize, repository: createSupabaseRaffleResultRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }) };
}
