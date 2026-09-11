import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NotificationWorkerEnv } from "./notification-env.js";

export async function runRaffleRecipientRemindersOnce(
  env: NotificationWorkerEnv,
  client?: Pick<SupabaseClient, "rpc">,
): Promise<number> {
  const db = client ?? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.rpc("enqueue_due_benefit_recipient_reminders");
  if (error || !Number.isInteger(data) || data < 0) throw new Error("RAFFLE_REMINDER_UNAVAILABLE");
  return data as number;
}
