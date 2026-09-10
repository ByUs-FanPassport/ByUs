import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const worker = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

describe("localized notification service worker", () => {
  it("stores a validated locale with the notification and localizes fallbacks", () => {
    expect(worker).toContain('payload.locale === "en" ? "en" : "ko"');
    expect(worker).toContain('data: { notificationId, locale }');
    expect(worker).toContain('"ByUs notification"');
    expect(worker).toContain('"Review your new notification."');
  });

  it("preserves locale for both id and no-id notification clicks", () => {
    expect(worker).toContain('`/notifications?open=${encodeURIComponent(id)}&locale=${locale}`');
    expect(worker).toContain('`/notifications?locale=${locale}`');
    expect(worker).toContain("client.navigate(target)");
    expect(worker).toContain("clients.openWindow(target)");
  });
});
