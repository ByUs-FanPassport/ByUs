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
const actor = { p_actor_app_user_id: process.env.WENA_ADMIN_APP_USER_ID, p_actor_admin_allowlist_id: process.env.WENA_ADMIN_ALLOWLIST_ID };
for (const id of Object.values(actor)) assert.match(id ?? "", /^[0-9a-f-]{36}$/i, "WENA_ADMIN_REQUIRED");
const db = createClient(env[`${prefix}_URL`], env[`${prefix}_SERVICE_ROLE_KEY`], { auth: { persistSession: false, autoRefreshToken: false } });
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const rpc = async (name, args) => must(await db.rpc(name, args));
const root = path.resolve(process.env.WENA_ASSET_ROOT ?? "outputs/wena-assets");
const selection = JSON.parse(await readFile(path.join(root, "selection.json"), "utf8"));
const images = {};
for (const file of ["profile", "photo-1", "photo-2", "photo-3", "photo-4"]) {
  const bytes = await readFile(path.join(root, "web", `${file}.webp`));
  const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
  assert.ok(bytes.length > 0 && bytes.length < 2_000_000 && metadata.format === "webp", `Invalid ${file}`);
  images[file] = { bytes, width: metadata.width, height: metadata.height, hash: createHash("sha256").update(bytes).digest("hex") };
}
const records = await rpc("read_admin_celebrity_cms", { p_actor: actor.p_actor_admin_allowlist_id, p_celebrity: null });
const existing = records.find(record => record.slug === "wena");
assert.ok(!existing?.archivedAt, "WENA_IS_ARCHIVED");
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
    slug: "wena", primaryRole: "idol", imageUrl: assets.profile.url, imagePosition: "50% 0%",
    displayOrder: existing?.displayOrder ?? 110, fanCount: existing?.fanCount ?? 0,
    localizations: {
      ko: { name: "위나", summary: "We;Na의 음악과 사진을 만나고, 퀴즈로 팬 인증을 시작해 보세요.", imageAlt: "파스텔 의상을 입은 위나의 단체 사진" },
      en: { name: "We;Na", summary: "Explore We;Na’s music and photos, and take the fan quiz.", imageAlt: "We;Na group portrait in pastel outfits" },
    },
    themes: existing?.themes ?? [],
    socialLinks: [
      { platform: "youtube", url: "https://www.youtube.com/channel/UCpiXCVf9CaYppJQDDyiD6nA", position: 0, active: true },
      { platform: "instagram", url: "https://www.instagram.com/wena_official_/", position: 1, active: true },
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
// Release credits: https://music.bugs.co.kr/album/20490745 ; official MV: https://www.youtube.com/watch?v=172bEkNPqqs
if (!quizzes.some(quiz => quiz.status === "published")) {
  const questions = [
    { ko: "위나의 데뷔곡은 무엇일까요?", en: "Which song is We;Na’s debut single?", answers: ["Like Psycho", "Baby Step", "Queen", "We;Na World"], correct: 0 },
    { ko: "데뷔 싱글 Like Psycho의 발매일은 언제일까요?", en: "When was We;Na’s debut single Like Psycho released?", answers: ["2021.09.05", "2022.09.05", "2023.09.05", "2024.09.05"], correct: 1 },
    { ko: "위나의 공식 뮤직비디오 제목 ‘Baby ___’의 빈칸에 들어갈 단어는 무엇일까요?", en: "Complete the title of We;Na’s official music video: ‘Baby ___’.", answers: ["Star", "Love", "Step", "Dream"], correct: 2 },
  ].map((question, index) => ({ position: index + 1, promptKo: question.ko, promptEn: question.en, active: true,
    options: question.answers.map((label, index) => ({ position: index + 1, labelKo: label, labelEn: label, isCorrect: index === question.correct, active: true })) }));
  assert.ok(questions.every(question => question.options.filter(option => option.isCorrect).length === 1));
  quizzes = await rpc("save_admin_quiz_version", { ...quizArgs, p_correlation: randomUUID(), p_quiz: quizzes.find(quiz => !quiz.everPublishedAt && quiz.status === "draft")?.id ?? null, p_questions: questions });
  const draft = quizzes.find(quiz => !quiz.everPublishedAt && quiz.status === "draft");
  assert.ok(draft);
  quizzes = await rpc("publish_admin_quiz_version", { ...quizArgs, p_correlation: randomUUID(), p_quiz: draft.id });
}
assert.equal(quizzes.filter(quiz => quiz.status === "published").length, 1);
await rpc("set_admin_celebrity_publication", { ...quizArgs, p_correlation: randomUUID(), p_publish: true });
const notice = must(await db.from("celebrity_notices").select("id,revision,publication_status").eq("celebrity_id", celebrity.id).eq("slug", "welcome-to-wena").maybeSingle());
if (!notice) {
  const paragraph = text => ({ type: "paragraph", content: [{ type: "text", text }] });
  const body = locale => ({ type: "doc", content: [
    paragraph(locale === "ko" ? "위나의 팬페이지에 오신 것을 환영해요. 네 장의 단체 사진과 공식 채널의 음악을 만나보세요." : "Welcome to We;Na’s fan page. Explore four group photos and music from their official channel."),
    paragraph(locale === "ko" ? "데뷔곡 Like Psycho부터 Baby Step까지, 위나의 음악을 알아보고 팬 인증 퀴즈에도 도전해 보세요." : "From Like Psycho to Baby Step, get to know We;Na’s music and try the fan quiz."),
    ...[1, 2, 3, 4].map(n => ({ type: "image", attrs: { src: assets[`photo-${n}`].url, alt: locale === "ko" ? `위나 단체 사진 ${n}` : `We;Na group photo ${n}`, width: images[`photo-${n}`].width, height: images[`photo-${n}`].height } })),
    { type: "paragraph", content: [{ type: "text", text: "We;Na · Baby Step", marks: [{ type: "link", attrs: { href: "https://www.youtube.com/watch?v=172bEkNPqqs", target: "_blank", rel: "noopener noreferrer" } }] }] },
  ] });
  const id = await rpc("save_admin_celebrity_notice", { ...actor, p_correlation_id: randomUUID(), p_notice_id: null, p_expected_revision: null,
    p_celebrity_id: celebrity.id, p_slug: "welcome-to-wena", p_pinned: true,
    p_title_ko: "위나와 함께하는 첫 페이지", p_body_ko: body("ko"), p_title_en: "Your first page with We;Na", p_body_en: body("en"), p_post_type: "notice", p_visibility: "public" });
  const saved = must(await db.from("celebrity_notices").select("revision").eq("id", id).single());
  await rpc("set_admin_celebrity_notice_state", { ...actor, p_correlation_id: randomUUID(), p_notice_id: id, p_expected_revision: saved.revision, p_action: "publish", p_reason: null });
} else if (notice.publication_status === "draft") {
  await rpc("set_admin_celebrity_notice_state", { ...actor, p_correlation_id: randomUUID(), p_notice_id: notice.id, p_expected_revision: notice.revision, p_action: "publish", p_reason: null });
}
const published = must(await db.from("published_celebrities").select("slug,locale,primary_role").eq("slug", "wena"));
assert.deepEqual(published.map(row => row.locale).sort(), ["en", "ko"]);
assert.ok(published.every(row => row.primary_role === "idol"));
const result = { project, celebrityId: celebrity.id, quizId: quizzes.find(quiz => quiz.status === "published").id, assets };
await writeFile(path.join(root, `${production ? "production" : "dev"}-registration.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ status: "PASS", project, celebrityId: celebrity.id, photoCount: 4, quizQuestions: 3 }));
