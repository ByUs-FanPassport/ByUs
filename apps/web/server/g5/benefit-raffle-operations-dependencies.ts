import "server-only";
import { createBenefitFulfillmentAdminRouteDependencies } from "./benefit-fulfillment-admin-route-dependencies";
import { createRaffleOperationsRepository } from "./benefit-raffle-operations";
import { loadServerEnv } from "../config/env";
export function createRaffleOperationsDependencies() {
  const { authorize } = createBenefitFulfillmentAdminRouteDependencies();
  const env = loadServerEnv();
  return { authorize, repository: createRaffleOperationsRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }) };
}
