import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { raffleFulfillmentPolicySchema, type RaffleFulfillmentPolicy } from "../../features/benefit/domain/raffle-fulfillment-policy";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "../admin/admin-session-gate";
import { adminCorrelationId } from "./blockchain-job-route";

const activatablePolicySchema = raffleFulfillmentPolicySchema.superRefine((policy, context) => {
  if (policy.method !== "on_site_pickup") return;
  if (!policy.pickupEndsOn || !Number.isFinite(Date.parse(`${policy.pickupEndsOn}T00:00:00Z`)) || new Date(`${policy.pickupEndsOn}T00:00:00Z`).toISOString().slice(0, 10) !== policy.pickupEndsOn) {
    context.addIssue({ code: "custom", path: ["pickupEndsOn"], message: "A valid pickup end date is required" });
  }
  for (const field of ["pickupVenue", "pickupInstructions"] as const) {
    for (const locale of ["ko", "en"] as const) {
      if (!policy[field][locale].trim()) context.addIssue({ code: "custom", path: [field, locale], message: "Pickup details are required in both languages" });
    }
  }
});

const rosterSchema = z.object({
  rosterVersion: z.string(), generatedAt: z.string().datetime({ offset: true }),
  items: z.array(z.object({ winnerId: z.string().uuid(), benefitId: z.string().uuid(), benefitTitle: z.string(), name: z.string(), phoneLast4: z.string().regex(/^\d{4}$/), fulfillmentStatus: z.string() }).strict()),
}).strict();
type Actor = { appUserId: string; allowlistId: string };
export interface RaffleOperationsRepository {
  policy(input: { actor: Actor; campaignId: string; benefitId: string }): Promise<RaffleFulfillmentPolicy | null>;
  configure(input: { actor: Actor; correlationId: string; campaignId: string; benefitId: string; expectedRevision: number; policy: RaffleFulfillmentPolicy }): Promise<RaffleFulfillmentPolicy>;
  roster(input: { actor: Actor; correlationId: string; campaignId: string; purpose: string }): Promise<z.infer<typeof rosterSchema>>;
  close(input: { actor: Actor; correlationId: string; winnerId: string; expectedRevision: number; reason: string }): Promise<unknown>;
}
export function createRaffleOperationsRepository(config: { url: string; serviceRoleKey: string }, client?: Pick<SupabaseClient, "rpc">): RaffleOperationsRepository {
  const db = client ?? createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const actor = (a: Actor) => ({ p_actor_app_user_id: a.appUserId, p_actor_admin_allowlist_id: a.allowlistId });
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  }
  return {
    async policy(i) { const data = await rpc("get_admin_raffle_fulfillment_policy", { ...actor(i.actor), p_campaign_id: i.campaignId, p_benefit_id: i.benefitId }); return data === null ? null : raffleFulfillmentPolicySchema.parse(data); },
    async configure(i) { return raffleFulfillmentPolicySchema.parse(await rpc("configure_admin_raffle_fulfillment_policy", { ...actor(i.actor), p_correlation_id: i.correlationId, p_campaign_id: i.campaignId, p_benefit_id: i.benefitId, p_expected_campaign_revision: i.expectedRevision, p_policy: i.policy })); },
    async roster(i) { return rosterSchema.parse(await rpc("get_admin_benefit_pickup_roster", { ...actor(i.actor), p_correlation_id: i.correlationId, p_campaign_id: i.campaignId, p_purpose: i.purpose })); },
    async close(i) { return rpc("close_admin_benefit_fulfillment_unclaimed", { ...actor(i.actor), p_correlation_id: i.correlationId, p_winner_id: i.winnerId, p_expected_revision: i.expectedRevision, p_reason: i.reason }); },
  };
}
export interface RaffleOperationsDependencies {
  authorize(input: { authorization: string; correlationId: string }): Promise<AdminSession>;
  repository: RaffleOperationsRepository;
}
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "private, no-store", vary: "Authorization" } });
export const raffleOperationsUnavailable = () => json({ error: { code: "RAFFLE_OPERATIONS_UNAVAILABLE" } }, 503);
function operationError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/FORBIDDEN|NOT_ALLOWLISTED|ADMIN_DISABLED/.test(message)) return json({ error: { code: "FORBIDDEN" } }, 403);
  if (/NOT_FOUND/.test(message)) return json({ error: { code: "NOT_FOUND" } }, 404);
  if (/REVISION|CONFLICT|INVALID|REQUIRED|CLOSED|DEADLINE|LEGACY|ENTRIES|PUBLISHED/.test(message)) return json({ error: { code: "RAFFLE_OPERATION_REJECTED" } }, 409);
  return raffleOperationsUnavailable();
}
async function authorize(request: Request, dependencies: RaffleOperationsDependencies, correlationId: string, write: boolean) {
  try {
    const session = await dependencies.authorize({ authorization: request.headers.get("authorization") ?? "", correlationId });
    if (write && session.role === "viewer") return json({ error: { code: "FORBIDDEN" } }, 403);
    return { appUserId: session.appUserId, allowlistId: session.allowlistId };
  } catch (error) { return error instanceof AuthError ? json({ error: { code: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" } }, error.status) : raffleOperationsUnavailable(); }
}
/** Quote CSV and neutralize formulas even when spreadsheet software trims leading space. */
export function raffleRosterCsvCell(value: string): string {
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function createPostRaffleRosterHandler(d: RaffleOperationsDependencies) {
  return async (request: Request, input: { campaignId: string }) => {
    if (!z.uuid().safeParse(input.campaignId).success) return json({ error: { code: "NOT_FOUND" } }, 404);
    const correlationId = adminCorrelationId(request), actor = await authorize(request, d, correlationId, true);
    if (actor instanceof Response) return actor;
    const parsed = z.object({ purpose: z.string().trim().min(10).max(1000), format: z.enum(["csv", "json"]).default("csv") }).strict().safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: { code: "INVALID_REQUEST" } }, 400);
    try {
      const roster = await d.repository.roster({ actor, correlationId, campaignId: input.campaignId, purpose: parsed.data.purpose });
      if (parsed.data.format === "json") return json(roster);
      const rows = [["경품", "성명", "휴대폰 뒤 4자리", "수령 상태"], ...roster.items.map(i => [i.benefitTitle, i.name, i.phoneLast4, i.fulfillmentStatus])];
      return new Response("\uFEFF" + rows.map(row => row.map(raffleRosterCsvCell).join(",")).join("\r\n"), { headers: {
        "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="pickup-${input.campaignId}.csv"`,
        "cache-control": "private, no-store", vary: "Authorization", "x-roster-version": encodeURIComponent(roster.rosterVersion),
      } });
    } catch (error) { return operationError(error); }
  };
}
export function createRafflePolicyHandler(d: RaffleOperationsDependencies) {
  return async (request: Request, input: { campaignId: string; benefitId: string }) => {
    if (!z.uuid().safeParse(input.campaignId).success || !z.uuid().safeParse(input.benefitId).success) return json({ error: { code: "NOT_FOUND" } }, 404);
    const correlationId = adminCorrelationId(request), actor = await authorize(request, d, correlationId, request.method !== "GET");
    if (actor instanceof Response) return actor;
    try {
      if (request.method === "GET") return json({ policy: await d.repository.policy({ actor, ...input }) });
      const parsed = z.object({ expectedRevision: z.number().int().positive(), policy: activatablePolicySchema }).strict().safeParse(await request.json().catch(() => null));
      if (!parsed.success) return json({ error: { code: "INVALID_REQUEST" } }, 400);
      return json({ policy: await d.repository.configure({ actor, correlationId, ...input, ...parsed.data }) });
    } catch (error) { return operationError(error); }
  };
}
export function createCloseRaffleClaimHandler(d: RaffleOperationsDependencies) {
  return async (request: Request, input: { winnerId: string }) => {
    if (!z.uuid().safeParse(input.winnerId).success) return json({ error: { code: "NOT_FOUND" } }, 404);
    const correlationId = adminCorrelationId(request), actor = await authorize(request, d, correlationId, true);
    if (actor instanceof Response) return actor;
    const parsed = z.object({ expectedRevision: z.number().int().positive(), reason: z.string().trim().min(10).max(1000) }).strict().safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: { code: "INVALID_REQUEST" } }, 400);
    try { return json(await d.repository.close({ actor, correlationId, ...input, ...parsed.data })); }
    catch (error) { return operationError(error); }
  };
}
