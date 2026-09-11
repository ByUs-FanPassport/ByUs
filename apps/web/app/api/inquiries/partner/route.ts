import { createClient } from "@supabase/supabase-js";
import { loadServerEnv } from "@/server/config/env";
import { createInquiryHandler, inquiryFailure } from "@/server/inquiries/fanmeeting-route";
import { createInquiryRepository } from "@/server/inquiries/fanmeeting-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const env = loadServerEnv();
    const database = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) },
    });
    return createInquiryHandler({ repository: createInquiryRepository(database), secret: env.SUPABASE_SERVICE_ROLE_KEY, vercel: process.env.VERCEL === "1", localDevelopment: process.env.NODE_ENV === "development", inquiryType: "partner" })(request);
  } catch { return inquiryFailure("INQUIRY_UNAVAILABLE"); }
}
