import { describe, expect, it } from "vitest";
import { parseNotificationEnv } from "../src/notification-env.js";
const valid = {
  NOTIFICATION_WORKER_ENABLED: "true",
  NOTIFICATION_WORKER_ID: "notify-prod-1",
  NOTIFICATION_WORKER_BATCH_SIZE: "25",
  NOTIFICATION_WORKER_LEASE_SECONDS: "120",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "s".repeat(48),
  WEB_PUSH_VAPID_SUBJECT: "mailto:ops@byus.example",
  WEB_PUSH_VAPID_PUBLIC_KEY: "A".repeat(88),
  WEB_PUSH_VAPID_PRIVATE_KEY: "B".repeat(43),
};
describe("notification worker secrets", () => {
  it("accepts complete VAPID and queue configuration without exposing values", () => {
    expect(parseNotificationEnv(valid).NOTIFICATION_WORKER_ID).toBe(
      "notify-prod-1",
    );
  });
  it.each([
    "SUPABASE_SERVICE_ROLE_KEY",
    "WEB_PUSH_VAPID_SUBJECT",
    "WEB_PUSH_VAPID_PUBLIC_KEY",
    "WEB_PUSH_VAPID_PRIVATE_KEY",
  ])("rejects missing required %s", (key) => {
    const source = { ...valid };
    delete source[key as keyof typeof source];
    expect(() => parseNotificationEnv(source)).toThrow();
  });
  it("rejects malformed VAPID private keys", () => {
    expect(() =>
      parseNotificationEnv({
        ...valid,
        WEB_PUSH_VAPID_PRIVATE_KEY: "not-a-key",
      }),
    ).toThrow();
  });
});
