import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadInstagramConfig } from "./config";
const env = { INSTAGRAM_INTEGRATION_ENABLED: "true", INSTAGRAM_APP_ID: "123", INSTAGRAM_APP_SECRET: "local-test-secret", INSTAGRAM_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), INSTAGRAM_GRAPH_VERSION: "v25.0", INSTAGRAM_APP_ORIGIN: "https://byus-test.invalid" };
describe("Instagram configuration", () => {
  it("defaults disabled and permits erasure while collection is disabled", () => {
    expect(() => loadInstagramConfig({ ...env, INSTAGRAM_INTEGRATION_ENABLED: "false" })).toThrow();
    expect(loadInstagramConfig({ ...env, INSTAGRAM_INTEGRATION_ENABLED: "false" }, true).origin).toBe(env.INSTAGRAM_APP_ORIGIN);
    expect(loadInstagramConfig(env).remoteRevocationVerified).toBe(false);
  });
  it.each(["https://byus-test.invalid/redirect", "http://remote.invalid", "https://user:password@byus-test.invalid", "https://byus-test.invalid/"])("rejects an unsafe or ambiguous callback origin", (origin) => {
    expect(() => loadInstagramConfig({ ...env, INSTAGRAM_APP_ORIGIN: origin })).toThrow();
  });
});
