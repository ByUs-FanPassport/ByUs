import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

type RpcClient = Pick<SupabaseClient, "rpc">;

export type BenefitMaintenanceResult = {
  success: boolean;
  deletedCount: number;
  durationMs: number;
  lastSuccessAt: string | null;
  lastError: "PURGE_RPC_FAILED" | "PURGE_EVIDENCE_FAILED" | null;
};

const maintenanceEnv = z
  .object({
    SUPABASE_URL: z.string().url().refine((value) => value.startsWith("https://")),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(40),
  })
  .strict();
export type BenefitMaintenanceEnv = z.infer<typeof maintenanceEnv>;

export function parseBenefitMaintenanceEnv(source: NodeJS.ProcessEnv) {
  return maintenanceEnv.parse({
    SUPABASE_URL: source.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
  });
}

export function normalizeMaintenanceError(
  _error: unknown,
): "PURGE_RPC_FAILED" {
  return "PURGE_RPC_FAILED";
}

export class BenefitMaintenance {
  constructor(
    private readonly client: RpcClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async runOnce(): Promise<BenefitMaintenanceResult> {
    const startedAt = this.clock();
    let deletedCount = 0;
    let lastError: BenefitMaintenanceResult["lastError"] = null;
    try {
      const { data, error } = await this.client.rpc(
        "purge_due_benefit_recipient_private",
        { p_now: startedAt.toISOString() },
      );
      if (error) throw new Error("recipient purge RPC failed");
      deletedCount = Number(data ?? 0);
      if (!Number.isSafeInteger(deletedCount) || deletedCount < 0)
        throw new Error("recipient purge RPC returned invalid count");
    } catch (error) {
      lastError = normalizeMaintenanceError(error);
    }

    const finishedAt = this.clock();
    const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
    const evidence = await this.client.rpc("record_benefit_recipient_purge_run", {
      p_started_at: startedAt.toISOString(),
      p_finished_at: finishedAt.toISOString(),
      p_deleted_count: deletedCount,
      p_error_code: lastError,
    });
    if (evidence.error) lastError = "PURGE_EVIDENCE_FAILED";

    return {
      success: lastError === null,
      deletedCount,
      durationMs,
      lastSuccessAt: lastError === null ? finishedAt.toISOString() : null,
      lastError,
    };
  }
}

export function createBenefitMaintenance(url: string, key: string) {
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return new BenefitMaintenance(client);
}

export function runBenefitMaintenanceOnce(env: BenefitMaintenanceEnv) {
  return createBenefitMaintenance(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
  ).runOnce();
}
