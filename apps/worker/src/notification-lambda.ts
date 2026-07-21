import { z } from "zod";
import {
  parseNotificationEnv,
  type NotificationWorkerEnv,
} from "./notification-env.js";
const lambda = z
  .object({
    NOTIFICATION_WORKER_ENABLED: z.enum(["true", "false"]),
    NOTIFICATION_WORKER_ENVIRONMENT: z.enum(["dev", "prod"]),
    NOTIFICATION_WORKER_SECRET_ID: z.string().min(3),
  })
  .strict();
const invocation = z
  .object({
    source: z.literal("byus.notification-cron"),
    environment: z.enum(["dev", "prod"]),
  })
  .strict();
export function createNotificationLambdaHandler(
  deps: {
    loadSecret(id: string): Promise<string>;
    runWorker(env: NotificationWorkerEnv): Promise<number>;
  },
  source: Record<string, string | undefined>,
) {
  const config = lambda.parse({
    NOTIFICATION_WORKER_ENABLED: source.NOTIFICATION_WORKER_ENABLED,
    NOTIFICATION_WORKER_ENVIRONMENT: source.NOTIFICATION_WORKER_ENVIRONMENT,
    NOTIFICATION_WORKER_SECRET_ID: source.NOTIFICATION_WORKER_SECRET_ID,
  });
  return async (event: unknown) => {
    const input = invocation.parse(event);
    if (input.environment !== config.NOTIFICATION_WORKER_ENVIRONMENT)
      throw new Error("notification worker invocation environment mismatch");
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
