import { createClient } from "@supabase/supabase-js";

const action = process.argv[2] ?? "preflight";
const readOnlyRequired = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PLAYWRIGHT_BASE_URL",
  "BYUS_E2E_ALLOWED_BASE_URL",
  "BYUS_E2E_ALLOWED_SUPABASE_PROJECT_REF",
  "BYUS_E2E_ADMIN_APP_USER_ID",
  "BYUS_E2E_ADMIN_ALLOWLIST_ID",
  "BYUS_E2E_ADMIN_ACCESS_TOKEN",
  "BYUS_E2E_FAN_ACCESS_TOKEN",
  "BYUS_E2E_TOKEN_DISPOSABLE_UNTIL",
  "BYUS_E2E_RUN_ID",
];
const mutationRequired = ["seed", "activate"].includes(action) ? ["BYUS_E2E_FAN_CODE", "BYUS_E2E_YOUTUBE_URL"] : [];
const mutating = ["seed", "activate", "cleanup"].includes(action);
const missing = [...readOnlyRequired, ...(mutating ? mutationRequired : [])].filter((key) => !process.env[key]?.trim());
if (missing.length) {
  throw new Error(`E2E_PREFLIGHT_MISSING: ${missing.join(", ")}`);
}
if (mutating && process.env.BYUS_E2E_ALLOW_MUTATION !== "I_UNDERSTAND_LINKED_DEV_MUTATION") {
  throw new Error("E2E_MUTATION_OPT_IN_REQUIRED: set BYUS_E2E_ALLOW_MUTATION=I_UNDERSTAND_LINKED_DEV_MUTATION");
}
const supabaseUrl = new URL(process.env.SUPABASE_URL);
const projectRef = /^([a-z0-9]+)\.supabase\.co$/.exec(supabaseUrl.hostname)?.[1];
const APPROVED_LINKED_DEV_REFS = new Set(["xcppyedwusirqnfpbtit"]);
if (!projectRef || !APPROVED_LINKED_DEV_REFS.has(projectRef) || projectRef !== process.env.BYUS_E2E_ALLOWED_SUPABASE_PROJECT_REF.trim()) {
  throw new Error("E2E_SUPABASE_PROJECT_MISMATCH");
}
const APPROVED_LINKED_DEV_ORIGIN = "https://buyus.vercel.app";
const baseUrl = new URL(process.env.PLAYWRIGHT_BASE_URL).toString().replace(/\/$/, "");
const allowedBaseUrl = new URL(process.env.BYUS_E2E_ALLOWED_BASE_URL).toString().replace(/\/$/, "");
if (baseUrl !== APPROVED_LINKED_DEV_ORIGIN || allowedBaseUrl !== APPROVED_LINKED_DEV_ORIGIN) {
  throw new Error("E2E_DEPLOYMENT_BINDING_MISMATCH");
}
const disposableUntil = Date.parse(process.env.BYUS_E2E_TOKEN_DISPOSABLE_UNTIL);
const tokenLifetime = disposableUntil - Date.now();
if (!Number.isFinite(disposableUntil) || tokenLifetime <= 0 || tokenLifetime > 60 * 60_000) {
  throw new Error("E2E_TOKEN_NOT_DISPOSABLE: expiry must be within the next 60 minutes");
}

const runId = process.env.BYUS_E2E_RUN_ID.trim().toLowerCase();
if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(runId)) {
  throw new Error("BYUS_E2E_RUN_ID must match ^[a-z0-9][a-z0-9-]{0,39}$");
}
const fanCode = process.env.BYUS_E2E_FAN_CODE?.trim() ?? "";
if (mutating && !/^[A-Za-z0-9]{4,32}$/.test(fanCode)) {
  throw new Error("BYUS_E2E_FAN_CODE must contain 4-32 ASCII letters or digits");
}
const youtubeUrl = process.env.BYUS_E2E_YOUTUBE_URL?.trim() ?? "";
if (mutating && !/^https:\/\/(?:(?:www\.)?youtube\.com\/(?:watch\?|live\/|embed\/)|youtu\.be\/)/.test(youtubeUrl)) {
  throw new Error("BYUS_E2E_YOUTUBE_URL must be an approved YouTube watch/live/embed URL");
}

const slug = `e2e-kara-nualeaf-${runId}`;
const directSlug = `${slug}-direct`;
const applicationSlug = `${slug}-application`;
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const actor = {
  appUserId: process.env.BYUS_E2E_ADMIN_APP_USER_ID.trim(),
  allowlistId: process.env.BYUS_E2E_ADMIN_ALLOWLIST_ID.trim(),
};
const correlation = () => crypto.randomUUID();
const must = (label, result) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};

async function one(table, query, label) {
  const result = await query(db.from(table).select("*")).maybeSingle();
  return must(label, result);
}

async function context() {
  const celebrity = await one("celebrities", (q) => q.eq("slug", "kara").eq("status", "published"), "published KARA celebrity");
  const brand = await one("brands", (q) => q.eq("slug", "nualeaf").eq("status", "published"), "published NUALEAF brand");
  if (!celebrity) throw new Error("E2E_FIXTURE_DEPENDENCY_MISSING: published celebrity slug kara");
  if (!brand) throw new Error("E2E_FIXTURE_DEPENDENCY_MISSING: published brand slug nualeaf");
  return { celebrity, brand };
}

async function appJson(path, token, label) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status} ${body?.error?.code ?? "UNKNOWN"}`);
  return body;
}

async function adminPost(path, body, label) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.BYUS_E2E_ADMIN_ACCESS_TOKEN}`, "content-type": "application/json", "x-correlation-id": correlation() },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status} ${result?.error?.code ?? "UNKNOWN"}`);
  return result;
}

async function preflight() {
  const serverFingerprint = await appJson("/api/admin/e2e-deployment-fingerprint", process.env.BYUS_E2E_ADMIN_ACCESS_TOKEN, "deployment fingerprint preflight");
  if (serverFingerprint.projectRef !== "xcppyedwusirqnfpbtit") {
    throw new Error(`E2E_SERVER_PROJECT_MISMATCH: expected xcppyedwusirqnfpbtit, received ${serverFingerprint.projectRef ?? "missing"}`);
  }
  const dependencies = await context();
  const passports = await appJson("/api/passports?locale=ko", process.env.BYUS_E2E_FAN_ACCESS_TOKEN, "fan identity preflight");
  const karaPassport = passports.passports?.find((item) => item.celebrity?.slug === "kara");
  if (!karaPassport) throw new Error("E2E_KARA_PASSPORT_MISSING: token is valid but no issued KARA Passport was found");
  const liveManager = await appJson("/api/admin/lives", process.env.BYUS_E2E_ADMIN_ACCESS_TOKEN, "admin live manager preflight");
  const benefitManager = await appJson("/api/admin/benefits", process.env.BYUS_E2E_ADMIN_ACCESS_TOKEN, "admin benefit manager preflight");
  return {
    ok: true,
    mutationAllowed: process.env.BYUS_E2E_ALLOW_MUTATION === "I_UNDERSTAND_LINKED_DEV_MUTATION",
    projectRef,
    baseUrl,
    namespace: slug,
    fan: { passportId: karaPassport.id, celebrity: "kara" },
    admin: { liveProjection: Array.isArray(liveManager.lives), benefitProjection: Array.isArray(benefitManager.benefits) },
    dependencies: { celebrityId: dependencies.celebrity.id, brandId: dependencies.brand.id },
    disposableUntil: new Date(disposableUntil).toISOString(),
  };
}

async function existing(table, fixtureSlug) {
  return one(table, (q) => q.eq("slug", fixtureSlug), `${table} lookup`);
}

async function createLive(celebrityId, brandId) {
  const prior = await existing("live_events", slug);
  if (prior) {
    const manager = await appJson("/api/admin/lives", process.env.BYUS_E2E_ADMIN_ACCESS_TOKEN, "existing live diagnostic");
    const item = manager.lives.find((candidate) => candidate.id === prior.id);
    const expected = item && item.slug === slug && item.celebrityId === celebrityId && item.brandId === brandId
      && item.youtubeUrl === youtubeUrl && item.heroUrl === "/images/live/kara-hero-group.jpg"
      && item.fanCodeConfigured === true && item.localizations?.ko?.title === `[E2E] KARA × NUALEAF LIVE ${runId}`
      && item.localizations?.en?.title === `[E2E] KARA × NUALEAF LIVE ${runId}`;
    if (!expected || item.archivedAt || Date.parse(item.reservationClosesAt) <= Date.now()) {
      throw new Error(`E2E_PARTIAL_FIXTURE_LIVE: ${JSON.stringify({ id: prior.id, publicationStatus: item?.publicationStatus, archived: Boolean(item?.archivedAt), reservationClosed: item ? Date.parse(item.reservationClosesAt) <= Date.now() : null })}`);
    }
    if (item.publicationStatus === "draft") await adminPost("/api/admin/lives", { action: "publish", id: item.id }, "resume live publication");
    else if (item.publicationStatus !== "published") throw new Error(`E2E_PARTIAL_FIXTURE_LIVE_STATUS: ${item.publicationStatus}`);
    return prior.id;
  }
  const now = Date.now();
  const result = await adminPost("/api/admin/lives", {
    action: "save", id: null, slug, celebrityId, brandId,
    startsAt: new Date(now + 30 * 60_000).toISOString(),
    endsAt: new Date(now + 150 * 60_000).toISOString(),
    reservationOpensAt: new Date(now - 60 * 60_000).toISOString(),
    reservationClosesAt: new Date(now + 20 * 60_000).toISOString(),
    youtubeUrl, heroUrl: "/images/live/kara-hero-group.jpg", fanCode,
    titleKo: `[E2E] KARA × NUALEAF LIVE ${runId}`,
    summaryKo: "ByUs 연결 Dev 운영 검증용 격리 fixture입니다.", heroAltKo: "KARA 멤버 단체 이미지",
    titleEn: `[E2E] KARA × NUALEAF LIVE ${runId}`,
    summaryEn: "Namespaced linked Dev operational verification fixture.", heroAltEn: "KARA group portrait",
  });
  const id = result.id;
  await adminPost("/api/admin/lives", { action: "publish", id }, "publish live fixture");
  return id;
}

async function createSurvey(liveEventId) {
  const projection = await appJson(`/api/admin/live-events/${liveEventId}/survey`, process.env.BYUS_E2E_ADMIN_ACCESS_TOKEN, "survey setup diagnostic");
  if (projection.data.versions.length) {
    if (projection.data.versions.length !== 1) throw new Error(`E2E_PARTIAL_FIXTURE_SURVEY: expected one version, found ${projection.data.versions.length}`);
    const prior = projection.data.versions[0];
    if (prior.questions.map((question) => question.position).join(",") !== "1,2,3,4") throw new Error("E2E_PARTIAL_FIXTURE_SURVEY_ORDER");
    if (prior.status === "draft") await adminPost(`/api/admin/live-events/${liveEventId}/survey`, { command: "publish", surveyId: prior.id, expectedRevision: prior.revision }, "resume survey publication");
    else if (prior.status !== "published") throw new Error(`E2E_PARTIAL_FIXTURE_SURVEY_STATUS: ${prior.status}`);
    return prior.id;
  }
  const created = await adminPost(`/api/admin/live-events/${liveEventId}/survey`, { command: "create" }, "create canonical survey");
  const surveyId = created.data.selectedSurveyId;
  const selected = created.data.versions.find((item) => item.id === surveyId);
  await adminPost(`/api/admin/live-events/${liveEventId}/survey`, { command: "publish", surveyId, expectedRevision: selected.revision }, "publish canonical survey");
  return surveyId;
}

async function createBenefit(celebrityId, fixtureSlug, allocationMode) {
  const prior = await existing("benefits", fixtureSlug);
  if (prior) {
    const manager = await appJson("/api/admin/benefits", process.env.BYUS_E2E_ADMIN_ACCESS_TOKEN, "existing benefit diagnostic");
    const item = manager.benefits.find((candidate) => candidate.id === prior.id);
    const expected = item && item.celebrityId === celebrityId && item.allocationMode === allocationMode
      && item.deliveryType === "external_link" && item.deliveryConfigured === true
      && item.requiredStampType === "survey" && item.requiredActivityType === "survey";
    if (!expected || item.archivedAt || Date.parse(item.claimClosesAt) <= Date.now()) {
      throw new Error(`E2E_PARTIAL_FIXTURE_BENEFIT: ${JSON.stringify({ id: prior.id, slug: fixtureSlug, publicationStatus: item?.publicationStatus, revision: item?.revision, archived: Boolean(item?.archivedAt) })}`);
    }
    if (item.publicationStatus === "draft") await adminPost("/api/admin/benefits", { action: "publish", id: item.id, expectedRevision: item.revision }, `resume benefit publication ${fixtureSlug}`);
    else if (item.publicationStatus !== "published") throw new Error(`E2E_PARTIAL_FIXTURE_BENEFIT_STATUS: ${item.publicationStatus}`);
    return prior.id;
  }
  const now = Date.now();
  const saved = await adminPost("/api/admin/benefits", {
    action: "save", id: null, expectedRevision: null, slug: fixtureSlug, celebrityId,
    allocationMode, deliveryType: "external_link",
    claimOpensAt: new Date(now - 60 * 60_000).toISOString(), claimClosesAt: new Date(now + 24 * 60 * 60_000).toISOString(),
    stockLimit: 100, perUserLimit: 1, minimumScore: 0, minimumLevel: "Bronze",
    requiredStampType: "survey", requiredActivityType: "survey",
    titleKo: allocationMode === "direct_claim" ? `[E2E] LIVE 참여 혜택 ${runId}` : `[E2E] LIVE 응모 혜택 ${runId}`,
    summaryKo: "출석과 설문 완료 후 검증하는 격리 혜택입니다.", eligibilityKo: "Survey Stamp 보유", deliveryKo: "공식 YouTube URL",
    titleEn: allocationMode === "direct_claim" ? `[E2E] LIVE participation benefit ${runId}` : `[E2E] LIVE application benefit ${runId}`,
    summaryEn: "Namespaced benefit unlocked after attendance and survey.", eligibilityEn: "Survey Stamp required", deliveryEn: "Official YouTube URL",
    deliverySecret: youtubeUrl,
  }, `save benefit ${fixtureSlug}`);
  const id = saved.id;
  await adminPost("/api/admin/benefits", { action: "publish", id, expectedRevision: 1 }, `publish ${fixtureSlug}`);
  return id;
}

async function activate(liveEventId) {
  const manager = await appJson("/api/admin/lives", process.env.BYUS_E2E_ADMIN_ACCESS_TOKEN, "activation projection");
  const live = manager.lives.find((item) => item.id === liveEventId);
  const active = live?.overrides.find((item) => item.status === "live" && Date.parse(item.effectiveFrom) <= Date.now() && Date.parse(item.effectiveUntil) > Date.now());
  if (active) return active.id;
  const result = await adminPost("/api/admin/lives", {
    action: "override", id: liveEventId, status: "live",
    effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
    effectiveUntil: new Date(Date.now() + 40 * 60_000).toISOString(),
    reason: `Namespaced E2E activation ${runId}`,
  }, "activate live fixture");
  return result.overrideId;
}

async function fixture() {
  const { celebrity, brand } = await context();
  const liveEventId = await createLive(celebrity.id, brand.id);
  const surveyId = await createSurvey(liveEventId);
  const directBenefitId = await createBenefit(celebrity.id, directSlug, "direct_claim");
  const applicationBenefitId = await createBenefit(celebrity.id, applicationSlug, "application_selection");
  return { namespace: slug, liveSlug: slug, liveEventId, surveyId, directBenefitId, applicationBenefitId };
}

async function cleanup() {
  const live = await existing("live_events", slug);
  if (!live) return { namespace: slug, removed: false };
  const immutableTables = ["live_reservations", "live_attendances", "live_survey_responses"];
  for (const table of immutableTables) {
    const result = await db.from(table).select("id", { count: "exact", head: true }).eq("live_event_id", live.id);
    must(`${table} cleanup guard`, result);
    if ((result.count ?? 0) > 0) throw new Error(`E2E_CLEANUP_REFUSED: ${table} contains append-only fan records`);
  }
  const surveyProjection = await appJson(`/api/admin/live-events/${live.id}/survey`, process.env.BYUS_E2E_ADMIN_ACCESS_TOKEN, "survey cleanup projection");
  for (const survey of surveyProjection.data.versions.filter((item) => item.status !== "archived")) {
    let current = survey;
    if (current.status === "published") {
      const closed = await adminPost(`/api/admin/live-events/${live.id}/survey`, { command: "close", surveyId: current.id }, "close unused survey fixture");
      current = closed.data.versions.find((item) => item.id === current.id);
    }
    if (current.status === "draft" || current.status === "closed") {
      await adminPost(`/api/admin/live-events/${live.id}/survey`, { command: "archive", surveyId: current.id, expectedRevision: current.revision }, "archive unused survey fixture");
    }
  }
  const benefits = await appJson("/api/admin/benefits", process.env.BYUS_E2E_ADMIN_ACCESS_TOKEN, "benefit cleanup projection");
  const fixtureBenefits = benefits.benefits.filter((item) => [directSlug, applicationSlug].includes(item.slug));
  for (const benefit of fixtureBenefits) {
    for (const table of ["benefit_claims", "benefit_applications"]) {
      const result = await db.from(table).select("id", { count: "exact", head: true }).eq("benefit_id", benefit.id);
      must(`${table} cleanup guard`, result);
      if ((result.count ?? 0) > 0) throw new Error(`E2E_CLEANUP_REFUSED: ${table} contains immutable fan records`);
    }
  }
  for (const benefit of fixtureBenefits.filter((item) => !item.archivedAt)) {
    await adminPost("/api/admin/benefits", { action: "archive", id: benefit.id, expectedRevision: benefit.revision, reason: `Unused namespaced E2E fixture cleanup ${runId}` }, `archive benefit ${benefit.slug}`);
  }
  const lives = await appJson("/api/admin/lives", process.env.BYUS_E2E_ADMIN_ACCESS_TOKEN, "live cleanup projection");
  const managedLive = lives.lives.find((item) => item.id === live.id);
  if (managedLive && !managedLive.archivedAt) {
    await adminPost("/api/admin/lives", { action: "archive", id: live.id, reason: `Unused namespaced E2E fixture cleanup ${runId}` }, "archive live fixture");
  }
  return { namespace: slug, removed: false, archived: true };
}

if (action === "preflight") {
  console.log(JSON.stringify(await preflight()));
} else if (action === "cleanup") {
  await preflight();
  console.log(JSON.stringify(await cleanup()));
} else {
  await preflight();
  const seeded = await fixture();
  if (action === "activate") {
  await activate(seeded.liveEventId);
  console.log(JSON.stringify({ ...seeded, activated: true }));
  } else if (action === "seed") {
    console.log(JSON.stringify(seeded));
  } else {
    throw new Error("usage: seed-kara-nualeaf-e2e-fixture.mjs [preflight|seed|activate|cleanup]");
  }
}
