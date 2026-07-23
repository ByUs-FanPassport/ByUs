import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures/protected-preview";

const adminToken = process.env.BYUS_E2E_ADMIN_ACCESS_TOKEN?.trim() ?? "";

test.beforeAll(() => {
  if (!adminToken) throw new Error("BYUS_E2E_ADMIN_ACCESS_TOKEN is required");
});

async function authenticateAdmin(page: Page, route: string) {
  await page.goto("/");
  await page.evaluate(
    (accessToken) => localStorage.setItem("privy:token", JSON.stringify(accessToken)),
    adminToken,
  );
  await page.goto(route);
  await expect(page).not.toHaveURL(/\/admin\/login/);
}

async function expectPageIsolated(page: Page) {
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  expect(
    await page.locator("body > :not([data-overlay-host])").evaluateAll((elements) =>
      elements.every((element) => element instanceof HTMLElement && element.inert),
    ),
  ).toBe(true);
}

async function expectFocusTrapped(page: Page, overlay: Locator) {
  await page.keyboard.press("Shift+Tab");
  expect(await overlay.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  expect(await overlay.evaluate((element) => element.contains(document.activeElement))).toBe(true);
}

async function openDrawerAndAssertContract({
  page,
  route,
  triggerName,
}: {
  page: Page;
  route: string;
  triggerName: RegExp;
}) {
  await authenticateAdmin(page, route);
  const trigger = page.getByRole("button", { name: triggerName }).first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "상세 닫기" })).toBeFocused();
  await expectPageIsolated(page);
  await expectFocusTrapped(page, dialog);
  return { dialog, trigger };
}

test("ADM-010 fan drawer traps focus, isolates the page, closes with Escape, and restores its trigger", async ({ page }) => {
  const { dialog, trigger } = await openDrawerAndAssertContract({
    page,
    route: "/admin/fans",
    triggerName: /^팬 상세:/,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("ADM-011 job drawer and nested retry alertdialog preserve modal stack and keyboard restoration", async ({ page }) => {
  const { dialog, trigger } = await openDrawerAndAssertContract({
    page,
    route: "/admin/blockchain-jobs",
    triggerName: /^작업 상세:/,
  });
  const retryTrigger = dialog.getByRole("button", { name: "재시도 요청" });
  await expect(retryTrigger).toBeEnabled();
  await retryTrigger.click();

  const alert = page.getByRole("alertdialog", { name: "이 작업을 재시도할까요?" });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("button", { name: "취소" })).toBeFocused();
  await expectPageIsolated(page);
  expect(
    await dialog.locator("xpath=ancestor::*[@data-overlay-host][1]").evaluate((element) =>
      element instanceof HTMLElement && element.inert,
    ),
  ).toBe(true);
  await expectFocusTrapped(page, alert);

  await page.keyboard.press("Escape");
  await expect(alert).toBeHidden();
  await expect(retryTrigger).toBeFocused();
  await expect(dialog).toBeVisible();
  await expectPageIsolated(page);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("ADM-012 audit drawer traps focus, isolates the page, closes with Escape, and restores its trigger", async ({ page }) => {
  const { dialog, trigger } = await openDrawerAndAssertContract({
    page,
    route: "/admin/audit",
    triggerName: /^로그 상세:/,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});
