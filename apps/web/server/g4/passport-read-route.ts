import "server-only";

import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import { passportLocaleSchema, type PassportLocale } from "../../features/passport/domain/passport-read-model";
import type { AuthorizedFan } from "../fan-auth/fan-auth-gate";
import type { PassportReadRepository } from "./passport-read-repository";

export interface PassportReadRouteDependencies { authorize(authorization: string): Promise<AuthorizedFan>; repository: PassportReadRepository }
const idSchema = z.uuid();
const headers = { "cache-control": "no-store", vary: "Authorization" } as const;

function error(status: 401 | 403 | 404 | 503, code: string): Response { return Response.json({ error: { code } }, { status, headers }); }
function locale(request: Request): PassportLocale | null { const parsed = passportLocaleSchema.safeParse(new URL(request.url).searchParams.get("locale") ?? "ko"); return parsed.success ? parsed.data : null; }
async function owner(request: Request, dependencies: PassportReadRouteDependencies): Promise<AuthorizedFan | Response> {
  try { return await dependencies.authorize(request.headers.get("authorization") ?? ""); }
  catch (caught) {
    if (caught instanceof AuthError) return caught.status === 401 ? error(401, "UNAUTHENTICATED") : error(403, "FORBIDDEN");
    return error(503, "PASSPORTS_UNAVAILABLE");
  }
}

export function createPassportCollectionHandler(dependencies: PassportReadRouteDependencies) {
  return async (request: Request): Promise<Response> => {
    const selectedLocale = locale(request); if (!selectedLocale) return error(404, "NOT_FOUND");
    const fan = await owner(request, dependencies); if (fan instanceof Response) return fan;
    try { return Response.json({ passports: await dependencies.repository.findCollection({ appUserId: fan.appUserId, locale: selectedLocale }) }, { headers }); }
    catch { return error(503, "PASSPORTS_UNAVAILABLE"); }
  };
}

export function createPassportDetailHandler(dependencies: PassportReadRouteDependencies) {
  return async (request: Request, input: { passportId: string }): Promise<Response> => {
    const parsed = idSchema.safeParse(input.passportId); const selectedLocale = locale(request);
    if (!parsed.success || !selectedLocale) return error(404, "NOT_FOUND");
    const fan = await owner(request, dependencies); if (fan instanceof Response) return fan;
    try { const passport = await dependencies.repository.findPassport({ id: parsed.data, appUserId: fan.appUserId, locale: selectedLocale }); return passport ? Response.json({ passport }, { headers }) : error(404, "NOT_FOUND"); }
    catch { return error(503, "PASSPORTS_UNAVAILABLE"); }
  };
}

export function createStampDetailHandler(dependencies: PassportReadRouteDependencies) {
  return async (request: Request, input: { stampId: string }): Promise<Response> => {
    const parsed = idSchema.safeParse(input.stampId); const selectedLocale = locale(request);
    if (!parsed.success || !selectedLocale) return error(404, "NOT_FOUND");
    const fan = await owner(request, dependencies); if (fan instanceof Response) return fan;
    try { const stamp = await dependencies.repository.findStamp({ id: parsed.data, appUserId: fan.appUserId, locale: selectedLocale }); return stamp ? Response.json({ stamp }, { headers }) : error(404, "NOT_FOUND"); }
    catch { return error(503, "STAMPS_UNAVAILABLE"); }
  };
}

