import { createClient } from "@supabase/supabase-js";
import { htmlLimitedBots } from "@/seo/bots";

export const dynamic = "force-dynamic";

const destination = "https://www.ehyundai.com/newCulture/EH/EH000001_V.do?seq=2092865&bbsCd=210&eventState=";
const headers = {
  "cache-control": "private, no-store, max-age=0",
  "x-robots-tag": "noindex, nofollow",
};

export async function GET(request: Request): Promise<Response> {
  // ponytail: header filtering excludes known previews, not all bots; add verified bot detection if abuse affects reporting.
  const userAgent = request.headers.get("user-agent") ?? "";
  const preview = htmlLimitedBots.test(userAgent) || /bot|crawler|spider|meta-external/i.test(userAgent)
    || /prefetch|prerender/i.test(`${request.headers.get("purpose") ?? ""} ${request.headers.get("sec-purpose") ?? ""}`)
    || request.headers.has("next-router-prefetch");

  if (request.method === "GET" && !preview) {
    try {
      const database = createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { error } = await database.from("outbound_link_visits")
        .insert({ campaign: "elina-banksy-instagram" })
        .abortSignal(AbortSignal.timeout(1_500));
      if (error) throw error;
    } catch {
      // Keep the destination reachable even when measurement is unavailable.
      console.error("outbound_link_visit_failed", { campaign: "elina-banksy-instagram" });
    }
  }

  return new Response(null, { status: 302, headers: { ...headers, location: destination } });
}

// Explicit HEAD prevents Next.js from counting its automatic GET fallback.
export async function HEAD(request: Request): Promise<Response> {
  return GET(new Request(request, { method: "HEAD" }));
}
