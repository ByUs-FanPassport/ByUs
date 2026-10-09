// Actual product components/styles with local synthetic auth/API; no production writes.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const here = import.meta.dirname, web = path.resolve(here, "../.."), root = path.resolve(web, "../..");
const out = path.join(root, "work/translation-ui");
await mkdir(out, { recursive: true });
const server = await createServer({ configFile: false, root: here, publicDir: path.join(web, "public"), cacheDir: path.join(out, "vite"), esbuild: { jsx: "automatic" },
  resolve: { alias: [
    { find: "@/components/byus-session-provider", replacement: path.join(here, "session.ts") },
    { find: "@", replacement: web },
    { find: "@privy-io/react-auth", replacement: path.join(here, "../community-stamps-local/privy.ts") },
    { find: "next/link", replacement: path.join(here, "../mission-local/next-link.tsx") },
  ] }, server: { host: "127.0.0.1", port: 4198, strictPort: true, fs: { allow: [root] } } });
let browser;
const evidence = { matrix: [], requests: [], errors: [], axe: [] };
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", error => evidence.errors.push(error.message));
  await page.route("**/api/content-assets/*", route => route.fulfill({ path: path.join(web, "public/images/guest-home", route.request().url().endsWith("1") ? "elina-card.jpg" : "changha-card.jpg"), contentType: "image/jpeg" }));
  let fail = false;
  await page.route("**/api/content-translations", async route => {
    const request = route.request().postDataJSON(); evidence.requests.push(request);
    if (fail) return route.fulfill({ status: 503, json: { error: { code: "TRANSLATION_FAILED" } } });
    await route.fulfill({ json: { ...request, locale: undefined, translatedText: "오늘 밤 콘서트에서 여러분을 만날 생각에 정말 설레요!", sourceRevision: 1, cached: false } });
  });
  for (const width of [390, 1440]) for (const locale of ["ko", "en", "ja", "zh-Hans", "zh-Hant", "es", "id", "vi", "th", "pt", "fr"]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`http://127.0.0.1:4198/?locale=${locale}`);
    const cards = page.locator("article");
    await expect(cards).toHaveCount(3);
    const translatedButtons = page.locator("button[aria-pressed]").filter({ hasNot: page.locator("svg") });
    await expect(translatedButtons).toHaveCount(locale === "ko" || locale === "en" ? 1 : 2);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    evidence.matrix.push({ width, locale });
    if (locale === "ko" || locale === "en") {
      await expect(cards.first().locator("img").last()).toBeVisible();
      await page.screenshot({ path: path.join(out, `${locale}-${width}.png`), fullPage: true });
    }
  }
  assert.equal(evidence.requests.length, 0, "reading must never call the translation API");
  await page.goto("http://127.0.0.1:4198/?locale=ko");
  const english = page.locator("article").nth(1);
  const translate = english.getByRole("button", { name: "번역 보기" });
  await translate.focus();
  await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
  await expect(translate).toBeFocused();
  const outline = await translate.evaluate(el => ({ style: getComputedStyle(el).outlineStyle, width: getComputedStyle(el).outlineWidth, height: el.getBoundingClientRect().height }));
  assert.equal(outline.style, "solid"); assert.equal(outline.width, "3px"); assert(outline.height >= 44);
  await page.screenshot({ path: path.join(out, "keyboard-focus.png"), fullPage: true });
  fail = true; await translate.press("Enter");
  await expect(english.getByRole("alert")).toBeVisible();
  await expect(english.getByText("We are so excited to see everyone at the concert tonight!")).toBeVisible();
  fail = false; await translate.click();
  await expect(english.getByText("오늘 밤 콘서트에서 여러분을 만날 생각에 정말 설레요!")).toBeVisible();
  await expect(english.getByRole("button", { name: "원문 보기" })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: path.join(out, "translated.png"), fullPage: true });
  await english.getByRole("button", { name: "원문 보기" }).click();
  await expect(english.getByText("We are so excited to see everyone at the concert tonight!")).toBeVisible();
  evidence.axe = (await new AxeBuilder({ page }).analyze()).violations;
  assert.deepEqual(evidence.axe, []); assert.deepEqual(evidence.errors, []);
  await writeFile(path.join(out, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(`PASS ${evidence.matrix.length} locale/width checks; no automatic requests; keyboard, 44px target, retry, original toggle, and Axe`);
} finally { await browser?.close(); await server.close(); }
