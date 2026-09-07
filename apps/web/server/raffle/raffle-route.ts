import { z } from "zod";
import type { RaffleRepository } from "./raffle-repository";

const slugSchema = z
  .string()
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const localeSchema = z.enum(["ko", "en"]);
const headers = {
  "cache-control": "public, max-age=30, stale-while-revalidate=60",
};

export function createGetRafflesHandler(
  repository: RaffleRepository,
  now = () => new Date(),
) {
  return async (request: Request, input: { celebritySlug: string }) => {
    const slug = slugSchema.safeParse(input.celebritySlug);
    const locale = localeSchema.safeParse(
      new URL(request.url).searchParams.get("locale") ?? "ko",
    );
    if (!slug.success || !locale.success)
      return Response.json(
        { error: { code: "NOT_FOUND" } },
        { status: 404, headers },
      );
    try {
      return Response.json(
        await repository.list({
          celebritySlug: slug.data,
          locale: locale.data,
          now: now(),
        }),
        { headers },
      );
    } catch {
      return Response.json(
        { error: { code: "RAFFLES_UNAVAILABLE" } },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
  };
}
