import { describe, expect, it } from "vitest";
import { isTrustedWebPushEndpoint } from "../src/adapters/web-push-endpoint.js";

describe("isTrustedWebPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/token",
    "https://jmt17.google.com/fcm/send/token",
    "https://updates.push.services.mozilla.com/wpush/v2/token",
    "https://web.push.apple.com/token",
    "https://api.push.apple.com/token",
    "https://wns2-by3p.notify.windows.com/?token=opaque",
  ])("allows trusted browser push provider endpoint %s", (endpoint) => {
    expect(isTrustedWebPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/token",
    "https://localhost/token",
    "https://127.0.0.1/token",
    "https://[::1]/token",
    "https://169.254.169.254/latest/meta-data",
    "https://fcm.googleapis.com.evil.example/token",
    "https://evilfcm.googleapis.com/token",
    "https://region.fcm.googleapis.com/token",
    "https://region.updates.push.services.mozilla.com/token",
    "https://jmt17.google.com/log/token",
    "https://user:password@fcm.googleapis.com/token",
    "https://fcm.googleapis.com:8443/token",
    "https://fcm.googleapis.com/token#fragment",
    " https://fcm.googleapis.com/token",
    "https://fcm.googleapis.com/token\n",
    "https://fcm.googleapis.com\\@127.0.0.1/token",
    "https://push.apple.com/token",
    "https://notify.windows.com/token",
  ])("rejects untrusted or ambiguous endpoint %s", (endpoint) => {
    expect(isTrustedWebPushEndpoint(endpoint)).toBe(false);
  });
});
