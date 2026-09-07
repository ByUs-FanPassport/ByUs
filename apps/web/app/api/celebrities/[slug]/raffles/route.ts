import { createRaffleDependencies } from "@/server/raffle/raffle-dependencies";
import { createGetRafflesHandler } from "@/server/raffle/raffle-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  return createGetRafflesHandler(createRaffleDependencies())(request, {
    celebritySlug: slug,
  });
}
