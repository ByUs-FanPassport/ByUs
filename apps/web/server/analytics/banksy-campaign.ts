import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { BANKSY_LANDING, banksyDestinations, banksyDestinationSchema, banksySurfaceSchema, campaignAdminDataSchema, campaignCommandSchema, campaignVisitInputSchema, campaignWindow, type CampaignCommand } from "@/features/analytics/domain/banksy-campaign";
import { htmlLimitedBots } from "@/seo/bots";
import { AuthError } from "@/features/auth/domain/auth-errors";
import { boundedJson, CertificationBodyError } from "@/server/certification/certification-http";
import type { AdminSession } from "@/server/admin/admin-session-gate";

const redirectHeaders = { "cache-control": "private, no-store, max-age=0", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "private, no-store", vary: "Authorization" } });
const redirect = (location: string) => new Response(null, { status: 302, headers: { ...redirectHeaders, location } });

export function isCampaignPreview(request: Request) {
  const ua = request.headers.get("user-agent") ?? "";
  // ponytail: known automation only; these counts are browser sessions, never verified humans.
  return request.method === "HEAD" || htmlLimitedBots.test(ua) || /bot|crawler|spider|meta-external/i.test(ua)
    || /prefetch|prerender/i.test(`${request.headers.get("purpose") ?? ""} ${request.headers.get("sec-purpose") ?? ""}`)
    || request.headers.has("next-router-prefetch");
}

export function createBanksyRepository(config: { url: string; serviceRoleKey: string }) {
  const db = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async link(id: string) {
      const { data, error } = await db.from("campaign_tracking_links").select("id,active,locale,channel").eq("id", id).abortSignal(AbortSignal.timeout(1500)).maybeSingle();
      if (error) throw error;
      return data as { id: string; active: boolean; locale: string; channel: string } | null;
    },
    async visit(input: z.infer<typeof campaignVisitInputSchema>) {
      const hash = createHash("sha256").update(`byus-banksy-session-v1:${input.sessionId}`).digest("hex");
      const { data, error } = await db.rpc("record_banksy_visit", { p_session_hash: hash, p_first_link_id: input.firstLinkId, p_link_id: input.linkId, p_sequence: input.sequence }).abortSignal(AbortSignal.timeout(1500));
      if (error) throw error;
      return z.uuid().nullable().parse(data);
    },
    async outbound(input: { visitId: string | null; destination: string; surface: string; requestId: string }) {
      const { error } = await db.rpc("record_banksy_outbound", { p_visit_id: input.visitId, p_destination: input.destination, p_surface: input.surface, p_request_id: input.requestId }).abortSignal(AbortSignal.timeout(1500));
      if (error) throw error;
    },
    async command(actor: AdminSession, command: CampaignCommand) {
      const { error } = await db.rpc("command_banksy_tracking_link", { p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_command: command });
      if (error) throw error;
    },
    async read(actor: AdminSession, days: 7 | 30 | 90) {
      const window = campaignWindow(days, new Date());
      const { data, error } = await db.rpc("read_banksy_campaign", { p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_from: window.from, p_to: window.to });
      if (error) throw error;
      return campaignAdminDataSchema.parse(data);
    },
  };
}
export type BanksyRepository = ReturnType<typeof createBanksyRepository>;

export function createBanksyPublicHandlers(repository: Pick<BanksyRepository, "link" | "visit" | "outbound">) {
  return {
    async shared(request: Request, id: string) {
      if (!z.uuid().safeParse(id).success) return redirect(BANKSY_LANDING);
      try {
        const link = await repository.link(id);
        const query = new URLSearchParams({ locale: link?.locale === "en" ? "en" : "ko" });
        if (link?.active && !isCampaignPreview(request)) {
          query.set("campaign_link", id);
          if (link.channel === "mirrorworld") {
            query.set("utm_source", "mirrorworld.ai");
            query.set("utm_medium", "referral");
            query.set("utm_campaign", "banksy");
          }
        }
        return redirect(`${BANKSY_LANDING}?${query}`);
      } catch { return redirect(BANKSY_LANDING); }
    },
    async visit(request: Request) {
      if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "INVALID_ORIGIN" }, 403);
      if (isCampaignPreview(request)) return json({ visitId: null });
      try {
        const input = campaignVisitInputSchema.parse(await boundedJson(request, 1024));
        return json({ visitId: await repository.visit(input) });
      } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof CertificationBodyError) return json({ error: "INVALID_REQUEST" }, 400);
        return json({ error: "MEASUREMENT_UNAVAILABLE" }, 503);
      }
    },
    async outbound(request: Request, value: string) {
      const destination = banksyDestinationSchema.safeParse(value);
      if (!destination.success) return new Response("Not found", { status: 404, headers: redirectHeaders });
      const query = new URL(request.url).searchParams;
      const surface = banksySurfaceSchema.safeParse(query.get("surface"));
      if (!isCampaignPreview(request) && surface.success) {
        const visit = z.uuid().safeParse(query.get("visit"));
        const id = z.uuid().safeParse(query.get("request"));
        try {
          await repository.outbound({ destination: destination.data, surface: surface.data, visitId: visit.success ? visit.data : null, requestId: id.success ? id.data : crypto.randomUUID() });
        } catch { console.error("outbound_link_visit_failed", { campaign: "banksy" }); }
      }
      return redirect(banksyDestinations[destination.data]);
    },
  };
}

export function createBanksyAdminHandlers(repository: Pick<BanksyRepository, "command" | "read">, authorize: (input: { authorization: string; correlationId: string }) => Promise<AdminSession>) {
  return async (request: Request) => {
    try {
      const actor = await authorize({ authorization: request.headers.get("authorization") ?? "", correlationId: crypto.randomUUID() });
      if (request.method === "POST") {
        if (actor.role === "viewer") return json({ error: "FORBIDDEN" }, 403);
        const command = campaignCommandSchema.parse(await boundedJson(request, 2048));
        await repository.command(actor, command);
        return json({ saved: true });
      }
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some(key => key !== "days") || params.getAll("days").length > 1) return json({ error: "INVALID_QUERY" }, 400);
      const days = z.enum(["7", "30", "90"]).parse(params.get("days") ?? "7");
      return json(await repository.read(actor, Number(days) as 7 | 30 | 90));
    } catch (error) {
      if (error instanceof AuthError) return json({ error: error.code }, error.status);
      if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof CertificationBodyError) return json({ error: "INVALID_REQUEST" }, 400);
      return json({ error: "CAMPAIGN_UNAVAILABLE" }, 503);
    }
  };
}
