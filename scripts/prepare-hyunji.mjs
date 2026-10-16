import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { DEVELOPMENT_SUPABASE_PROJECT_REF } from "./local-development-env.mjs";
import { PRODUCTION_SUPABASE_PROJECT_REF, readEnvironmentFile } from "./local-production-env.mjs";

// Read-only by default. --apply publishes through the same audited CMS commands as the admin UI.
const production = process.argv.includes("--production"), apply = process.argv.includes("--apply");
const project = production ? PRODUCTION_SUPABASE_PROJECT_REF : DEVELOPMENT_SUPABASE_PROJECT_REF;
const prefix = production ? "SUPABASE_PROD" : "SUPABASE_DEV";
const env = await readEnvironmentFile(".env.supabase.local");
assert.equal(new URL(env[`${prefix}_URL`]).hostname, `${project}.supabase.co`);
const actor = { p_actor_app_user_id: process.env.HYUNJI_ADMIN_APP_USER_ID, p_actor_admin_allowlist_id: process.env.HYUNJI_ADMIN_ALLOWLIST_ID };
for (const id of Object.values(actor)) assert.match(id ?? "", /^[0-9a-f-]{36}$/i, "HYUNJI_ADMIN_REQUIRED");
const db = createClient(env[`${prefix}_URL`], env[`${prefix}_SERVICE_ROLE_KEY`], { auth: { persistSession: false, autoRefreshToken: false } });
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const rpc = async (name, args) => must(await db.rpc(name, args));
const root = path.resolve(process.env.HYUNJI_ASSET_ROOT ?? "outputs/hyunji-assets");
const selection = JSON.parse(await readFile(path.join(root, "selection.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.photos.length, 8);
const images = {};
for (const file of ["profile", ...Array.from({ length: 8 }, (_, index) => `photo-${index + 1}`)]) {
  const bytes = await readFile(path.join(root, "web", `${file}.webp`));
  const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
  assert.ok(bytes.length > 0 && bytes.length < 2_000_000 && metadata.format === "webp", `Invalid ${file}`);
  images[file] = { bytes, width: metadata.width, height: metadata.height, hash: createHash("sha256").update(bytes).digest("hex") };
}
const records = await rpc("read_admin_celebrity_cms", { p_actor: actor.p_actor_admin_allowlist_id, p_celebrity: null });
const existing = records.find(record => record.slug === "hyunji");
assert.ok(!existing?.archivedAt, "HYUNJI_IS_ARCHIVED");
if (!apply) {
  console.log(JSON.stringify({ status: "READY", project, existing: existing?.id ?? null, images: Object.keys(images) }));
  process.exit(0);
}
const assets = {};
for (const [file, image] of Object.entries(images)) {
  const storagePath = `public-image-assets/${image.hash}.webp`, bucket = db.storage.from("cms-assets");
  const uploaded = await bucket.upload(storagePath, image.bytes, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
  if (uploaded.error && Number(uploaded.error.statusCode) !== 409 && !/duplicate|already exists/i.test(uploaded.error.message)) throw uploaded.error;
  assets[file] = await rpc("register_admin_public_image_asset", {
    ...actor, p_correlation_id: randomUUID(), p_content_sha256: image.hash, p_storage_path: storagePath,
    p_url: bucket.getPublicUrl(storagePath).data.publicUrl, p_width: image.width, p_height: image.height,
    p_mime_type: "image/webp", p_byte_size: image.bytes.length,
  });
}
const celebrity = await rpc("save_admin_celebrity", {
  p_actor: actor.p_actor_admin_allowlist_id, p_correlation: randomUUID(), p_celebrity: existing?.id ?? null,
  p_payload: {
    slug: "hyunji", primaryRole: "creator", imageUrl: assets.profile.url, imagePosition: "50% 50%",
    displayOrder: existing?.displayOrder ?? 120, fanCount: existing?.fanCount ?? 0,
    localizations: {
      ko: { name: "현지", summary: "현지의 사진과 일상을 만나고, 팬 인증 퀴즈에 도전해 보세요.", imageAlt: "창가에 앉아 있는 현지" },
      en: { name: "Hyunji", summary: "Explore Hyunji’s photos and everyday moments, and try the fan quiz.", imageAlt: "Hyunji sitting beside a window" },
    },
    themes: existing?.themes ?? [],
    socialLinks: [
      { platform: "instagram", url: "https://www.instagram.com/hyunjiiee/", position: 0, active: true },
    ],
  },
});
assert.ok(celebrity?.id);
const roles = await rpc("read_admin_public_image_roles", { ...actor, p_owner_type: "celebrity", p_owner_id: celebrity.id });
for (const [role, config] of Object.entries(selection)) {
  const asset = assets[config.asset];
  assert.ok(asset, `Missing ${role} asset`);
  const frames = Object.fromEntries(Object.entries(config.frames).map(([slot, frame]) => [slot, { ...frame, approvedAssetRevision: frame.fit === "cover" ? asset.revision : null }]));
  await rpc("set_admin_public_image_role", { ...actor, p_correlation_id: randomUUID(), p_owner_type: "celebrity", p_owner_id: celebrity.id,
    p_role: role, p_expected_revision: roles.find(record => record.role === role)?.revision ?? 0, p_asset_id: asset.id, p_alt: config.alt, p_frames: frames });
}
const quizArgs = { p_actor: actor.p_actor_admin_allowlist_id, p_celebrity: celebrity.id };
let quizzes = await rpc("read_admin_quiz_cms", quizArgs);
// Profile and pinned photo verified on https://www.instagram.com/hyunjiiee/ on 2026-10-16.
if (!quizzes.some(quiz => quiz.status === "published")) {
  const questions = [
    { ko: "현지의 Instagram 아이디는 무엇일까요?", en: "What is Hyunji’s Instagram username?", answers: [["hyunjiiee", "hyunjiiee"], ["hyunji_daily", "hyunji_daily"], ["hello_hyunji", "hello_hyunji"], ["hyunji_official", "hyunji_official"]], correct: 0 },
    { ko: "현지의 Instagram 프로필에 표시된 이름은 무엇일까요?", en: "Which name appears on Hyunji’s Instagram profile?", answers: [["현아", "현아"], ["현 지", "현 지"], ["지현", "지현"], ["현정", "현정"]], correct: 1 },
    { ko: "현지의 Instagram 고정 게시물 첫 사진에는 무엇이 담겨 있나요?", en: "What appears in the first photo of Hyunji’s pinned Instagram post?", answers: [["바다", "The sea"], ["생일 케이크", "A birthday cake"], ["흰 꽃다발", "A white bouquet"], ["붉은 장미", "Red roses"]], correct: 2 },
  ].map((question, index) => ({ position: index + 1, promptKo: question.ko, promptEn: question.en, active: true,
    options: question.answers.map(([labelKo, labelEn], index) => ({ position: index + 1, labelKo, labelEn, isCorrect: index === question.correct, active: true })) }));
  assert.ok(questions.every(question => question.options.filter(option => option.isCorrect).length === 1));
  quizzes = await rpc("save_admin_quiz_version", { ...quizArgs, p_correlation: randomUUID(), p_quiz: quizzes.find(quiz => !quiz.everPublishedAt && quiz.status === "draft")?.id ?? null, p_questions: questions });
  const draft = quizzes.find(quiz => !quiz.everPublishedAt && quiz.status === "draft");
  assert.ok(draft);
  quizzes = await rpc("publish_admin_quiz_version", { ...quizArgs, p_correlation: randomUUID(), p_quiz: draft.id });
}
assert.equal(quizzes.filter(quiz => quiz.status === "published").length, 1);
await rpc("set_admin_celebrity_publication", { ...quizArgs, p_correlation: randomUUID(), p_publish: true });
const notice = must(await db.from("celebrity_notices").select("id,revision,publication_status").eq("celebrity_id", celebrity.id).eq("slug", "welcome-to-hyunji").maybeSingle());
if (!notice) {
  const paragraph = text => ({ type: "paragraph", content: [{ type: "text", text }] });
  const body = locale => ({ type: "doc", content: [
    paragraph(locale === "ko" ? "현지의 팬페이지에 오신 것을 환영해요. Instagram에 담긴 여덟 장의 사진으로 현지의 일상을 만나보세요." : "Welcome to Hyunji’s fan page. Discover eight everyday moments from her Instagram."),
    paragraph(locale === "ko" ? "현지의 Instagram 아이디는 @hyunjiiee, 프로필 이름은 ‘현 지’예요. 고정 게시물의 첫 사진에는 흰 꽃다발이 담겨 있어요. 사진을 둘러보고 팬 인증 퀴즈에도 도전해 보세요." : "Her Instagram username is @hyunjiiee and her profile name is ‘현 지’. The first photo in her pinned post shows a white bouquet. Explore the photos, then try the fan quiz."),
    ...manifest.photos.map(photo => ({ type: "image", attrs: { src: assets[photo.name].url, alt: photo.alt[locale], width: images[photo.name].width, height: images[photo.name].height } })),
    { type: "paragraph", content: [{ type: "text", text: "Instagram · @hyunjiiee", marks: [{ type: "link", attrs: { href: "https://www.instagram.com/hyunjiiee/", target: "_blank", rel: "noopener noreferrer" } }] }] },
  ] });
  const id = await rpc("save_admin_celebrity_notice", { ...actor, p_correlation_id: randomUUID(), p_notice_id: null, p_expected_revision: null,
    p_celebrity_id: celebrity.id, p_slug: "welcome-to-hyunji", p_pinned: true,
    p_title_ko: "사진으로 만나는 현지의 일상", p_body_ko: body("ko"), p_title_en: "Everyday moments with Hyunji", p_body_en: body("en"), p_post_type: "notice", p_visibility: "public" });
  const saved = must(await db.from("celebrity_notices").select("revision").eq("id", id).single());
  await rpc("set_admin_celebrity_notice_state", { ...actor, p_correlation_id: randomUUID(), p_notice_id: id, p_expected_revision: saved.revision, p_action: "publish", p_reason: null });
} else if (notice.publication_status === "draft") {
  await rpc("set_admin_celebrity_notice_state", { ...actor, p_correlation_id: randomUUID(), p_notice_id: notice.id, p_expected_revision: notice.revision, p_action: "publish", p_reason: null });
}
const published = must(await db.from("published_celebrities").select("slug,locale,primary_role,social_links").eq("slug", "hyunji"));
assert.deepEqual(published.map(row => row.locale).sort(), ["en", "ko"]);
assert.ok(published.every(row => row.primary_role === "creator"));
assert.ok(published.every(row => row.social_links.length === 1 && row.social_links[0].platform === "instagram" && row.social_links[0].url === "https://www.instagram.com/hyunjiiee/"));
const result = { project, celebrityId: celebrity.id, quizId: quizzes.find(quiz => quiz.status === "published").id, assets };
await writeFile(path.join(root, `${production ? "production" : "dev"}-registration.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ status: "PASS", project, celebrityId: celebrity.id, photoCount: 8, quizQuestions: 3 }));
