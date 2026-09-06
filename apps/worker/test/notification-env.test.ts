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
  it("allows SES email without Kakao and requires the approved region and sender", () => {
    const ses = {...valid, NOTIFICATION_EXTERNAL_MODE:"ses_email",NOTIFICATION_WORKER_BATCH_SIZE:"2", SES_REGION:"ap-northeast-2", SES_FROM_EMAIL:"notifications@byus.kr"};
    expect(parseNotificationEnv(ses).NOTIFICATION_EXTERNAL_MODE).toBe("ses_email");
    expect(() => parseNotificationEnv({...ses, NOTIFICATION_WORKER_BATCH_SIZE:"25"})).toThrow();
    expect(() => parseNotificationEnv({...ses, SES_FROM_EMAIL:undefined})).toThrow();
    expect(() => parseNotificationEnv({...ses, SES_REGION:"us-east-1"})).toThrow();
  });
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
  it("allows the required Dev test sink but never a Production test sink",()=>{
    expect(parseNotificationEnv({...valid,NOTIFICATION_EXTERNAL_MODE:"test_sink",NOTIFICATION_EXTERNAL_ENVIRONMENT:"dev"})).toMatchObject({NOTIFICATION_EXTERNAL_MODE:"test_sink"});
    expect(()=>parseNotificationEnv({...valid,NOTIFICATION_EXTERNAL_MODE:"test_sink",NOTIFICATION_EXTERNAL_ENVIRONMENT:"prod"})).toThrow();
  });
  it("requires all sandbox provider endpoints and tokens in provider mode",()=>{
    expect(()=>parseNotificationEnv({...valid,NOTIFICATION_EXTERNAL_MODE:"provider"})).toThrow();
    expect(parseNotificationEnv({...valid,NOTIFICATION_EXTERNAL_MODE:"provider",EMAIL_PROVIDER_URL:"https://email.test/send",EMAIL_PROVIDER_TOKEN:"e".repeat(16),KAKAO_PROVIDER_URL:"https://kakao.test/send",KAKAO_PROVIDER_TOKEN:"k".repeat(16)})).toMatchObject({NOTIFICATION_EXTERNAL_MODE:"provider"});
  });
});
