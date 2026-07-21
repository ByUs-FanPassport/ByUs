import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "../../features/auth/domain/auth-errors";
import { createDeploymentFingerprintHandler, supabaseProjectRef } from "./deployment-fingerprint-route";

const admin = { email: "admin@example.com", role: "admin" as const, appUserId: crypto.randomUUID(), allowlistId: crypto.randomUUID() };
const fingerprint = { supabaseUrl: "https://xcppyedwusirqnfpbtit.supabase.co", vercelEnvironment: "production", vercelTargetEnvironment: "development", vercelUrl: "buyus.vercel.app" };

describe("authenticated deployment fingerprint", () => {
  it("derives a non-secret project ref server-side", async () => {
    expect(supabaseProjectRef(fingerprint.supabaseUrl)).toBe("xcppyedwusirqnfpbtit");
    const response = await createDeploymentFingerprintHandler({ authorize: vi.fn().mockResolvedValue(admin), fingerprint })(new Request("https://buyus.vercel.app/api/admin/e2e-deployment-fingerprint", { headers: { authorization: "Bearer disposable" } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ projectRef: "xcppyedwusirqnfpbtit", deployment: { provider: "vercel", environment: "production", targetEnvironment: "development", host: "buyus.vercel.app" } });
    expect(JSON.stringify(body)).not.toContain("supabase.co");
    expect(JSON.stringify(body)).not.toContain("service_role");
  });

  it("fails closed without an authorized administrator", async () => {
    const response = await createDeploymentFingerprintHandler({ authorize: vi.fn().mockRejectedValue(new AuthError("AUTHENTICATION_REQUIRED", 401, "required")), fingerprint })(new Request("https://buyus.vercel.app/api/admin/e2e-deployment-fingerprint"));
    expect(response.status).toBe(401);
  });
});
