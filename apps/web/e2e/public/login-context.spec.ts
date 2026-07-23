import { expect, test } from "@playwright/test";

test("FAN-004 opens over the initiating fan page and restores it on Escape", async ({ page }) => {
  await page.goto("/c/kara");
  const trigger = page
    .getByRole("region", { name: "KARA Fan Passport" })
    .getByRole("link", { name: "팬 인증하기" });
  await trigger.click();

  await expect(page).toHaveURL(/\/login\?.*authIntent=/);
  const dialog = page.getByRole("dialog", { name: "최애와 함께한 순간을 기록하세요." });
  await expect(dialog).toBeVisible();
  await expect(page.locator("h1", { hasText: /^KARA$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "로그인 창 닫기" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/c\/kara$/);
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("direct FAN-004 access keeps the standalone fallback", async ({ page }) => {
  await page.goto("/login?returnTo=%2Fc%2Fkara%2Fverify&intent=passport&entity=kara");

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "홈으로 돌아가기", exact: true })).toBeVisible();
});
