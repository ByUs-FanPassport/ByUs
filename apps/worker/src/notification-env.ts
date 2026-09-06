import { z } from "zod";
const positive = z.coerce.number().int().positive();
const baseSchema = z
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
    NOTIFICATION_EXTERNAL_MODE: z.enum(["disabled","test_sink","provider","ses_email"]).default("disabled"),
    NOTIFICATION_EXTERNAL_ENVIRONMENT: z.enum(["dev","prod"]).default("dev"),
    SES_REGION: z.literal("ap-northeast-2").optional(),
    SES_FROM_EMAIL: z.literal("notifications@byus.kr").optional(),
    EMAIL_PROVIDER_URL: z.string().url().refine((v)=>v.startsWith("https://")).optional(),
    EMAIL_PROVIDER_TOKEN: z.string().min(16).optional(),
    KAKAO_PROVIDER_URL: z.string().url().refine((v)=>v.startsWith("https://")).optional(),
    KAKAO_PROVIDER_TOKEN: z.string().min(16).optional(),
  })
  .strict();
const schema=baseSchema.superRefine((v,ctx)=>{if(v.NOTIFICATION_EXTERNAL_MODE==="ses_email"&&v.NOTIFICATION_WORKER_BATCH_SIZE>2)ctx.addIssue({code:"custom",path:["NOTIFICATION_WORKER_BATCH_SIZE"],message:"SES mode requires batch size at most 2 to bound sequential send time"});if(v.NOTIFICATION_EXTERNAL_MODE==="ses_email"&&(!v.SES_REGION||!v.SES_FROM_EMAIL))ctx.addIssue({code:"custom",path:["NOTIFICATION_EXTERNAL_MODE"],message:"SES email mode requires region and sender"});if(v.NOTIFICATION_EXTERNAL_MODE==="test_sink"&&v.NOTIFICATION_EXTERNAL_ENVIRONMENT!=="dev")ctx.addIssue({code:"custom",path:["NOTIFICATION_EXTERNAL_MODE"],message:"test sink is Dev-only"});if(v.NOTIFICATION_EXTERNAL_MODE==="provider"&&(!v.EMAIL_PROVIDER_URL||!v.EMAIL_PROVIDER_TOKEN||!v.KAKAO_PROVIDER_URL||!v.KAKAO_PROVIDER_TOKEN))ctx.addIssue({code:"custom",path:["NOTIFICATION_EXTERNAL_MODE"],message:"provider mode requires both sandbox providers"});});
export type NotificationWorkerEnv = z.infer<typeof schema>;
export function parseNotificationEnv(
  source: NodeJS.ProcessEnv,
): NotificationWorkerEnv {
  const known = Object.fromEntries(
    Object.keys(baseSchema.shape).map((key) => [key, source[key]]),
  );
  return schema.parse(known);
}
