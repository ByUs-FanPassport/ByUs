import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import { claimCollectibleRequestSchema } from "../../features/collectible/domain/collectible";
import { createPrivyNodeAccessVerifier } from "../auth/privy-node-verifier";
import { loadServerEnv } from "../config/env";
import { authorizeFanRequest, FanAuthUnavailableError } from "../fan-auth/fan-auth-gate";
import { createSupabaseFanAuthRepository } from "../fan-auth/supabase-fan-auth-repository";
import { CollectibleRepositoryError, createCollectibleRepositoryFromEnvironment, type CollectibleRepository, type CollectibleRepositoryFailureCode, type CollectibleRpcClient } from "./collectible-repository";

const liveSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const headers = { "cache-control": "private, no-store", vary: "Authorization" } as const;
const maxBodyBytes = 4096;

export interface CollectibleRouteDependencies {
  authorize(authorization: string | null): Promise<{ appUserId: string }>;
  repository: CollectibleRepository;
}

const failures: Readonly<Record<CollectibleRepositoryFailureCode, { status: number; code: string }>> = {
  COLLECTIBLE_NOT_FOUND: { status: 404, code: "COLLECTIBLE_NOT_FOUND" },
  JOURNEY_INCOMPLETE: { status: 409, code: "JOURNEY_INCOMPLETE" },
  CLAIM_WINDOW_NOT_OPEN: { status: 409, code: "CLAIM_WINDOW_NOT_OPEN" },
  CLAIM_WINDOW_EXPIRED: { status: 410, code: "CLAIM_WINDOW_EXPIRED" },
  WALLET_NOT_READY: { status: 409, code: "WALLET_NOT_READY" },
  IDEMPOTENCY_CONFLICT: { status: 409, code: "IDEMPOTENCY_CONFLICT" },
  COLLECTIBLE_UNAVAILABLE: { status: 503, code: "COLLECTIBLE_UNAVAILABLE" },
};

const json = (body: unknown, status: number) => Response.json(body, { status, headers });

async function owner(deps: CollectibleRouteDependencies, request: Request): Promise<{ appUserId: string } | Response> {
  try { return await deps.authorize(request.headers.get("authorization")); }
  catch (error) {
    if (error instanceof AuthError) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, error.status);
    if (error instanceof FanAuthUnavailableError) return json({ error: { code: "COLLECTIBLE_UNAVAILABLE" } }, 503);
    return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
  }
}

function repositoryFailure(error: unknown): Response {
  const failure = error instanceof CollectibleRepositoryError ? failures[error.code] : failures.COLLECTIBLE_UNAVAILABLE;
  return json({ error: { code: failure.code } }, failure.status);
}

async function limitedJson(request: Request): Promise<unknown> {
  if ((request.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new Error();
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBodyBytes) throw new Error();
  if (!request.body) throw new Error();
  const reader = request.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true }); const parts: string[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBodyBytes) { await reader.cancel(); throw new Error(); } parts.push(decoder.decode(value, { stream: true })); }
  parts.push(decoder.decode()); return JSON.parse(parts.join(""));
}

export function createGetCollectibleHandler(deps: CollectibleRouteDependencies) {
  return async (request: Request, input: { slug: string }): Promise<Response> => {
    const slug = liveSlugSchema.safeParse(input.slug); if (!slug.success) return json({ error: { code: "INVALID_REQUEST" } }, 400);
    const authorized = await owner(deps, request); if (authorized instanceof Response) return authorized;
    try { return json(await deps.repository.getOwned({ appUserId: authorized.appUserId, liveSlug: slug.data }), 200); } catch (error) { return repositoryFailure(error); }
  };
}

export function createPostCollectibleHandler(deps: CollectibleRouteDependencies) {
  return async (request: Request, input: { slug: string }): Promise<Response> => {
    const slug = liveSlugSchema.safeParse(input.slug); if (!slug.success) return json({ error: { code: "INVALID_REQUEST" } }, 400);
    const authorized = await owner(deps, request); if (authorized instanceof Response) return authorized;
    let body; try { body = claimCollectibleRequestSchema.parse(await limitedJson(request)); } catch { return json({ error: { code: "INVALID_REQUEST" } }, 400); }
    try { return json(await deps.repository.claimOwned({ appUserId: authorized.appUserId, liveSlug: slug.data, idempotencyKey: body.idempotencyKey }), 200); } catch (error) { return repositoryFailure(error); }
  };
}

export function createCollectibleRouteDependencies(): CollectibleRouteDependencies {
  const env = loadServerEnv();
  const database = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const verifier = createPrivyNodeAccessVerifier({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET, appEnvironment: env.PRIVY_APP_ENVIRONMENT, testAccountLoginEnabled: env.PRIVY_TEST_ACCOUNT_LOGIN_ENABLED });
  const fanRepository = createSupabaseFanAuthRepository({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }, database);
  return {
    authorize: (authorization) => authorizeFanRequest({ authorization, verifier, repository: fanRepository }),
    repository: createCollectibleRepositoryFromEnvironment({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }, database as unknown as CollectibleRpcClient),
  };
}

export const collectibleUnavailableResponse = () => json({ error: { code: "COLLECTIBLE_UNAVAILABLE" } }, 503);
