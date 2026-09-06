import { SupabaseNotificationQueue } from "./adapters/supabase-notification-queue.js";
import { WebPushSender } from "./adapters/web-push-sender.js";
import type { NotificationWorkerEnv } from "./notification-env.js";
import { NotificationWorker } from "./notification-worker.js";
import { SupabaseExternalNotificationQueue } from "./adapters/supabase-external-notification-queue.js";
import { NotificationTestSinkSender } from "./adapters/notification-test-sink.js";
import { SesEmailSender } from "./adapters/ses-email-sender.js";
import { EmailSender } from "./adapters/email-sender.js";
import { KakaoSender } from "./adapters/kakao-sender.js";
import { ExternalNotificationWorker } from "./external-notification-worker.js";
export async function runNotificationWorkerOnce(env: NotificationWorkerEnv) {
  const push = await new NotificationWorker(
    SupabaseNotificationQueue.create(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    new WebPushSender({
      subject: env.WEB_PUSH_VAPID_SUBJECT,
      publicKey: env.WEB_PUSH_VAPID_PUBLIC_KEY,
      privateKey: env.WEB_PUSH_VAPID_PRIVATE_KEY,
    }),
    {
      workerId: env.NOTIFICATION_WORKER_ID,
      batchSize: env.NOTIFICATION_WORKER_BATCH_SIZE,
      leaseSeconds: env.NOTIFICATION_WORKER_LEASE_SECONDS,
    },
  ).runOnce();
  if(env.NOTIFICATION_EXTERNAL_MODE==="disabled")return push;
  const queue=SupabaseExternalNotificationQueue.create(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,env.NOTIFICATION_EXTERNAL_ENVIRONMENT,env.NOTIFICATION_EXTERNAL_MODE==="ses_email");
  const sink=new NotificationTestSinkSender(queue);
  const ses=env.NOTIFICATION_EXTERNAL_MODE==="ses_email"?new SesEmailSender({region:env.SES_REGION!,fromEmail:env.SES_FROM_EMAIL!,storageOrigin:new URL(env.SUPABASE_URL).origin}):null;
  const senders=env.NOTIFICATION_EXTERNAL_MODE==="test_sink"?{email:sink,kakao:sink}:ses?{email:ses,kakao:ses}:{email:new EmailSender({url:env.EMAIL_PROVIDER_URL!,token:env.EMAIL_PROVIDER_TOKEN!}),kakao:new KakaoSender({url:env.KAKAO_PROVIDER_URL!,token:env.KAKAO_PROVIDER_TOKEN!})};
  const external=await new ExternalNotificationWorker(queue,senders,{workerId:`${env.NOTIFICATION_WORKER_ID}:external`,batchSize:env.NOTIFICATION_WORKER_BATCH_SIZE,leaseSeconds:env.NOTIFICATION_WORKER_LEASE_SECONDS}).runOnce();
  return push+external;
}
