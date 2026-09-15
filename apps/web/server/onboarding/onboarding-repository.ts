import "server-only";

import { createClient } from "@supabase/supabase-js";
import {
  onboardingStateSchema,
  type OnboardingState,
} from "../../features/onboarding/domain/onboarding-state";

interface RpcClient {
  rpc(
    name: string,
    parameters: Record<string, string>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface OnboardingRepository {
  get(appUserId: string): Promise<OnboardingState>;
  dismiss(appUserId: string): Promise<OnboardingState>;
}

export class SupabaseOnboardingRepository implements OnboardingRepository {
  constructor(private readonly client: RpcClient) {}

  get(appUserId: string): Promise<OnboardingState> {
    return this.call("read_owned_onboarding_state", appUserId);
  }

  dismiss(appUserId: string): Promise<OnboardingState> {
    return this.call("dismiss_owned_onboarding", appUserId);
  }

  private async call(name: string, appUserId: string): Promise<OnboardingState> {
    const { data, error } = await this.client.rpc(name, {
      p_app_user_id: appUserId,
    });
    if (error) throw new Error("ONBOARDING_UNAVAILABLE");

    const parsed = onboardingStateSchema.safeParse(data);
    if (!parsed.success) throw new Error("ONBOARDING_UNAVAILABLE");
    return parsed.data;
  }
}

export function createSupabaseOnboardingRepository(
  config: { url: string; serviceRoleKey: string },
  client?: RpcClient,
): OnboardingRepository {
  const database =
    client ??
    createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  return new SupabaseOnboardingRepository(database as unknown as RpcClient);
}
