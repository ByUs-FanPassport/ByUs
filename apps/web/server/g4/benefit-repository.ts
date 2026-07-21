import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  benefitCatalogItemSchema,
  benefitClaimResponseSchema,
  deriveBenefitState,
  parseSafeExternalHttpsUrl,
  type BenefitCatalogItem,
  type BenefitClaimResponse,
  type BenefitEligibilitySnapshot,
  type BenefitListResponse,
  type BenefitLocale,
} from "../../features/benefit/domain/benefit";

const rawBenefitSchema = benefitCatalogItemSchema.omit({ state: true }).extend({ available: z.boolean() });

export type BenefitFailureCode =
  | "BENEFIT_NOT_FOUND"
  | "BENEFIT_LOCKED"
  | "BENEFIT_SOLD_OUT"
  | "BENEFIT_EXPIRED"
  | "BENEFIT_CLAIM_LIMIT_REACHED"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "BENEFIT_UNAVAILABLE";

export class BenefitRepositoryError extends Error {
  constructor(readonly code: BenefitFailureCode) {
    super(code);
    this.name = "BenefitRepositoryError";
  }
}

export interface BenefitRepository {
  list(input: { celebritySlug: string; locale: BenefitLocale; appUserId: string | null; now: Date }): Promise<BenefitListResponse>;
  find(input: { benefitId: string; locale: BenefitLocale; appUserId: string | null; now: Date }): Promise<BenefitCatalogItem | null>;
  claim(input: { benefitId: string; appUserId: string; idempotencyKey: string; now: Date }): Promise<BenefitClaimResponse>;
}

export interface BenefitDataSource {
  getPublished(celebritySlug: string, locale: BenefitLocale, now: Date): Promise<unknown[]>;
  findCelebritySlug(benefitId: string): Promise<string | null>;
  getEligibility(appUserId: string, celebritySlug: string): Promise<BenefitEligibilitySnapshot>;
  claim(input: { benefitId: string; appUserId: string; idempotencyKey: string; now: Date }): Promise<unknown>;
}

export class DefaultBenefitRepository implements BenefitRepository {
  constructor(private readonly source: BenefitDataSource) {}

  async list(input: { celebritySlug: string; locale: BenefitLocale; appUserId: string | null; now: Date }): Promise<BenefitListResponse> {
    const raw = (await this.source.getPublished(input.celebritySlug, input.locale, input.now)).map((item) => rawBenefitSchema.parse(item));
    const viewer = input.appUserId ? await this.source.getEligibility(input.appUserId, input.celebritySlug) : null;
    return {
      benefits: raw.map(({ available, ...item }) => benefitCatalogItemSchema.parse({
        ...item,
        state: deriveBenefitState({ ...item, available }, viewer, input.now),
      })),
    };
  }

  async find(input: { benefitId: string; locale: BenefitLocale; appUserId: string | null; now: Date }): Promise<BenefitCatalogItem | null> {
    const celebritySlug = await this.source.findCelebritySlug(input.benefitId);
    if (!celebritySlug) return null;
    const result = await this.list({ ...input, celebritySlug });
    return result.benefits.find((benefit) => benefit.id === input.benefitId) ?? null;
  }

  async claim(input: { benefitId: string; appUserId: string; idempotencyKey: string; now: Date }): Promise<BenefitClaimResponse> {
    let projected: BenefitClaimResponse;
    try {
      projected = benefitClaimResponseSchema.parse(await this.source.claim(input));
    } catch (error) {
      if (error instanceof BenefitRepositoryError) throw error;
      throw new BenefitRepositoryError("BENEFIT_UNAVAILABLE");
    }
    if (projected.deliveryType === "external_url") {
      try {
        projected = { ...projected, deliveryValue: parseSafeExternalHttpsUrl(projected.deliveryValue) };
      } catch {
        throw new BenefitRepositoryError("BENEFIT_UNAVAILABLE");
      }
    }
    return projected;
  }
}

interface RpcClient {
  rpc(name: string, parameters: Record<string, string>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

type DatabaseClient = Pick<SupabaseClient, "from"> & RpcClient;

const rpcFailureMarkers: ReadonlyArray<readonly [string, BenefitFailureCode]> = [
  ["benefit is not available", "BENEFIT_NOT_FOUND"],
  ["benefit claim window is closed", "BENEFIT_EXPIRED"],
  ["eligible fan passport is required", "BENEFIT_LOCKED"],
  ["benefit score or level requirement is not met", "BENEFIT_LOCKED"],
  ["required stamp is missing", "BENEFIT_LOCKED"],
  ["required activity is missing", "BENEFIT_LOCKED"],
  ["per-user claim limit reached", "BENEFIT_CLAIM_LIMIT_REACHED"],
  ["benefit stock is exhausted", "BENEFIT_SOLD_OUT"],
  ["benefit code inventory is exhausted", "BENEFIT_SOLD_OUT"],
  ["idempotency key belongs to a different claim", "IDEMPOTENCY_KEY_CONFLICT"],
];

function mapClaimFailure(message = ""): BenefitRepositoryError {
  return new BenefitRepositoryError(rpcFailureMarkers.find(([marker]) => message.includes(marker))?.[1] ?? "BENEFIT_UNAVAILABLE");
}

function onlyRow<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export class SupabaseBenefitDataSource implements BenefitDataSource {
  constructor(private readonly database: DatabaseClient) {}

  async getPublished(celebritySlug: string, locale: BenefitLocale, now: Date): Promise<unknown[]> {
    const { data, error } = await this.database.rpc("get_published_benefits", {
      p_celebrity_slug: celebritySlug,
      p_locale: locale,
      p_now: now.toISOString(),
    });
    if (error || !Array.isArray(data)) throw new BenefitRepositoryError("BENEFIT_UNAVAILABLE");
    return data;
  }

  async findCelebritySlug(benefitId: string): Promise<string | null> {
    const { data, error } = await this.database.from("benefits").select("id, celebrities!inner(slug, status)").eq("id", benefitId).eq("publication_status", "published").eq("celebrities.status", "published").maybeSingle();
    if (error) throw new BenefitRepositoryError("BENEFIT_UNAVAILABLE");
    const celebrity = onlyRow(data?.celebrities ?? null);
    return celebrity?.slug ?? null;
  }

  async getEligibility(appUserId: string, celebritySlug: string): Promise<BenefitEligibilitySnapshot> {
    const { data: celebrity, error: celebrityError } = await this.database.from("celebrities").select("id").eq("slug", celebritySlug).eq("status", "published").maybeSingle();
    if (celebrityError) throw new BenefitRepositoryError("BENEFIT_UNAVAILABLE");
    if (!celebrity) return { authenticated: true, hasPassport: false, score: 0, level: "Bronze", stampTypes: new Set(), activityTypes: new Set(), claimedBenefitIds: new Set() };
    const [passportResult, scoreResult, stampsResult, activitiesResult, claimsResult] = await Promise.all([
      this.database.from("fan_passports").select("id").eq("app_user_id", appUserId).eq("celebrity_id", celebrity.id).eq("business_status", "issued").maybeSingle(),
      this.database.from("fan_score_ledger").select("points").eq("app_user_id", appUserId).eq("celebrity_id", celebrity.id),
      this.database.from("stamps").select("stamp_type").eq("app_user_id", appUserId).eq("celebrity_id", celebrity.id),
      this.database.from("fan_activities").select("activity_type").eq("app_user_id", appUserId).eq("celebrity_id", celebrity.id),
      this.database.from("benefit_claims").select("benefit_id").eq("app_user_id", appUserId).eq("celebrity_id", celebrity.id),
    ]);
    if (passportResult.error || scoreResult.error || stampsResult.error || activitiesResult.error || claimsResult.error) throw new BenefitRepositoryError("BENEFIT_UNAVAILABLE");
    const score = (scoreResult.data ?? []).reduce((sum, row) => sum + row.points, 0);
    const level = score >= 35 ? "Diamond" : score >= 20 ? "Platinum" : score >= 10 ? "Gold" : score >= 5 ? "Silver" : "Bronze";
    return {
      authenticated: true,
      hasPassport: passportResult.data !== null,
      score,
      level,
      stampTypes: new Set((stampsResult.data ?? []).map((row) => row.stamp_type)),
      activityTypes: new Set((activitiesResult.data ?? []).map((row) => row.activity_type)),
      claimedBenefitIds: new Set((claimsResult.data ?? []).map((row) => row.benefit_id)),
    };
  }

  async claim(input: { benefitId: string; appUserId: string; idempotencyKey: string; now: Date }): Promise<unknown> {
    const { data, error } = await this.database.rpc("claim_benefit", {
      p_benefit_id: input.benefitId,
      p_app_user_id: input.appUserId,
      p_idempotency_key: input.idempotencyKey,
      p_now: input.now.toISOString(),
    });
    if (error) throw mapClaimFailure(error.message);
    return data;
  }
}

export function createBenefitRepositoryFromEnvironment(config: { url: string; serviceRoleKey: string }): BenefitRepository {
  const client = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return new DefaultBenefitRepository(new SupabaseBenefitDataSource(client as unknown as DatabaseClient));
}
