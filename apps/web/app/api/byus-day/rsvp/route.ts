import { createClient } from "@supabase/supabase-js";
import { loadServerEnv } from "@/server/config/env";
import { createRsvpHandler, rsvpFailure } from "@/server/byus-day/rsvp-route";
import { createRsvpRepository } from "@/server/byus-day/rsvp-repository";
import { parseRsvpEncryptionKey } from "@/server/byus-day/rsvp-crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const env = loadServerEnv();
    const database = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5_000) }) },
    });
    return createRsvpHandler({ repository: createRsvpRepository(database), secret: env.SUPABASE_SERVICE_ROLE_KEY, encryptionKey: parseRsvpEncryptionKey(process.env.BYUS_DAY_RSVP_ENCRYPTION_KEY), vercel: process.env.VERCEL === "1", localDevelopment: process.env.NODE_ENV === "development" })(request);
  } catch { return rsvpFailure("RSVP_UNAVAILABLE"); }
}
