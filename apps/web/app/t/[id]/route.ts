import { banksyPublicHandlers } from "@/server/analytics/banksy-dependencies";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return await banksyPublicHandlers().shared(request, (await context.params).id); }
  catch { return new Response(null, { status: 302, headers: { location: "/c/elina/raffles", "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" } }); }
}
export const HEAD = GET;
