import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { DEVELOPMENT_SUPABASE_PROJECT_REF } from "./local-development-env.mjs";
import { PRODUCTION_SUPABASE_PROJECT_REF, readEnvironmentFile } from "./local-production-env.mjs";

// Read-only by default. Reuse the approved WENA photos and audited banner commands.
const production = process.argv.includes("--production"), apply = process.argv.includes("--apply");
const prefix = production ? "SUPABASE_PROD" : "SUPABASE_DEV";
const project = production ? PRODUCTION_SUPABASE_PROJECT_REF : DEVELOPMENT_SUPABASE_PROJECT_REF;
const env = await readEnvironmentFile(".env.supabase.local");
assert.equal(new URL(env[`${prefix}_URL`]).hostname, `${project}.supabase.co`);
const actor = { p_actor_app_user_id: process.env.WENA_ADMIN_APP_USER_ID, p_actor_admin_allowlist_id: process.env.WENA_ADMIN_ALLOWLIST_ID };
for (const id of Object.values(actor)) assert.match(id ?? "", /^[0-9a-f-]{36}$/i, "WENA_ADMIN_REQUIRED");
const db = createClient(env[`${prefix}_URL`], env[`${prefix}_SERVICE_ROLE_KEY`], { auth: { persistSession: false, autoRefreshToken: false } });
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const rpc = async (name, args) => must(await db.rpc(name, args));
const read = () => rpc("get_admin_home_banner_manager", actor);
const creator = must(await db.from("celebrities").select("id,status").eq("slug", "wena").single());
assert.equal(creator.status, "published", "WENA_MUST_BE_PUBLISHED");
const hashes = [
  "3a7b1190beb9a0a49daad1f5fcab87e541512c4a98345f6051eee71df43fa132", // Approved square group photo.
  "d28368aaf26a1ee76366cd647eb9f5807ddc0bae044f24c3186602c71c692232", // Full group photo above the mobile invitation.
];
const registration = JSON.parse(await readFile(path.join(process.env.WENA_ASSET_ROOT ?? "outputs/wena-assets", `${production ? "production" : "dev"}-registration.json`), "utf8"));
assert.equal(registration.project, project, "WENA_ASSET_PROJECT_MISMATCH");
assert.equal(registration.celebrityId, creator.id, "WENA_ASSET_OWNER_MISMATCH");
const [desktop, mobile] = [registration.assets.profile, registration.assets["photo-4"]];
assert.ok(desktop && mobile, "WENA_APPROVED_PHOTOS_REQUIRED");
assert.deepEqual([desktop.width, desktop.height, mobile.width, mobile.height], [1200, 1200, 2560, 1890]);
for (const [index, asset] of [desktop, mobile].entries()) {
  assert.match(asset.id, /^[0-9a-f-]{36}$/i);
  assert.equal(asset.url, `${env[`${prefix}_URL`]}/storage/v1/object/public/cms-assets/public-image-assets/${hashes[index]}.webp`);
}
const common = { title: "We;Na × Kyaa", href: "/wena", desktopAssetId: desktop.id, mobileAssetId: mobile.id };
const localizations = {
  ko: { ...common, description: "위나의 음악과 사진을 만나고, 팬 인증 퀴즈에 도전해 보세요.", ctaLabel: "위나 팬페이지 보기", alt: "위나의 네 멤버가 함께한 단체 사진" },
  en: { ...common, description: "Explore We;Na’s music and photos, and take the fan quiz.", ctaLabel: "Meet We;Na", alt: "All four members of We;Na together" },
};
let manager = await read();
let banner = manager.items.find(item => item.kind === "announcement" && item.celebrityId === creator.id);
if (banner) {
  for (const locale of ["ko", "en"]) {
    for (const key of ["title", "description", "ctaLabel", "href", "alt"]) {
      assert.equal(banner.localizations[locale][key], localizations[locale][key], "WENA_BANNER_MANUALLY_EDITED");
    }
    assert.equal(banner.localizations[locale].desktopImage?.id, desktop.id, "WENA_BANNER_ARTWORK_CHANGED");
    assert.equal(banner.localizations[locale].mobileImage?.id, mobile.id, "WENA_BANNER_ARTWORK_CHANGED");
  }
}
if (!apply) {
  console.log(JSON.stringify({ status: "READY", project, existing: banner?.id ?? null, localizations, currentOrder: manager.items.map(item => item.id) }));
  process.exit(0);
}
if (!banner) {
  const created = await rpc("save_admin_home_banner", {
    ...actor, p_correlation_id: randomUUID(), p_banner_id: null, p_expected_revision: 0,
    p_kind: "announcement", p_celebrity_id: creator.id, p_localizations: localizations,
  });
  manager = await read();
  banner = manager.items.find(item => item.id === created.id);
}
assert.ok(banner, "WENA_BANNER_MISSING");
if (banner.publicationStatus !== "published") await rpc("set_admin_home_banner_publication", {
  ...actor, p_correlation_id: randomUUID(), p_banner_id: banner.id, p_expected_revision: banner.revision, p_publication_status: "published",
});
manager = await read();
if (manager.items[0]?.id !== banner.id) await rpc("reorder_admin_home_banners", {
  ...actor, p_correlation_id: randomUUID(), p_items: [manager.items.find(item => item.id === banner.id), ...manager.items.filter(item => item.id !== banner.id)]
    .map(item => ({ id: item.id, expectedRevision: item.revision })),
});
for (const locale of ["ko", "en"]) {
  const published = await rpc("read_published_home_banners", { p_locale: locale });
  assert.equal(published[0]?.id, banner.id);
  assert.equal(published[0]?.href, "/wena");
}
console.log(JSON.stringify({ status: "PASS", project, bannerId: banner.id, first: true }));
