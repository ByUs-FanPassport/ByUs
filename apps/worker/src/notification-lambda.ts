import { z } from "zod";
import {
  parseNotificationEnv,
  type NotificationWorkerEnv,
} from "./notification-env.js";
import {
  parseBenefitMaintenanceEnv,
  type BenefitMaintenanceEnv,
  type BenefitMaintenanceResult,
} from "./benefit-maintenance.js";
const lambda = z
  .object({
    NOTIFICATION_WORKER_ENABLED: z.enum(["true", "false"]),
    NOTIFICATION_WORKER_ENVIRONMENT: z.enum(["dev", "prod"]),
    NOTIFICATION_WORKER_SECRET_ID: z.string().min(3),
    BENEFIT_MAINTENANCE_ENABLED: z.enum(["true", "false"]).default("false"),
  })
  .strict();
const invocation = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("byus.notification-cron"),
    environment: z.enum(["dev", "prod"]),
  }).strict(),
  z.object({
    source: z.literal("byus.maintenance-cron"),
    environment: z.enum(["dev", "prod"]),
    mode: z.literal("maintenance"),
  }).strict(),
]);

function emitMaintenanceMetric(
  environment: "dev" | "prod",
  result: BenefitMaintenanceResult,
) {
  console.log(JSON.stringify({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: "ByUs/Maintenance",
        Dimensions: [["Environment", "Mode"]],
        Metrics: [
          { Name: "Runs", Unit: "Count" },
          { Name: "Failures", Unit: "Count" },
          { Name: "DeletedCount", Unit: "Count" },
          { Name: "DurationMs", Unit: "Milliseconds" },
        ],
      }],
    },
    Environment: environment,
    Mode: "recipient-purge",
    Runs: 1,
    Failures: result.success ? 0 : 1,
    DeletedCount: result.deletedCount,
    DurationMs: result.durationMs,
    LastError: result.lastError,
  }));
}
export function createNotificationLambdaHandler(
  deps: {
    loadSecret(id: string): Promise<string>;
    runWorker(env: NotificationWorkerEnv): Promise<number>;
    runMaintenance?(env: BenefitMaintenanceEnv): Promise<BenefitMaintenanceResult>;
    emitMaintenanceMetric?: (
      environment: "dev" | "prod",
      result: BenefitMaintenanceResult,
    ) => void;
  },
  source: Record<string, string | undefined>,
) {
  const config = lambda.parse({
    NOTIFICATION_WORKER_ENABLED: source.NOTIFICATION_WORKER_ENABLED,
    NOTIFICATION_WORKER_ENVIRONMENT: source.NOTIFICATION_WORKER_ENVIRONMENT,
    NOTIFICATION_WORKER_SECRET_ID: source.NOTIFICATION_WORKER_SECRET_ID,
    BENEFIT_MAINTENANCE_ENABLED: source.BENEFIT_MAINTENANCE_ENABLED,
  });
  return async (event: unknown) => {
    const input = invocation.parse(event);
    if (input.environment !== config.NOTIFICATION_WORKER_ENVIRONMENT)
      throw new Error("notification worker invocation environment mismatch");
    if (input.source === "byus.maintenance-cron") {
      if (config.BENEFIT_MAINTENANCE_ENABLED === "false")
        return {
          enabled: false,
          mode: "maintenance" as const,
          success: true,
          deletedCount: 0,
          notificationJobsProcessed: 0,
          durationMs: 0,
          lastSuccessAt: null,
          lastError: null,
        };
      if (!deps.runMaintenance)
        throw new Error("benefit maintenance dependency is missing");
      const secret = JSON.parse(
        await deps.loadSecret(config.NOTIFICATION_WORKER_SECRET_ID),
      ) as NodeJS.ProcessEnv;
      const result = await deps.runMaintenance(parseBenefitMaintenanceEnv(secret));
      (deps.emitMaintenanceMetric ?? emitMaintenanceMetric)(input.environment, result);
      return {
        enabled: true,
        mode: "maintenance" as const,
        notificationJobsProcessed: 0,
        ...result,
      };
    }
    if (config.NOTIFICATION_WORKER_ENABLED === "false")
      return { enabled: false, claimed: 0 };
    const secret = JSON.parse(
      await deps.loadSecret(config.NOTIFICATION_WORKER_SECRET_ID),
    ) as NodeJS.ProcessEnv;
    const env = parseNotificationEnv({
      ...secret,
      NOTIFICATION_WORKER_ENABLED: "true",
    });
    return { enabled: true, claimed: await deps.runWorker(env) };
  };
}
