import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { DEVELOPMENT_SUPABASE_PROJECT_REF } from "./local-development-env.mjs";
import { PRODUCTION_SUPABASE_PROJECT_REF, readEnvironmentFile } from "./local-production-env.mjs";

// Run from the repository root. The default is a read-only preflight.
// --apply uses existing CMS RPCs. --production publishes only the profile, photos and quiz; never test events.
const apply = process.argv.includes("--apply");
const production = process.argv.includes("--production");
const project = production ? PRODUCTION_SUPABASE_PROJECT_REF : DEVELOPMENT_SUPABASE_PROJECT_REF;
const prefix = production ? "SUPABASE_PROD" : "SUPABASE_DEV";
const environment = await readEnvironmentFile(".env.supabase.local");
assert.equal(new URL(environment[`${prefix}_URL`]).hostname, `${project}.supabase.co`, "NCHIVE_PROJECT_MISMATCH");
const actor = {
  p_actor_app_user_id: process.env.BYUS_NCHIVE_ADMIN_APP_USER_ID,
  p_actor_admin_allowlist_id: process.env.BYUS_NCHIVE_ADMIN_ALLOWLIST_ID,
};
assert.match(actor.p_actor_app_user_id ?? "", /^[0-9a-f-]{36}$/i, "NCHIVE_ADMIN_APP_USER_ID_REQUIRED");
assert.match(actor.p_actor_admin_allowlist_id ?? "", /^[0-9a-f-]{36}$/i, "NCHIVE_ADMIN_ALLOWLIST_ID_REQUIRED");
const db = createClient(environment[`${prefix}_URL`], environment[`${prefix}_SERVICE_ROLE_KEY`], { auth: { persistSession: false, autoRefreshToken: false } });
const rpc = async (name, args) => {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
};
const root = path.resolve("outputs/nchive-assets");
const selection = JSON.parse(await readFile(path.join(root, "selection.json"), "utf8"));
const roles = ["profile", "portrait", "landscape"];
const images = {};
for (const role of roles) {
  const filename = path.resolve(root, selection[role].file);
  assert.ok(filename.startsWith(`${root}${path.sep}`), "NCHIVE_IMAGE_PATH_OUTSIDE_ASSETS");
  const bytes = await readFile(filename);
  const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
  assert.ok(bytes.length > 0 && bytes.length <= 8 * 1024 * 1024 && metadata.format === "webp", `Invalid ${role} service image`);
  images[role] = { bytes, width: metadata.width, height: metadata.height, hash: createHash("sha256").update(bytes).digest("hex") };
}
const records = await rpc("read_admin_celebrity_cms", { p_actor: actor.p_actor_admin_allowlist_id, p_celebrity: null });
const existing = records.find((record) => record.slug === "nchive");
if (!apply) {
  console.log(JSON.stringify({ status: "READY", project, existing: existing?.id ?? null, images: roles.map((role) => ({ role, width: images[role].width, height: images[role].height })) }));
  process.exit(0);
}

const assets = {};
for (const role of roles) {
  const image = images[role];
  const storagePath = `public-image-assets/${image.hash}.webp`;
  const bucket = db.storage.from("cms-assets");
  const uploaded = await bucket.upload(storagePath, image.bytes, { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable", upsert: false });
  if (uploaded.error && Number(uploaded.error.statusCode) !== 409 && !/duplicate|already exists/i.test(uploaded.error.message)) throw uploaded.error;
  assets[role] = await rpc("register_admin_public_image_asset", {
    ...actor, p_correlation_id: randomUUID(), p_content_sha256: image.hash, p_storage_path: storagePath,
    p_url: bucket.getPublicUrl(storagePath).data.publicUrl, p_width: image.width, p_height: image.height,
    p_mime_type: "image/webp", p_byte_size: image.bytes.length,
  });
}
const celebrity = await rpc("save_admin_celebrity", {
  p_actor: actor.p_actor_admin_allowlist_id, p_correlation: randomUUID(), p_celebrity: existing?.id ?? null,
  p_payload: {
    slug: "nchive", primaryRole: "idol", imageUrl: assets.profile.url, imagePosition: "50% 50%",
    displayOrder: existing?.displayOrder ?? 100, fanCount: existing?.fanCount ?? 0,
    localizations: {
      ko: { name: "엔카이브", summary: "엔카이브의 공식 영상과 LIVE, 팬 이벤트 소식을 만나보세요.", imageAlt: "엔카이브 단체 사진" },
      en: { name: "NCHIVE", summary: "Official NCHIVE videos, LIVE updates and fan events.", imageAlt: "NCHIVE group portrait" },
    },
    themes: [],
    socialLinks: [
      { platform: "youtube", url: "https://www.youtube.com/channel/UCO-svEJBdWiaViuy0TxVFFg", position: 0, active: true },
      { platform: "instagram", url: "https://www.instagram.com/official_nchive/", position: 1, active: true },
      { platform: "tiktok", url: "https://www.tiktok.com/@nchive_official", position: 2, active: true },
    ],
  },
});
assert.ok(celebrity?.id, "NCHIVE_REGISTRATION_FAILED");
const imageRoles = await rpc("read_admin_public_image_roles", { ...actor, p_owner_type: "celebrity", p_owner_id: celebrity.id });
for (const role of roles) {
  const asset = assets[role];
  const frames = Object.fromEntries(Object.entries(selection[role].frames).map(([slot, frame]) => [slot, { ...frame, approvedAssetRevision: frame.fit === "cover" ? asset.revision : null }]));
  await rpc("set_admin_public_image_role", {
    ...actor, p_correlation_id: randomUUID(), p_owner_type: "celebrity", p_owner_id: celebrity.id,
    p_role: role, p_expected_revision: imageRoles.find((record) => record.role === role)?.revision ?? 0,
    p_asset_id: asset.id, p_alt: selection[role].alt, p_frames: frames,
  });
}

// Stable debut facts from the official 2024-04-09 DONGRAMYPROJECT press release:
// https://prtimes.jp/main/html/rd/p/000000065.000107950.html
const quizArgs = { p_actor: actor.p_actor_admin_allowlist_id, p_celebrity: celebrity.id };
let quizzes = await rpc("read_admin_quiz_cms", quizArgs);
if (!quizzes.some((quiz) => quiz.status === "published")) {
  const questions = [
    { ko: "엔카이브의 데뷔일은 언제일까요?", en: "When did NCHIVE debut?", answers: ["2023.04.09", "2024.04.09", "2024.05.09", "2025.04.09"], correct: 1 },
    { ko: "엔카이브의 데뷔 앨범 제목은 무엇일까요?", en: "What is the title of NCHIVE’s debut album?", answers: ["START", "FIRST", "Drive", "RUN"], correct: 2 },
    { ko: "데뷔 앨범 Drive의 타이틀곡은 무엇일까요?", en: "What is the title track of NCHIVE’s debut album Drive?", answers: ["RACER", "DRIVER", "SPEED", "ON THE ROAD"], correct: 0 },
  ].map((question, index) => ({ position: index + 1, promptKo: question.ko, promptEn: question.en, active: true,
    options: question.answers.map((label, option) => ({ position: option + 1, labelKo: label, labelEn: label, isCorrect: option === question.correct, active: true })),
  }));
  quizzes = await rpc("save_admin_quiz_version", { ...quizArgs, p_correlation: randomUUID(), p_quiz: quizzes.find((quiz) => !quiz.everPublishedAt && quiz.status === "draft")?.id ?? null, p_questions: questions });
  const draft = quizzes.find((quiz) => !quiz.everPublishedAt && quiz.status === "draft");
  quizzes = await rpc("publish_admin_quiz_version", { ...quizArgs, p_correlation: randomUUID(), p_quiz: draft.id });
}
assert.equal(quizzes.filter((quiz) => quiz.status === "published").length, 1);
await rpc("set_admin_celebrity_publication", { ...quizArgs, p_correlation: randomUUID(), p_publish: true });
const { data: published, error } = await db.from("published_celebrities").select("slug,locale,primary_role").eq("slug", "nchive");
if (error) throw error;
assert.deepEqual(published.map((row) => row.locale).sort(), ["en", "ko"]);
assert.ok(published.every((row) => row.primary_role === "idol"));
const result = { project, celebrityId: celebrity.id, quizId: quizzes.find((quiz) => quiz.status === "published").id, assets };
if (production) {
  await writeFile(path.join(root, "production-registration.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: "PASS", project, celebrityId: celebrity.id, imageRoles: roles, testEventsCreated: false }));
  process.exit(0);
}
// Clearly labelled Dev fixtures; real schedules and prizes must be supplied before production publication.
const must = ({ data, error }) => { if (error) throw error; return data; };
const manager = await rpc("get_admin_live_manager", { ...actor, p_live_event_id: null });
let live = manager.lives.find((item) => item.slug === "nchive-dev-live");
if (!live) {
  const brand = must(await db.from("brands").select("id").eq("slug", "byus").eq("status", "published").single());
  const date = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
  live = await rpc("save_admin_live_draft_v3", {
    ...actor, p_correlation_id: randomUUID(), p_live_event_id: null, p_slug: "nchive-dev-live",
    p_celebrity_id: celebrity.id, p_brand_id: brand.id,
    p_starts_at: date(7), p_ends_at: date(7 + 1 / 24), p_reservation_opens_at: date(-1), p_reservation_closes_at: date(6),
    p_live_provider: "youtube", p_external_live_url: "https://www.youtube.com/embed/videoseries?list=UUO-svEJBdWiaViuy0TxVFFg",
    p_hero_url: assets.landscape.url,
    p_title_ko: "[테스트] 엔카이브 LIVE", p_summary_ko: "개발 검증용 일정입니다. 실제 행사나 방송 일정이 아닙니다.", p_hero_alt_ko: "엔카이브 단체 사진",
    p_title_en: "[TEST] NCHIVE LIVE", p_summary_en: "Development test only. This is not a real event or broadcast schedule.", p_hero_alt_en: "NCHIVE group portrait",
  });
}
const rewards = await rpc("get_admin_live_reward_settings", { ...actor, p_live_event_id: live.id });
if (rewards[0].status === "draft") await rpc("publish_admin_live_reward_settings", {
  ...actor, p_correlation_id: randomUUID(), p_live_event_id: live.id, p_expected_revision: rewards[0].revision,
});
await rpc("set_admin_live_publication", { ...actor, p_correlation_id: randomUUID(), p_live_event_id: live.id, p_published: true });
const livePhotos = await rpc("read_admin_public_image_roles", { ...actor, p_owner_type: "live", p_owner_id: live.id });
for (const [role, slots] of [["landscape", ["event.home.desktop", "event.detail"]], ["portrait", ["event.home.mobile"]], ["poster", ["event.poster"]]]) {
  const imageRole = role === "poster" ? "profile" : role;
  await rpc("set_admin_public_image_role", { ...actor, p_correlation_id: randomUUID(), p_owner_type: "live", p_owner_id: live.id,
    p_role: role, p_expected_revision: livePhotos.find((record) => record.role === role)?.revision ?? 0,
    p_asset_id: assets[imageRole].id, p_alt: selection[imageRole].alt,
    p_frames: Object.fromEntries(slots.map((slot) => [slot, {
      fit: role === "poster" ? "contain" : "cover", x: 50, y: role === "landscape" ? 20 : 15,
      approvedAssetRevision: role === "poster" ? null : assets[imageRole].revision,
    }])),
  });
}
const benefitManager = await rpc("get_admin_benefit_manager", actor);
let benefit = benefitManager.benefits.find((item) => item.slug === "nchive-dev-raffle");
if (!benefit) {
  const benefitId = await rpc("save_admin_benefit_draft", {
    ...actor, p_correlation_id: randomUUID(), p_benefit_id: null, p_expected_revision: null,
    p_slug: "nchive-dev-raffle", p_celebrity_id: celebrity.id, p_allocation_mode: "application_selection", p_delivery_type: "text",
    p_claim_opens_at: live.reservationOpensAt ?? new Date(Date.now() - 86_400_000).toISOString(),
    p_claim_closes_at: live.endsAt ?? new Date(Date.now() + 8 * 86_400_000).toISOString(),
    p_stock_limit: 1, p_per_user_limit: 1, p_minimum_score: 0, p_minimum_level: "Bronze", p_required_stamp_type: null, p_required_activity_type: null,
    p_title_ko: "[테스트] 엔카이브 래플", p_summary_ko: "개발 검증용 응모입니다. 실제 경품은 제공되지 않습니다.", p_eligibility_ko: "팬 인증 후 티켓으로 응모", p_delivery_ko: "테스트 결과 안내",
    p_title_en: "[TEST] NCHIVE raffle", p_summary_en: "Development test only. No real prize will be delivered.", p_eligibility_en: "Verify your fan status and enter with a ticket", p_delivery_en: "Test result only", p_delivery_secret: "Development fixture. No real prize.",
  });
  benefit = { id: benefitId, revision: 1, publicationStatus: "draft" };
}
if (benefit.publicationStatus === "draft") await rpc("set_admin_benefit_state", {
  ...actor, p_correlation_id: randomUUID(), p_benefit_id: benefit.id, p_expected_revision: benefit.revision, p_action: "publish", p_reason: null,
});
const campaigns = await rpc("get_admin_benefit_campaigns", actor);
let campaign = campaigns.find((item) => item.liveEventId === live.id);
if (!campaign) {
  const id = await rpc("save_admin_benefit_campaign", {
    ...actor, p_correlation_id: randomUUID(), p_campaign_id: null, p_expected_revision: null, p_live_event_id: live.id,
    p_entry_opens_at: new Date(Date.now() - 86_400_000).toISOString(), p_entry_closes_at: live.reservationClosesAt ?? new Date(Date.now() + 6 * 86_400_000).toISOString(),
    p_benefits: [{ benefitId: benefit.id, priority: 1, perFanTicketLimit: 20, winnerQuantity: 1, fulfillmentMethod: "digital" }], p_public_teaser: true,
  });
  campaign = { id, revision: 1, status: "draft" };
}
if (campaign.status === "draft") await rpc("publish_admin_benefit_campaign", {
  ...actor, p_correlation_id: randomUUID(), p_campaign_id: campaign.id, p_expected_revision: campaign.revision,
});
Object.assign(result, { liveId: live.id, benefitId: benefit.id, campaignId: campaign.id });
await writeFile(path.join(root, "dev-registration.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ status: "PASS", project: result.project, celebrityId: celebrity.id, locales: ["ko", "en"], imageRoles: roles, primaryRole: "idol" }));
