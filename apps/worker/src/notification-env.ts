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
    BUSINESS_INQUIRY_MODE: z.enum(["disabled","ses_email"]).default("disabled"),
    NOTIFICATION_EXTERNAL_MODE: z.enum(["disabled","test_sink","provider","ses_email"]).default("disabled"),
    KAKAO_ALIMTALK_MODE: z.enum(["disabled","solapi"]).default("disabled"),
    NOTIFICATION_EXTERNAL_ENVIRONMENT: z.enum(["dev","prod"]).default("dev"),
    SES_REGION: z.literal("ap-northeast-2").optional(),
    SES_FROM_EMAIL: z.literal("notifications@byus.kr").optional(),
    EMAIL_PROVIDER_URL: z.string().url().refine((v)=>v.startsWith("https://")).optional(),
    EMAIL_PROVIDER_TOKEN: z.string().min(16).optional(),
    KAKAO_PROVIDER_URL: z.string().url().refine((v)=>v.startsWith("https://")).optional(),
    KAKAO_PROVIDER_TOKEN: z.string().min(16).optional(),
    SOLAPI_API_KEY: z.string().min(8).max(256).regex(/^[A-Za-z0-9_-]+$/).optional(),
    SOLAPI_API_SECRET: z.string().min(8).max(256).regex(/^[\x21-\x7e]+$/).optional(),
  })
  .strict();
const schema=baseSchema.superRefine((v,ctx)=>{if(v.BUSINESS_INQUIRY_MODE==="ses_email"&&v.NOTIFICATION_EXTERNAL_ENVIRONMENT!=="prod")ctx.addIssue({code:"custom",path:["BUSINESS_INQUIRY_MODE"],message:"Business inquiries can send only in production"});if(v.NOTIFICATION_EXTERNAL_MODE==="ses_email"&&v.NOTIFICATION_WORKER_BATCH_SIZE>2)ctx.addIssue({code:"custom",path:["NOTIFICATION_WORKER_BATCH_SIZE"],message:"SES mode requires batch size at most 2 to bound sequential send time"});if(v.NOTIFICATION_EXTERNAL_MODE==="ses_email"&&(!v.SES_REGION||!v.SES_FROM_EMAIL))ctx.addIssue({code:"custom",path:["NOTIFICATION_EXTERNAL_MODE"],message:"SES email mode requires region and sender"});if(v.NOTIFICATION_EXTERNAL_MODE==="test_sink"&&v.NOTIFICATION_EXTERNAL_ENVIRONMENT!=="dev")ctx.addIssue({code:"custom",path:["NOTIFICATION_EXTERNAL_MODE"],message:"test sink is Dev-only"});if(v.NOTIFICATION_EXTERNAL_MODE==="provider"&&(!v.EMAIL_PROVIDER_URL||!v.EMAIL_PROVIDER_TOKEN||!v.KAKAO_PROVIDER_URL||!v.KAKAO_PROVIDER_TOKEN))ctx.addIssue({code:"custom",path:["NOTIFICATION_EXTERNAL_MODE"],message:"provider mode requires both sandbox providers"});if(v.KAKAO_ALIMTALK_MODE==="solapi"&&(!v.SOLAPI_API_KEY||!v.SOLAPI_API_SECRET))ctx.addIssue({code:"custom",path:["KAKAO_ALIMTALK_MODE"],message:"SOLAPI mode requires API key and secret"});});
export type NotificationWorkerEnv = z.infer<typeof schema> & {
  telegram: Readonly<{
    mode: string | undefined;
    commandMode: string | undefined;
    token: string | undefined;
    chatId: string | undefined;
  }>;
};
export function parseNotificationEnv(
  source: NodeJS.ProcessEnv,
): NotificationWorkerEnv {
  const known = Object.fromEntries(
    Object.keys(baseSchema.shape).map((key) => [key, source[key]]),
  );
  return {
    ...schema.parse(known),
    // Telegram config is intentionally parsed only by its independent runtime
    // branch so a bad optional config cannot stop the existing queues.
    telegram: {
      mode: source.TELEGRAM_ALERT_MODE,
      commandMode: source.TELEGRAM_COMMAND_MODE,
      token: source.TELEGRAM_BOT_TOKEN,
      chatId: source.TELEGRAM_CHAT_ID,
    },
  };
}
