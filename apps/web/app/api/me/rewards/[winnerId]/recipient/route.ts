import { createBenefitFulfillmentRouteDependencies } from "@/server/g4/benefit-fulfillment-route-dependencies";
import { createPostOwnedBenefitRecipientHandler, createGetOwnedBenefitRecipientHandler } from "@/server/g4/benefit-fulfillment-route";
export const dynamic = "force-dynamic";
const unavailable = () => Response.json({ error: { code: "REWARD_UNAVAILABLE" } }, { status: 503, headers: { "cache-control": "private, no-store", vary: "Authorization" } });
export async function GET(request: Request, context: { params: Promise<{ winnerId: string }> }) {
  try { return createGetOwnedBenefitRecipientHandler(createBenefitFulfillmentRouteDependencies())(request, await context.params); }
  catch { return unavailable(); }
}
export async function POST(request: Request, context: { params: Promise<{ winnerId: string }> }) {
  try { return createPostOwnedBenefitRecipientHandler(createBenefitFulfillmentRouteDependencies())(request, await context.params); }
  catch { return unavailable(); }
}
