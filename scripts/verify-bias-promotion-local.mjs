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
const output = resolve(root, "work/bias-promotion-local");
await mkdir(output, { recursive: true });
const port = Number(process.env.BIAS_PROMOTION_PORT || 5175);
const dataPort = Number(process.env.BIAS_PROMOTION_DATA_PORT || 3176);
const origin = `http://localhost:${port}`;
const key = resolve(output, "localhost.key");
const cert = resolve(output, "localhost.crt");
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "2",
    "-keyout",
    key,
    "-out",
    cert,
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost",
  ],
  { stdio: "ignore" },
);

const roster = [
  ["elina", "엘리나"],
  ["changha", "창하"],
  ["yuna", "유나"],
  ["jenny-jeong", "정제니"],
  ["aryeom", "아렴"],
  ["park-myungho", "박명호"],
  ["ifewknow", "이퓨"],
  ["thisisj-official", "재희"],
];
const rows = roster.flatMap(([slug, name], displayOrder) =>
  ["ko", "en"].map((locale) => ({
    slug,
    locale,
    name: locale === "ko" ? name : slug,
    summary: `${name} fan page`,
    image_url: `/images/celebrities/${slug}/${slug === "yuna" ? "hero-studio-mobile.jpg" : slug === "park-myungho" ? "profile-20260910.png" : slug === "aryeom" ? "hero-portrait.jpg" : slug === "ifewknow" ? "hero-studio.jpg" : slug === "thisisj-official" ? "hero-source.webp" : "hero-source.jpg"}`,
    image_alt: name,
    image_position: "center",
    primary_role: "creator",
    themes: [],
    social_links: [],
    display_order: displayOrder,
    fan_count: 100,
  })),
);
let mode = "normal";
const largeRows = Array.from({ length: 1001 }, (_, index) => ({
  ...rows[0],
  slug: `person-${index}`,
  name: `Person ${index}`,
}));
const database = createServer(
  { key: readFileSync(key), cert: readFileSync(cert) },
  (req, res) => {
    const url = new URL(req.url, `https://localhost:${dataPort}`);
    let data = [];
    if (
      req.method === "GET" &&
      url.pathname === "/rest/v1/published_celebrities"
    ) {
      if (mode === "error") {
        res.writeHead(503);
        res.end("unavailable");
        return;
      }
      data = (
        mode === "empty" ? [] : mode === "large" ? largeRows : rows
      ).filter((row) =>
        ["slug", "locale"].every(
          (key) =>
            !url.searchParams.has(key) ||
            url.searchParams.get(key) === `eq.${row[key]}`,
        ),
      );
      const offset = Number(url.searchParams.get("offset") || 0);
      data = data.slice(
        offset,
        offset + Number(url.searchParams.get("limit") || 1000),
      );
      if (req.headers.accept?.includes("vnd.pgrst.object"))
        data = data[0] ?? null;
    } else if (
      req.method !== "GET" &&
      url.pathname !== "/rest/v1/rpc/read_published_public_image_roles"
    ) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Fixture refuses mutations" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  },
);
await new Promise((resolve, reject) => {
  database.once("error", reject);
  database.listen(dataPort, resolve);
});
const env = {
  ...process.env,
  NODE_EXTRA_CA_CERTS: cert,
  NEXT_PUBLIC_APP_URL: origin,
  NEXT_PUBLIC_PRIVY_APP_ID: "cmrtb8b7z002w0cjsyo5it6g6",
  NEXT_PUBLIC_BYUS_DATA_ENVIRONMENT: "development",
  NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT: "development",
  PRIVY_APP_ID: "cmrtb8b7z002w0cjsyo5it6g6",
  PRIVY_APP_SECRET: "local-fixture-unused",
  BYUS_DATA_ENVIRONMENT: "development",
  PRIVY_APP_ENVIRONMENT: "development",
  SUPABASE_URL: `https://localhost:${dataPort}`,
  SUPABASE_SERVICE_ROLE_KEY: "local-fixture-unused",
  GIWA_CHAIN_ID: "91342",
  GIWA_RPC_URL: "https://sepolia-rpc.giwa.io",
  GIWA_EXPLORER_URL: "https://sepolia-explorer.giwa.io",
  BYUS_PASSPORT_CONTRACT_ADDRESS: `0x${"1".repeat(40)}`,
  BYUS_STAMP_CONTRACT_ADDRESS: `0x${"2".repeat(40)}`,
  BYUS_RELAYER_ADDRESS: `0x${"3".repeat(40)}`,
};
let app;
let browser;
const close = () => {
  app?.kill("SIGTERM");
  database.close();
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
try {
  if (process.argv.includes("--build")) {
    const buildLog = createWriteStream(resolve(output, "build.log"));
    const build = spawn("npm", ["run", "build"], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    build.stdout.pipe(buildLog);
    build.stderr.pipe(buildLog);
    assert.equal(
      (await once(build, "exit"))[0],
      0,
      "npm run build (see build.log)",
    );
    console.log("npm run build PASS");
  }
  const log = createWriteStream(resolve(output, "server.log"));
  app = spawn(
    process.execPath,
    [
      resolve(root, "node_modules/next/dist/bin/next"),
      "start",
      "--port",
      String(port),
    ],
    { cwd: resolve(root, "apps/web"), env, stdio: ["ignore", "pipe", "pipe"] },
  );
  app.stdout.pipe(log);
  app.stderr.pipe(log);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(`${origin}/elina`)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* starting */
    }
    if (app.exitCode !== null) throw new Error("Next exited; see server.log");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(ready, "Next fixture ready");
  const report = {
    origin,
    data: "local public fixtures only; no production writes",
    checks: [],
  };
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const visit = async (query = "celebrity=elina") => {
    await page.goto(`${origin}/bias/promotion?${query}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.waitForFunction(() => document.fonts.status === "loaded");
  };
  const noOverflow = async () =>
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "no horizontal overflow",
    );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await visit();
    await page.getByRole("button", { name: "링크 복사", exact: true }).click();
    await page
      .getByRole("button", { name: "복사 완료", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "https://byus.kr/elina",
    );
    await page
      .getByRole("button", { name: "홍보 글 복사", exact: true })
      .click();
    assert(
      (await page.evaluate(() => navigator.clipboard.readText())).includes(
        "https://byus.kr/elina",
      ),
    );
    for (const label of [
      "프로필 문구 복사",
      "스토리 문구 복사",
      "안내 멘트 복사",
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      assert(
        (await page.evaluate(() => navigator.clipboard.readText())).includes(
          "byus.kr/elina",
        ),
      );
    }
    await page.screenshot({
      path: resolve(output, `promotion-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await noOverflow();
    const all = page.getByRole("button", { name: "전체 보기", exact: true });
    await all.click();
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.getByText("복사했어요. 원하는 곳에 붙여넣어 주세요.").count(), 0, "opening picker clears copy toast");
    await page.screenshot({
      path: resolve(output, `picker-${width}.png`),
      fullPage: false,
      animations: "disabled",
    });
    await page
      .getByRole("textbox", { name: "이름 또는 핸들로 검색" })
      .fill("ifewknow");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "이퓨", exact: true })
      .click();
    await page.getByRole("button", { name: "이퓨 선택", exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.get("celebrity"), "ifewknow");
    assert.equal(
      await page
        .getByRole("link", { name: "팬페이지 열기" })
        .getAttribute("href"),
      "https://byus.kr/ifewknow",
    );
    await all.click();
    await page.getByRole("textbox").fill("zzzz-unmatched");
    assert(
      await page.getByText("검색 결과가 없어요.", { exact: false }).isVisible(),
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.activeElement?.textContent === "전체 보기",
    );
    await page.reload();
    await page.getByRole("heading", { level: 1 }).waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: "팬페이지 열기" })
        .getAttribute("href"),
      "https://byus.kr/ifewknow",
    );
    await page.getByRole("link", { name: "EN", exact: true }).click();
    await page.getByRole("heading", { name: /Let fans know/ }).waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: "Open fan page" })
        .getAttribute("href"),
      "https://byus.kr/ifewknow?locale=en",
    );
    await noOverflow();
    await page.screenshot({
      path: resolve(output, `promotion-en-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    report.checks.push(
      `${width}px: all copy variants, full picker, search, selection URL/reload/locale, Escape focus, no overflow`,
    );
  }
  await visit("celebrity=private-person");
  assert(
    await page
      .getByRole("button", { name: "링크 복사", exact: true })
      .isDisabled(),
    "unknown explicit profile cannot restore someone else",
  );
  await page.getByRole("button", { name: "엘리나", exact: true }).click();
  await page.evaluate(() =>
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async () => {
        throw new Error("denied");
      },
    }),
  );
  await page.getByRole("button", { name: "링크 복사", exact: true }).click();
  assert(
    await page.getByText("복사하지 못했어요.", { exact: false }).isVisible(),
  );
  report.checks.push(
    "unknown/private selection disabled; clipboard denial feedback",
  );
  await page.getByRole("button", { name: "담당자에게 문의하기", exact: true }).click();
  await page.getByRole("heading", { name: "팬 활동 상담", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  report.checks.push("guest contact dialog opens without sending an inquiry");
  mode = "large";
  await visit("celebrity=person-1000");
  await page.getByRole("button", { name: "전체 보기", exact: true }).click();
  await page.getByRole("button", { name: "다음 페이지" }).click();
  assert(await page.getByText("2 / 112", { exact: true }).isVisible());
  await page.getByRole("textbox").fill("person-1000");
  assert(
    await page
      .getByRole("button", { name: "Person 1000", exact: true })
      .isVisible(),
  );
  await page.keyboard.press("Escape");
  report.checks.push("1001 public profiles: pagination and full-roster search");
  mode = "empty";
  await visit();
  assert(await page.getByText("아직 공개된 팬페이지가 없어요.").isVisible());
  mode = "error";
  await visit();
  assert(await page.getByText("지금은 목록을 불러올 수 없어요.").isVisible());
  report.checks.push("empty and unavailable states stay distinct");
  mode = "normal";
  for (const [path, destination] of [
    [
      "/bias?locale=en&celebrity=elina",
      "/bias/promotion?locale=en&celebrity=elina",
    ],
    ["/bias/instagram?locale=en", "/connect/instagram?locale=en"],
  ]) {
    const response = await fetch(`${origin}${path}`, { redirect: "manual" });
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), destination);
  }
  assert.equal(errors.length, 0, JSON.stringify(errors));
  report.checks.push(
    "guide/Instagram redirects and no uncaught browser errors",
  );
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  await context.close();
  await browser.close();
  browser = undefined;
  if (process.argv.includes("--hold")) {
    console.log(
      `Ready for Aside inspection: ${origin}/bias/promotion?celebrity=elina`,
    );
    await once(app, "exit");
  }
} catch (error) {
  const failedPage = browser?.contexts()[0]?.pages()[0];
  if (failedPage) {
    await failedPage.screenshot({ path: resolve(output, "failure.png"), fullPage: false });
    await writeFile(resolve(output, "failure.txt"), await failedPage.locator("body").innerText());
  }
  throw error;
} finally {
  await browser?.close();
  close();
}
