import "server-only";
import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import { FanAuthUnavailableError } from "../fan-auth/fan-auth-gate";
import type { RaffleResultRepository } from "./raffle-result-repository";

export interface RaffleResultRouteDependencies {
  authorize(authorization: string | null): Promise<{ appUserId: string }>;
  repository: RaffleResultRepository;
}
export const raffleResultJson = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "cache-control": "private, no-store", vary: "Authorization" },
});
export const raffleResultUnavailable = () => raffleResultJson({ error: { code: "RAFFLE_RESULT_UNAVAILABLE" } }, 503);
const querySchema = z.object({
  locale: z.enum(["ko", "en"]).default("ko"),
  cursor: z.string().min(1).max(500).nullable().default(null),
});
async function authorize(request: Request, dependencies: RaffleResultRouteDependencies) {
  try { return await dependencies.authorize(request.headers.get("authorization")); }
  catch (error) {
    if (error instanceof FanAuthUnavailableError) return raffleResultUnavailable();
    if (error instanceof AuthError) return raffleResultJson({ error: { code: "AUTHENTICATION_REQUIRED" } }, error.status);
    return raffleResultUnavailable();
  }
}
function parseQuery(request: Request) {
  const p = new URL(request.url).searchParams;
  return querySchema.safeParse({ locale: p.get("locale") ?? "ko", cursor: p.get("cursor") });
}
export function createGetOwnedRaffleResultHandler(dependencies: RaffleResultRouteDependencies) {
  return async (request: Request, input: { benefitId: string }) => {
    if (!z.uuid().safeParse(input.benefitId).success) return raffleResultJson({ error: { code: "RAFFLE_NOT_FOUND" } }, 404);
    const query = parseQuery(request);
    if (!query.success) return raffleResultJson({ error: { code: "INVALID_REQUEST" } }, 400);
    const owner = await authorize(request, dependencies);
    if (owner instanceof Response) return owner;
    try {
      const result = await dependencies.repository.find({ appUserId: owner.appUserId, benefitId: input.benefitId, locale: query.data.locale });
      return result ? raffleResultJson(result) : raffleResultJson({ error: { code: "RAFFLE_NOT_FOUND" } }, 404);
    } catch { return raffleResultUnavailable(); }
  };
}
export function createGetOwnedRafflesHandler(dependencies: RaffleResultRouteDependencies) {
  return async (request: Request) => {
    const query = parseQuery(request);
    if (!query.success) return raffleResultJson({ error: { code: "INVALID_REQUEST" } }, 400);
    const owner = await authorize(request, dependencies);
    if (owner instanceof Response) return owner;
    try { return raffleResultJson(await dependencies.repository.list({ appUserId: owner.appUserId, ...query.data })); }
    catch { return raffleResultUnavailable(); }
  };
}
