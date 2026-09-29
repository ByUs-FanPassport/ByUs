import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const seenKey = "byus:connect:intro-seen:v1";
const axeTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function openFreshIntro(page: Page) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/connect");
  await page.evaluate((key) => sessionStorage.removeItem(key), seenKey);
  await page.reload();
  await expect(page.locator("video")).toBeVisible();
}

async function openHub(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/connect");
  await expect(page.getByRole("button", { name: /비즈니스 연락|Business contact/ })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function expectAccessible(page: Page, include?: string) {
  let audit = new AxeBuilder({ page }).withTags(axeTags);
  if (include) audit = audit.include(include);
  expect((await audit.analyze()).violations).toEqual([]);
}

test("the intro can be skipped by either action and stays skipped for the session", async ({ page }, testInfo) => {
  await openFreshIntro(page);
  await expectNoHorizontalOverflow(page);
  await testInfo.attach("connect-intro", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.getByRole("button", { name: /건너뛰기|Skip/ }).click();
  await expect(page.getByRole("button", { name: /소개 영상 다시보기|Watch our story again/ })).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), seenKey)).toBe("true");

  await page.reload();
  await expect(page.getByRole("button", { name: /소개 영상 다시보기|Watch our story again/ })).toBeVisible();

  await page.evaluate((key) => sessionStorage.removeItem(key), seenKey);
  await page.reload();
  await page.getByRole("button", { name: /링크 바로 보기|Explore our links/ }).click();
  await expect(page.getByRole("button", { name: /비즈니스 연락|Business contact/ })).toBeVisible();
});

test("the fullscreen film and controls fit the viewport throughout playback", async ({ page }, testInfo) => {
  if (testInfo.project.name === "chromium-1440") await page.setViewportSize({ width: 1440, height: 900 });
  await openFreshIntro(page);
  await expect(page.getByRole("status")).toHaveCount(0);
  const play = page.getByRole("button", { name: /소개 영상 재생|Play our story/ }).first();
  if (await play.isVisible()) await play.click();
  await page.getByRole("button", { name: /소개 영상 일시정지|Pause our story/ }).click();
  const video = page.locator("video");
  const viewport = page.viewportSize()!;
  await expect(video).toHaveCSS("object-fit", "cover");
  expect(await video.boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  for (const button of [page.getByRole("button", { name: /건너뛰기|Skip/ }), page.getByRole("button", { name: /링크 바로 보기|Explore our links/ }), page.getByRole("button", { name: /소개 영상 재생|Play our story/ }).last()]) {
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 24);
    await expect(button).toBeInViewport();
  }
  await page.evaluate(() => document.fonts.ready);
  for (const time of [0.1, 3, 6, 9]) {
    await video.evaluate((element, at) => new Promise<void>(resolve => {
      element.addEventListener("seeked", () => resolve(), { once: true });
      (element as HTMLVideoElement).currentTime = at;
    }), time);
    await page.getByRole("button", { name: /소개 영상 재생|Play our story/ }).last().click();
    await expect(page.getByRole("button", { name: /소개 영상 일시정지|Pause our story/ })).toBeVisible();
    if (time >= 8) await expect(page.getByRole("heading", { level: 1 })).toBeHidden();
    await testInfo.attach(`connect-fullscreen-${viewport.width}-${time}`, { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" });
    await page.getByRole("button", { name: /소개 영상 일시정지|Pause our story/ }).click();
  }
  await expectAccessible(page);
  await page.getByRole("button", { name: /소개 영상 재생|Play our story/ }).last().click();
  await expect(page.getByRole("button", { name: /소개 영상 일시정지|Pause our story/ })).toBeVisible();
});

test("fullscreen controls fit 390px and short 360px screens in both languages", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-360", "Additional viewport sizes run once.");
  await openHub(page);
  for (const language of ["한국어", "English"]) {
    await page.getByRole("button", { name: language, exact: true }).click();
    for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
      await page.setViewportSize(viewport);
      await page.getByRole("button", { name: /소개 영상 다시보기|Watch our story again/ }).click();
      await page.getByRole("button", { name: /소개 영상 일시정지|Pause our story/ }).click();
      expect(await page.locator("video").boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
      await expectNoHorizontalOverflow(page);
      const heading = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
      const links = page.getByRole("button", { name: /링크 바로 보기|Explore our links/ });
      const box = (await links.boundingBox())!;
      expect(heading.y + heading.height).toBeLessThan(box.y);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 24);
      expect(await links.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await testInfo.attach(`connect-fullscreen-${viewport.width}-${language}`, { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" });
      await links.click();
    }
  }
});

test("the real intro reaches the hub and replay starts from the beginning", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-360", "One real 9.6 second playback is sufficient.");
  await openFreshIntro(page);

  await expect(page.getByRole("button", { name: /소개 영상 다시보기|Watch our story again/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /소개 영상 다시보기|Watch our story again/ }).click();

  const video = page.locator("video");
  await expect(video).toBeVisible();
  expect(await video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeLessThan(1);
  await expect(page.getByRole("button", { name: /소개 영상 일시정지|Pause our story/ })).toBeVisible({ timeout: 5_000 });
});

test("reduced motion opens a 390px hub without downloading the intro", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-360", "The dedicated 390px check runs once.");
  const videoRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/images/connect/intro.mp4")) videoRequests.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openHub(page);

  await expectNoHorizontalOverflow(page);
  expect(videoRequests).toEqual([]);
  await expectAccessible(page);
  await testInfo.attach("connect-hub-390", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  await page.getByRole("button", { name: /비즈니스 연락|Business contact/ }).click();
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page, '[role="dialog"]');
  await testInfo.attach("connect-contact-390", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("blocked autoplay and video errors retain recovery and direct links", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError"));
  });
  await openFreshIntro(page);

  await expect(page.getByRole("button", { name: /소개 영상 재생|Play our story/ }).first()).toBeVisible();
  await page.locator("video").evaluate((video) => video.dispatchEvent(new Event("error")));
  const retry = page.getByRole("button", { name: /다시 시도|Try again/ });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeHidden();
  await retry.click();
  await expect(page.getByRole("button", { name: /소개 영상 재생|Play our story/ }).first()).toBeVisible();

  await page.getByRole("button", { name: /링크 바로 보기|Explore our links/ }).click();
  await expect(page.getByRole("link", { name: /Instagram/ })).toBeVisible();
});

test("contact links, language switching, focus trap, and focus return work", async ({ page }) => {
  await openHub(page);

  await expect(page.locator('nav a[href^="/?locale="]')).toHaveAttribute("href", /^\/\?locale=(ko|en)$/);
  await expect(page.getByRole("link", { name: /Instagram/ })).toHaveAttribute("href", "https://www.instagram.com/official_byus/");

  const trigger = page.getByRole("button", { name: /비즈니스 연락|Business contact/ });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  const close = dialog.getByRole("button", { name: /연락처 닫기|Close contacts/ });
  await expect(close).toBeFocused();
  await expect(dialog.getByRole("link", { name: /biz@sallylab\.io/ })).toHaveAttribute("href", "mailto:biz@sallylab.io");
  for (const handle of ["pifbetter", "ljyk11", "managerdelta"]) {
    await expect(dialog.locator(`a[href="https://t.me/${handle}"]`)).toHaveAttribute("target", "_blank");
  }

  await page.keyboard.press("Shift+Tab");
  await expect(dialog.locator('a[href="https://t.me/managerdelta"]')).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("fan passport");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
});

test("configured 360px and 1440px hubs and contacts are overflow-free and accessible", async ({ page }, testInfo) => {
  await openHub(page);
  const expectedWidth = testInfo.project.name.endsWith("-360") ? 360 : 1440;
  expect(page.viewportSize()?.width).toBe(expectedWidth);
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
  await testInfo.attach(`connect-hub-${expectedWidth}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  await page.getByRole("button", { name: /비즈니스 연락|Business contact/ }).click();
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page, '[role="dialog"]');
  await testInfo.attach(`connect-${expectedWidth}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("BYUS DAY opens the full-width poster, switches languages, and links directly to RSVP", async ({ page }, testInfo) => {
  await openHub(page);
  await page.getByRole("button", { name: "한국어", exact: true }).click();
  await expect(page.getByRole("link", { name: /BYUS DAY 참가 신청/ })).toBeVisible();
  await page.locator("img").evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
  await testInfo.attach(`connect-event-${page.viewportSize()!.width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.getByRole("link", { name: /BYUS DAY 참가 신청/ }).click();

  for (const locale of ["ko", "en"] as const) {
    if (locale === "en") await page.getByRole("link", { name: "English", exact: true }).click();
    const poster = page.getByRole("img", { name: /BYUS DAY/ });
    await expect(poster).toHaveAttribute("src", `/images/connect/byus-day/poster-${locale}.webp`);
    await expect(poster).toBeVisible();
    await expect.poll(() => poster.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1024);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("BYUS DAY");
    await expectNoHorizontalOverflow(page);
    expect((await poster.boundingBox())!.width).toBe(Math.min(page.viewportSize()!.width, 1024));
    const rsvp = page.getByRole("link", { name: locale === "ko" ? /참가 신청/ : /RSVP/ });
    await expect(rsvp).toHaveAttribute("href", "https://luma.com/hg1qdkvn");
    await expect(rsvp).toHaveAttribute("target", "_blank");
    await expect(rsvp).toHaveAttribute("rel", "noopener noreferrer");
    await expect(rsvp).toBeInViewport();
    expect((await rsvp.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expectAccessible(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const footer = page.getByRole("contentinfo");
    const posterBox = (await poster.boundingBox())!;
    expect(posterBox.y + posterBox.height).toBeLessThanOrEqual((await footer.boundingBox())!.y);
    await expect(rsvp).toBeInViewport();
    await testInfo.attach(`byus-day-${locale}-${page.viewportSize()!.width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  await page.context().route("https://luma.com/hg1qdkvn", route => route.fulfill({ contentType: "text/html", body: "<title>RSVP destination</title>" }));
  const destination = page.waitForEvent("popup");
  await page.getByRole("link", { name: /RSVP/ }).click();
  const popup = await destination;
  await expect(popup).toHaveURL("https://luma.com/hg1qdkvn");
  await popup.close();

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(key => sessionStorage.removeItem(key), seenKey);
  await page.getByRole("link", { name: "All links", exact: true }).click();
  await expect(page.getByRole("link", { name: /BYUS DAY · RSVP/ })).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
  await page.getByRole("button", { name: "한국어", exact: true }).click();
  await expect(page.getByRole("link", { name: /BYUS DAY 참가 신청/ })).toBeVisible();
});
