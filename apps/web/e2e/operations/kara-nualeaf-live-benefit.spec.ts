import type { APIRequestContext } from "@playwright/test";
import { createHash } from "node:crypto";
import { expect, test } from "../fixtures/protected-preview";

const env = (key: string) => process.env[key]?.trim() ?? "";
const runId = env("BYUS_E2E_RUN_ID").toLowerCase();
const liveSlug = `e2e-kara-nualeaf-${runId}`;
const token = env("BYUS_E2E_FAN_ACCESS_TOKEN");
const fanCode = env("BYUS_E2E_FAN_CODE");
const serviceUrl = env("SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const actorAppUserId = env("BYUS_E2E_ADMIN_APP_USER_ID");
const actorAllowlistId = env("BYUS_E2E_ADMIN_ALLOWLIST_ID");
const adminToken = env("BYUS_E2E_ADMIN_ACCESS_TOKEN");
const auth = () => ({ authorization: `Bearer ${token}` });
const json = (response: Awaited<ReturnType<APIRequestContext["get"]>>) => response.json() as Promise<Record<string, any>>;
function stableUuid(operation: string, fanIdentity: string) {
  const bytes = Buffer.from(createHash("sha256").update(`${runId}:${fanIdentity}:${operation}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

test("public shell and login gate remain executable without fan credentials", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/ByUs/);
  await expect(page.getByRole("link", { name: /라이브 예약하기/ })).toBeVisible();
  const unauthorized = await request.post("/api/live-events/00000000-0000-4000-8000-000000000000/reservation", {
    data: { idempotencyKey: "00000000-0000-4000-8000-000000000001" },
  });
  expect(unauthorized.status()).toBe(401);
});

test.describe("KARA × NUALEAF linked Dev operational journey", () => {
  test.beforeAll(() => {
    const missing = [
      ["BYUS_E2E_RUN_ID", runId], ["BYUS_E2E_FAN_ACCESS_TOKEN", token], ["BYUS_E2E_FAN_CODE", fanCode],
      ["SUPABASE_URL", serviceUrl], ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
      ["BYUS_E2E_ADMIN_APP_USER_ID", actorAppUserId], ["BYUS_E2E_ADMIN_ALLOWLIST_ID", actorAllowlistId], ["BYUS_E2E_ADMIN_ACCESS_TOKEN", adminToken],
    ].filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) throw new Error(`AUTHENTICATED_E2E_PREFLIGHT_MISSING: ${missing.join(", ")}`);
  });

  test("login assumption, reserve, YouTube return, attendance, survey, Passport/Stamp, claim and application", async ({ page, request, context }) => {
    const passportsResponse = await request.get("/api/passports?locale=ko", { headers: auth() });
    expect(passportsResponse.status(), "A real Privy token mapped to an active app_user is required").toBe(200);
    const passports = await json(passportsResponse);
    const karaPassport = passports.passports?.find((item: any) => item.celebrity?.slug === "kara");
    expect(karaPassport, "Authenticated fixture fan must already own an issued KARA Passport").toBeTruthy();
    const fanIdentity = karaPassport.id;

    const adminHeaders = { authorization: `Bearer ${adminToken}` };
    const fingerprintResponse = await request.get("/api/admin/e2e-deployment-fingerprint", { headers: adminHeaders });
    expect(fingerprintResponse.status(), await fingerprintResponse.text()).toBe(200);
    expect(await json(fingerprintResponse)).toEqual(expect.objectContaining({ projectRef: "xcppyedwusirqnfpbtit" }));
    const [liveManagerA, liveManagerB, benefitManagerA, benefitManagerB] = await Promise.all([
      request.get("/api/admin/lives", { headers: adminHeaders }), request.get("/api/admin/lives", { headers: adminHeaders }),
      request.get("/api/admin/benefits", { headers: adminHeaders }), request.get("/api/admin/benefits", { headers: adminHeaders }),
    ]);
    for (const response of [liveManagerA, liveManagerB, benefitManagerA, benefitManagerB]) expect(response.status(), await response.text()).toBe(200);
    const [livesA, livesB, managedBenefitsA, managedBenefitsB] = await Promise.all([json(liveManagerA), json(liveManagerB), json(benefitManagerA), json(benefitManagerB)]);
    expect(livesA.lives.map((item: any) => item.id)).toEqual(livesB.lives.map((item: any) => item.id));
    expect(managedBenefitsA.benefits.map((item: any) => item.id)).toEqual(managedBenefitsB.benefits.map((item: any) => item.id));
    expect(livesA.lives.some((item: any) => item.slug === liveSlug)).toBe(true);
    expect(managedBenefitsA.benefits.filter((item: any) => item.slug.startsWith(liveSlug)).map((item: any) => item.slug)).toEqual(expect.arrayContaining([`${liveSlug}-direct`, `${liveSlug}-application`]));

    const liveResponse = await request.get(`/api/live-events/${liveSlug}?locale=ko`);
    expect(liveResponse.status()).toBe(200);
    const live = (await json(liveResponse)).live;
    expect(live.slug).toBe(liveSlug);
    expect(live.watch.url).toMatch(/^https:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//);

    const reservation = await request.post(`/api/live-events/${live.id}/reservation`, {
      headers: auth(), data: { idempotencyKey: stableUuid("reservation", fanIdentity) },
    });
    expect(reservation.status(), await reservation.text()).toBe(200);

    const managedLive = livesA.lives.find((item: any) => item.id === live.id);
    const activeOverride = managedLive.overrides.find((item: any) => item.status === "live" && Date.parse(item.effectiveFrom) <= Date.now() && Date.parse(item.effectiveUntil) > Date.now());
    if (!activeOverride) {
      const activation = await request.post("/api/admin/lives", {
        headers: { ...adminHeaders, "content-type": "application/json" },
        data: { action: "override", id: live.id, status: "live", effectiveFrom: new Date(Date.now() - 60_000).toISOString(), effectiveUntil: new Date(Date.now() + 40 * 60_000).toISOString(), reason: `Namespaced E2E activation ${runId}` },
      });
      expect(activation.status(), await activation.text()).toBe(201);
    }

    await page.goto("/");
    await page.evaluate((accessToken) => {
      localStorage.setItem("privy:token", JSON.stringify(accessToken));
    }, token);
    await page.goto(`/live/${liveSlug}?locale=ko`);
    const youtube = page.getByRole("link", { name: /YouTube LIVE 입장/ }).first();
    await expect(youtube).toHaveAttribute("href", live.watch.url);
    const popupPromise = context.waitForEvent("page");
    await youtube.click();
    const popup = await popupPromise;
    await popup.waitForURL(/^https:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//, { waitUntil: "commit" });
    await popup.close();
    await expect(page).toHaveURL(new RegExp(`/live/${liveSlug}`));

    const attendance = await request.post(`/api/live-events/${liveSlug}/attendance`, {
      headers: { ...auth(), "idempotency-key": stableUuid("attendance", fanIdentity) }, data: { code: fanCode },
    });
    expect(attendance.status(), await attendance.text()).toBe(200);

    const surveyResponse = await request.get(`/api/live-events/${liveSlug}/survey?locale=ko`, { headers: auth() });
    expect(surveyResponse.status(), await surveyResponse.text()).toBe(200);
    const survey = await json(surveyResponse);
    expect(survey.survey.questions.map((question: any) => question.order)).toEqual([1, 2, 3, 4]);
    const answers = survey.survey.questions.map((question: any) => {
      if (question.type === "rating_1_5") return { questionId: question.id, rating: 5 };
      if (question.type === "free_text") return { questionId: question.id, freeText: "E2E operational verification" };
      return { questionId: question.id, selectedOptionIds: [question.options[0].id] };
    });
    const submitted = await request.post(`/api/live-events/${liveSlug}/survey`, {
      headers: auth(), data: { idempotencyKey: stableUuid("survey-submit", fanIdentity), answers },
    });
    expect(submitted.status(), await submitted.text()).toBe(200);

    const passportDetail = await request.get(`/api/passports/${karaPassport.id}?locale=ko`, { headers: auth() });
    expect(passportDetail.status()).toBe(200);
    const detail = await json(passportDetail);
    expect(detail.passport.stamps.map((stamp: any) => stamp.type)).toEqual(expect.arrayContaining(["attendance", "survey"]));

    const benefitsResponse = await request.get("/api/benefits?celebrity=kara&locale=ko", { headers: auth() });
    expect(benefitsResponse.status()).toBe(200);
    const benefits = (await json(benefitsResponse)).benefits;
    const direct = benefits.find((item: any) => item.slug === `${liveSlug}-direct`);
    const application = benefits.find((item: any) => item.slug === `${liveSlug}-application`);
    expect(["eligible", "claimed"]).toContain(direct?.state);
    expect(["eligible", "claimed"]).toContain(application?.state);

    const claimed = await request.post(`/api/benefits/${direct.id}/claim`, { headers: auth(), data: { idempotencyKey: stableUuid("benefit-direct", fanIdentity) } });
    expect(claimed.status(), await claimed.text()).toBe(200);
    const claimResult = await json(claimed);
    const claimReplay = await request.post(`/api/benefits/${direct.id}/claim`, { headers: auth(), data: { idempotencyKey: stableUuid("benefit-direct", fanIdentity) } });
    expect(claimReplay.status(), await claimReplay.text()).toBe(200);
    expect(await json(claimReplay)).toEqual(expect.objectContaining({ claimId: claimResult.claimId, deliveryValue: claimResult.deliveryValue }));
    const applied = await request.post(`/api/benefits/${application.id}/applications`, { headers: { ...auth(), "idempotency-key": stableUuid("benefit-application", fanIdentity) } });
    expect(applied.status(), await applied.text()).toBe(200);
    const applicationResult = await json(applied);
    expect(["submitted", "selected"]).toContain(applicationResult.status);
    const decision = await request.post("/api/admin/benefits", {
      headers: { ...adminHeaders, "content-type": "application/json" },
      data: { action: "decide", applicationId: applicationResult.applicationId, selected: true, idempotencyKey: stableUuid("benefit-selection", fanIdentity) },
    });
    expect(decision.status(), await decision.text()).toBe(200);
    const decisionResult = await json(decision);
    expect(decisionResult).toEqual(expect.objectContaining({ applicationId: applicationResult.applicationId, status: "selected" }));
    expect(decisionResult.claimId).toMatch(/^[0-9a-f-]{36}$/);
    const selectedDelivery = await request.get(`/api/benefits/${application.id}/applications`, { headers: auth() });
    expect(selectedDelivery.status(), await selectedDelivery.text()).toBe(200);
    const ownedApplication = (await json(selectedDelivery)).application;
    expect(ownedApplication).toEqual(expect.objectContaining({ applicationId: applicationResult.applicationId, status: "selected" }));
    expect(ownedApplication.claim).toEqual(expect.objectContaining({ claimId: decisionResult.claimId, deliveryType: "external_url", deliveryValue: env("BYUS_E2E_YOUTUBE_URL") }));
    const selectedDeliveryReplay = await request.get(`/api/benefits/${application.id}/applications`, { headers: auth() });
    expect(selectedDeliveryReplay.status()).toBe(200);
    expect((await json(selectedDeliveryReplay)).application).toEqual(ownedApplication);
  });
});
