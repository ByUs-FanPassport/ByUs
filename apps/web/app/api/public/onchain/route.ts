import { getPublicOnchainResult } from "@/server/onchain/public-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const result = await getPublicOnchainResult();
  return Response.json(result, {
    status: result.state === "available" ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
