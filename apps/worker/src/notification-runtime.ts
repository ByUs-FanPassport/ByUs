import { SupabaseNotificationQueue } from "./adapters/supabase-notification-queue.js";
import { WebPushSender } from "./adapters/web-push-sender.js";
import type { NotificationWorkerEnv } from "./notification-env.js";
import { NotificationWorker } from "./notification-worker.js";
export function runNotificationWorkerOnce(env: NotificationWorkerEnv) {
  return new NotificationWorker(
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
}
