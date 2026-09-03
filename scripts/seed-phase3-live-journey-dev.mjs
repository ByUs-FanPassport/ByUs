import { createClient } from "@supabase/supabase-js";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
if (required("SUPABASE_DEV_PROJECT_REF") !== "xcppyedwusirqnfpbtit") throw new Error("PHASE3_DEV_PROJECT_MISMATCH");
if (process.env.BYUS_PHASE3_DEV_SEED_CONFIRM !== "I_UNDERSTAND_PHASE3_DEV_MUTATION") throw new Error("PHASE3_DEV_MUTATION_OPT_IN_REQUIRED");

const actor = {
  appUserId: required("BYUS_PHASE3_ADMIN_APP_USER_ID"),
  allowlistId: required("BYUS_PHASE3_ADMIN_ALLOWLIST_ID"),
};
const db = createClient(required("SUPABASE_DEV_URL"), required("SUPABASE_DEV_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const must = (label, result) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};
const rpc = async (name, args, label = name) => must(label, await db.rpc(name, args));
const correlation = () => crypto.randomUUID();

const { data: celebrities, error: celebrityError } = await db.from("celebrities").select("id,slug").in("slug", ["kara", "katseye"]);
must("creators", { data: celebrities, error: celebrityError });
const creator = Object.fromEntries((celebrities ?? []).map((item) => [item.slug, item.id]));
if (!creator.kara || !creator.katseye) throw new Error("PHASE3_TWO_CREATORS_REQUIRED");
const { data: brand, error: brandError } = await db.from("brands").select("id").eq("status", "published").limit(1).single();
must("published brand", { data: brand, error: brandError });

const manager = await rpc("get_admin_live_manager", {
  p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_live_event_id: null,
});

async function ensureLive(input) {
  const prior = manager.lives.find((item) => item.slug === input.slug);
  if (prior) {
    if (prior.liveProvider !== input.provider || prior.externalLiveUrl !== input.url || prior.celebrityId !== creator[input.creator]) {
      throw new Error(`PHASE3_FIXTURE_DRIFT: ${input.slug}`);
    }
    return prior.id;
  }
  const saved = await rpc("save_admin_live_draft_v3", {
    p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_correlation_id: correlation(),
    p_live_event_id: null, p_slug: input.slug, p_celebrity_id: creator[input.creator], p_brand_id: brand.id,
    p_starts_at: input.startsAt, p_ends_at: input.endsAt,
    p_reservation_opens_at: new Date(Date.parse(input.startsAt) - 7 * 86_400_000).toISOString(),
    p_reservation_closes_at: new Date(Date.parse(input.startsAt) - 10 * 60_000).toISOString(),
    p_live_provider: input.provider, p_external_live_url: input.url, p_hero_url: "/images/live/kara-hero-group.jpg",
    p_title_ko: input.title, p_summary_ko: "Phase 3 비프로덕션 검증 LIVE", p_hero_alt_ko: "ByUs Phase 3 LIVE",
    p_title_en: input.title, p_summary_en: "Phase 3 non-production verification LIVE", p_hero_alt_en: "ByUs Phase 3 LIVE",
  }, `create ${input.slug}`);
  await rpc("set_admin_live_publication", {
    p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId,
    p_correlation_id: correlation(), p_live_event_id: saved.id, p_published: true,
  }, `publish ${input.slug}`);
  return saved.id;
}

const now = Date.now();
const claimLiveId = await ensureLive({
  slug: "p3-collectible-20260904", creator: "katseye", provider: "youtube",
  url: "https://www.youtube.com/watch?v=byusP3Claim", title: "Phase 3 Collectible Claim LIVE",
  startsAt: new Date(now - 30 * 60_000).toISOString(), endsAt: new Date(now + 60 * 60_000).toISOString(),
});
await ensureLive({ slug: "p3-youtube-20260930", creator: "katseye", provider: "youtube", url: "https://www.youtube.com/watch?v=byusP3Close", title: "Phase 3 YouTube LIVE", startsAt: "2026-09-30T11:00:00.000Z", endsAt: "2026-09-30T12:00:00.000Z" });
await ensureLive({ slug: "p3-instagram-20261001", creator: "kara", provider: "instagram", url: "https://www.instagram.com/byus.official/live/", title: "Phase 3 Instagram LIVE", startsAt: "2026-10-01T11:00:00.000Z", endsAt: "2026-10-01T12:00:00.000Z" });
await ensureLive({ slug: "p3-tiktok-20261002", creator: "katseye", provider: "tiktok", url: "https://www.tiktok.com/@byus.official/live", title: "Phase 3 TikTok LIVE", startsAt: "2026-10-02T11:00:00.000Z", endsAt: "2026-10-02T12:00:00.000Z" });

const requirementRows = await rpc("get_admin_live_journey_requirements", {
  p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_live_event_id: claimLiveId,
});
if (!requirementRows[0]?.published) {
  const rewardRows = await rpc("get_admin_live_reward_settings", {
    p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_live_event_id: claimLiveId,
  });
  let reward = rewardRows[0];
  if (!reward) throw new Error("PHASE3_PUBLISHED_REWARD_REQUIRED");
  if (reward.status === "draft" && reward.journeyBonusTicket === 3) {
    await rpc("publish_admin_live_reward_settings", {
      p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_correlation_id: correlation(),
      p_live_event_id: claimLiveId, p_expected_revision: reward.revision,
    });
  } else if (reward.journeyBonusTicket !== 3) {
    const draft = await rpc("save_admin_live_reward_settings", {
      p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_correlation_id: correlation(),
      p_live_event_id: claimLiveId, p_expected_revision: reward.revision,
      p_mission_score: reward.missionScore, p_mission_ticket: reward.missionTicket, p_journey_bonus_ticket: 3,
    });
    await rpc("publish_admin_live_reward_settings", {
      p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_correlation_id: correlation(),
      p_live_event_id: claimLiveId, p_expected_revision: draft.revision,
    });
  }
  const draft = await rpc("save_admin_live_journey_requirement", {
    p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_correlation_id: correlation(),
    p_live_event_id: claimLiveId, p_expected_revision: 0, p_require_passport: true,
    p_require_reservation: false, p_require_attendance: false, p_bonus_ticket_amount: 3, p_missions: [],
  });
  await rpc("publish_admin_live_journey_requirement", {
    p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_correlation_id: correlation(),
    p_live_event_id: claimLiveId, p_expected_revision: draft.revision,
  });
  await rpc("create_admin_live_status_override", {
    p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_correlation_id: correlation(),
    p_live_event_id: claimLiveId, p_effective_status: "ended", p_effective_from: new Date().toISOString(),
    p_effective_until: null, p_reason: "Phase 3 Collectible Dev claim window proof",
  });
}

const multiLive = manager.lives.find((item) => item.slug === "katseye-touch-watch-party");
if (!multiLive) throw new Error("PHASE3_MULTI_MISSION_LIVE_REQUIRED");
const multiRequirements = await rpc("get_admin_live_journey_requirements", {
  p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_live_event_id: multiLive.id,
});
if (!multiRequirements[0]?.published) {
  const missions = multiRequirements[0]?.missionOptions.filter((item) => item.publicationStatus === "published" && item.lifecycleStatus === "published");
  if (!missions || missions.length < 2) throw new Error("PHASE3_MULTI_MISSION_OPTIONS_REQUIRED");
  const reward = multiRequirements[0].publishedReward;
  const draft = await rpc("save_admin_live_journey_requirement", {
    p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_correlation_id: correlation(),
    p_live_event_id: multiLive.id, p_expected_revision: 0, p_require_passport: true,
    p_require_reservation: true, p_require_attendance: true, p_bonus_ticket_amount: reward.bonusTicketAmount,
    p_missions: missions.map(({ missionId, version }) => ({ missionId, version })),
  });
  await rpc("publish_admin_live_journey_requirement", {
    p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId, p_correlation_id: correlation(),
    p_live_event_id: multiLive.id, p_expected_revision: draft.revision,
  });
}

process.stdout.write(`${JSON.stringify({ status: "PASS", claimLiveId, providerLives: 3, creators: 2, zeroMissionJourney: true, multiMissionJourney: true })}\n`);
