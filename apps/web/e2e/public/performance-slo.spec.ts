import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { requireEvidenceRunId } from "./public-test-support";

const repoRoot = path.resolve(__dirname, "../../../..");
const CTA_SLO_MS = 8_000;

test("SYS-004 primary CTA is operable within 8s on slow 3G with motion and optional media blocked", async ({
  browserName,
  page,
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "Chromium CDP provides deterministic network emulation",
  );

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(/\.(?:avif|gif|jpe?g|png|webp|woff2?)(?:\?.*)?$/i, (route) =>
    route.abort(),
  );

  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 400,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8,
    connectionType: "cellular3g",
  });

  const startedAt = performance.now();
  const response = await page.goto("/", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const primaryAction = page.getByRole("link", { name: /라이브 예약하기|LIVE 상세보기/ });
  await expect(primaryAction).toBeVisible({ timeout: CTA_SLO_MS });
  const ctaOperableMs = Math.round(performance.now() - startedAt);
  const actionLabel = (await primaryAction.textContent()) ?? "";
  if (actionLabel.includes("라이브 예약하기")) {
    await expect(primaryAction).toHaveAttribute("href", /returnTo=%2Flive%2F/);
  } else {
    await expect(primaryAction).toHaveAttribute("href", /^\/live\//);
  }

  expect(response?.status()).toBeLessThan(400);
  expect(ctaOperableMs).toBeLessThanOrEqual(CTA_SLO_MS);
  expect(
    await primaryAction.evaluate(
      (element) => getComputedStyle(element).pointerEvents,
    ),
  ).not.toBe("none");

  const runId = requireEvidenceRunId();
  const evidenceDirectory = path.join(
    repoRoot,
    "artifacts/e2e/g6-release",
    runId,
    "performance",
    testInfo.project.name,
  );
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    path.join(evidenceDirectory, "SYS-004.json"),
    `${JSON.stringify(
      {
        screen: "FAN-001",
        requirement: "SYS-004",
        project: testInfo.project.name,
        profile: {
          latencyMs: 400,
          downloadKbps: 400,
          uploadKbps: 400,
          reducedMotion: true,
          optionalMedia: "blocked",
        },
        sloMs: CTA_SLO_MS,
        ctaOperableMs,
        actionLabel: actionLabel.trim(),
        status: response?.status(),
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
});
