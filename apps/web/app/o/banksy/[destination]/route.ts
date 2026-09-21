import { banksyPublicHandlers } from "@/server/analytics/banksy-dependencies";
import { banksyDestinations, banksyDestinationSchema } from "@/features/analytics/domain/banksy-campaign";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ destination: string }> }) {
  const destination = (await context.params).destination;
  try { return await banksyPublicHandlers().outbound(request, destination); }
  catch {
    const parsed = banksyDestinationSchema.safeParse(destination);
    console.error("outbound_link_visit_failed", { campaign: "banksy" });
    return new Response(null, { status: parsed.success ? 302 : 404, headers: {
      "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow",
      ...(parsed.success ? { location: banksyDestinations[parsed.data] } : {}),
    } });
  }
}
export const HEAD = GET;
