import "server-only";

import { createClient } from "@supabase/supabase-js";
import { loadServerEnv } from "../config/env";
import { createTelegramReactionPort } from "./bot-api";
import { createTelegramBugReportRepository } from "./bug-report-repository";

export function createTelegramBugReportDependencies() {
  const env = loadServerEnv();
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    webhookSecret: env.TELEGRAM_BUG_REPORT_WEBHOOK_SECRET,
    operatorSecret: env.TELEGRAM_BUG_REPORT_OPERATOR_SECRET,
    repository: createTelegramBugReportRepository(client),
    telegram: env.TELEGRAM_BUG_REPORT_BOT_TOKEN
      ? createTelegramReactionPort(env.TELEGRAM_BUG_REPORT_BOT_TOKEN)
      : null,
  };
}
