import { z } from "zod";
import { parseEnv, type WorkerEnv } from "./env.js";

const lambdaEnvironmentSchema = z.object({
  WORKER_ENABLED: z.enum(["true", "false"]),
  WORKER_ENVIRONMENT: z.enum(["dev", "prod"]),
  WORKER_SECRET_ID: z.string().min(3),
}).strict();

const invocationSchema = z.object({
  source: z.literal("byus.supabase-cron", { error: "invalid invocation source" }),
  environment: z.enum(["dev", "prod"]),
}).strict();

export interface LambdaWorkerDependencies {
  loadSecret(secretId: string): Promise<string>;
  runWorker(env: WorkerEnv): Promise<number>;
}

export function createLambdaHandler(
  dependencies: LambdaWorkerDependencies,
  sourceEnvironment: Record<string, string | undefined>,
) {
  const lambdaEnvironment = lambdaEnvironmentSchema.parse({
    WORKER_ENABLED: sourceEnvironment.WORKER_ENABLED,
    WORKER_ENVIRONMENT: sourceEnvironment.WORKER_ENVIRONMENT,
    WORKER_SECRET_ID: sourceEnvironment.WORKER_SECRET_ID,
  });

  return async (event: unknown): Promise<{ enabled: boolean; claimed: number }> => {
    const invocation = invocationSchema.parse(event);
    if (invocation.environment !== lambdaEnvironment.WORKER_ENVIRONMENT) {
      throw new Error("worker invocation environment mismatch");
    }
    if (lambdaEnvironment.WORKER_ENABLED === "false") {
      return { enabled: false, claimed: 0 };
    }

    const secretText = await dependencies.loadSecret(lambdaEnvironment.WORKER_SECRET_ID);
    const secret = JSON.parse(secretText) as Record<string, unknown>;
    const env = parseEnv({ ...secret, WORKER_ENABLED: "true" } as NodeJS.ProcessEnv);
    const claimed = await dependencies.runWorker(env);
    return { enabled: true, claimed };
  };
}
