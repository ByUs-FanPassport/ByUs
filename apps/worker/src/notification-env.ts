import { z } from "zod";
const positive = z.coerce.number().int().positive();
const schema = z
  .object({
    NOTIFICATION_WORKER_ENABLED: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .default(false),
    NOTIFICATION_WORKER_ID: z.string().trim().min(3).max(120),
    NOTIFICATION_WORKER_BATCH_SIZE: positive.max(100).default(25),
    NOTIFICATION_WORKER_LEASE_SECONDS: positive.min(30).max(900).default(120),
    SUPABASE_URL: z
      .string()
      .url()
      .refine((v) => v.startsWith("https://")),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(40),
    WEB_PUSH_VAPID_SUBJECT: z
      .string()
      .refine((v) => v.startsWith("mailto:") || v.startsWith("https://")),
    WEB_PUSH_VAPID_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]{80,120}$/),
    WEB_PUSH_VAPID_PRIVATE_KEY: z.string().regex(/^[A-Za-z0-9_-]{40,60}$/),
  })
  .strict();
export type NotificationWorkerEnv = z.infer<typeof schema>;
export function parseNotificationEnv(
  source: NodeJS.ProcessEnv,
): NotificationWorkerEnv {
  const known = Object.fromEntries(
    Object.keys(schema.shape).map((key) => [key, source[key]]),
  );
  return schema.parse(known);
}
