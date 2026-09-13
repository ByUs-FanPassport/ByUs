// Isolated HTTP/browser proof against the real Next routes. All content comes
// from a local PostgREST fixture; no production credentials or writes are used.
import assert from "node:assert/strict";
import { createServer } from "node:https";
import { createWriteStream, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "work/creator-handles-local");
await mkdir(output, { recursive: true });
const port = Number(process.env.CREATOR_HANDLES_PORT || 5173);
const dataPort = Number(process.env.CREATOR_HANDLES_DATA_PORT || 3174);
const origin = `http://localhost:${port}`;
const key = resolve(output, "localhost.key");
const cert = resolve(output, "localhost.crt");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-keyout", key, "-out", cert, "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });

const roster = [
  ["elina", "엘리나"], ["changha", "창하"], ["yuna", "유나"],
  ["jenny-jeong", "정제니"], ["aryeom", "아렴"], ["park-myungho", "박명호"],
  ["ifewknow", "이퓨"], ["thisisj-official", "재희"], ["new-creator", "새 셀럽"],
];
const rows = roster.flatMap(([slug, name]) => ["ko", "en"].map((locale) => ({
  slug, locale, name: locale === "ko" ? name : slug, summary: `${name} fan page`,
  image_url: "/images/celebrities/elina/hero-source.jpg", image_alt: name,
  image_position: "center", primary_role: "creator", themes: [], social_links: [],
  display_order: 0, fan_count: 100,
})));
const database = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
  const url = new URL(req.url, `https://localhost:${dataPort}`);
  let data = [];
  if (req.method === "GET" && url.pathname === "/rest/v1/published_celebrities") {
    data = rows.filter((row) => ["slug", "locale"].every((key) => !url.searchParams.has(key) || url.searchParams.get(key) === `eq.${row[key]}`));
    if (req.headers.accept?.includes("vnd.pgrst.object")) data = data[0] ?? null;
  } else if (req.method !== "GET" && url.pathname !== "/rest/v1/rpc/read_published_public_image_roles") {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "Fixture refuses mutations" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
});
await new Promise((resolve, reject) => { database.once("error", reject); database.listen(dataPort, resolve); });
const env = {
  ...process.env, NODE_EXTRA_CA_CERTS: cert,
  NEXT_PUBLIC_APP_URL: origin,
  NEXT_PUBLIC_PRIVY_APP_ID: "cmrtb8b7z002w0cjsyo5it6g6",
  NEXT_PUBLIC_BYUS_DATA_ENVIRONMENT: "development", NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT: "development",
  PRIVY_APP_ID: "cmrtb8b7z002w0cjsyo5it6g6", PRIVY_APP_SECRET: "local-fixture-unused",
  BYUS_DATA_ENVIRONMENT: "development", PRIVY_APP_ENVIRONMENT: "development",
  SUPABASE_URL: `https://localhost:${dataPort}`, SUPABASE_SERVICE_ROLE_KEY: "local-fixture-unused",
  GIWA_CHAIN_ID: "91342", GIWA_RPC_URL: "https://sepolia-rpc.giwa.io",
  GIWA_EXPLORER_URL: "https://sepolia-explorer.giwa.io",
  BYUS_PASSPORT_CONTRACT_ADDRESS: `0x${"1".repeat(40)}`,
  BYUS_STAMP_CONTRACT_ADDRESS: `0x${"2".repeat(40)}`,
  BYUS_RELAYER_ADDRESS: `0x${"3".repeat(40)}`,
};
let app;
let browser;
const close = () => { app?.kill("SIGTERM"); database.close(); };
process.once("SIGINT", close);
process.once("SIGTERM", close);
try {
  if (process.argv.includes("--build")) {
    const buildLog = createWriteStream(resolve(output, "build.log"));
    const build = spawn("npm", ["run", "build"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    build.stdout.pipe(buildLog); build.stderr.pipe(buildLog);
    assert.equal((await once(build, "exit"))[0], 0, "npm run build (see build.log)");
    console.log("npm run build PASS");
  }
  const log = createWriteStream(resolve(output, "server.log"));
  app = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "start", "--port", String(port)], { cwd: resolve(root, "apps/web"), env, stdio: ["ignore", "pipe", "pipe"] });
  app.stdout.pipe(log); app.stderr.pipe(log);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${origin}/elina`)).ok) { ready = true; break; } } catch { /* starting */ }
    if (app.exitCode !== null) throw new Error("Next exited; see server.log");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(ready, "Next fixture ready");
  const report = { origin, data: "local fixtures only", pages: [], redirects: [], browser: [] };
  for (const [slug] of roster) for (const locale of ["ko", "en"]) {
    const response = await fetch(`${origin}/${slug}?locale=${locale}`, { headers: { "user-agent": "kakaotalk-scrap/1.0" } });
    assert.equal(response.status, 200, `${slug} ${locale}`);
    const html = await response.text();
    assert(html.includes(`https://byus.kr/${slug}?locale=${locale}`), "canonical root");
    assert(html.includes("celebrity-detail-main"), "server rendered creator");
    report.pages.push({ slug, locale, status: response.status });
  }
  for (const path of ["/missing-creator", "/draft-creator", "/ifew", "/이퓨"]) {
    assert.equal((await fetch(`${origin}${path}`, { headers: { "user-agent": "kakaotalk-scrap/1.0" } })).status, 404, path);
  }
  const old = "/c/ifewknow?locale=en&tab=notice&utm_source=a&utm_source=b&authIntent=11111111-1111-4111-8111-111111111111";
  const redirect = await fetch(`${origin}${old}`, { redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), old.replace("/c/", "/"));
  report.redirects.push({ status: 308, location: redirect.headers.get("location") });
  const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
  assert(sitemap.includes("https://byus.kr/ifewknow?locale=ko"));
  assert(!sitemap.includes("https://byus.kr/c/"));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (error) => console.log("browser error:", error.message));
  await page.goto(`${origin}${old}#celebrity-content`, { waitUntil: "domcontentloaded" });
  await page.locator("#celebrity-heading").waitFor();
  assert.equal(new URL(page.url()).hash, "#celebrity-content");
  assert.equal(new URL(page.url()).pathname, "/ifewknow");
  await page.goto(`${origin}/c/ifewknow?locale=ko#first-reaction`, { waitUntil: "domcontentloaded" });
  await page.locator("#celebrity-heading").waitFor();
  assert.equal(new URL(page.url()).hash, "#first-reaction");
  await page.goto(`${origin}/ifewknow?locale=ko`, { waitUntil: "domcontentloaded" });
  await page.locator("#celebrity-heading").waitFor();
  const verifyLink = page.getByRole("link", { name: "퀴즈 풀고 팬 인증하기", exact: true });
  await verifyLink.waitFor({ timeout: 20_000 });
  const verifyHref = new URL(await verifyLink.getAttribute("href"), origin);
  assert.equal(verifyHref.pathname, "/login", "guest verification enters login");
  assert.equal(verifyHref.searchParams.get("returnTo"), "/c/ifewknow/verify?locale=ko");
  await page.screenshot({ path: resolve(output, "ifewknow-mobile.png"), fullPage: true });
  assert(await page.locator('a[href="/celebrities?locale=ko"][aria-current="page"]').count(), "favorites selected");
  await page.locator('a[href="/ifewknow?tab=certifications&locale=ko#celebrity-content"]').first().click();
  await page.waitForURL(/\/ifewknow\?tab=certifications/);
  report.browser.push("old query + hash", "first-reaction hash", "favorites menu", "verification entry", "root certifications tab");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/elina?locale=en`, { waitUntil: "domcontentloaded" });
  await page.locator("#celebrity-heading").waitFor();
  await page.screenshot({ path: resolve(output, "elina-desktop.png"), fullPage: true });
  await browser.close(); browser = undefined;
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (process.argv.includes("--hold")) {
    console.log(`Ready for Aside inspection: ${origin}`);
    await once(app, "exit");
  }
} finally {
  await browser?.close();
  close();
}
