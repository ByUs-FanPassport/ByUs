import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/features/auth/domain/auth-errors";

const { authorize, get } = vi.hoisted(() => ({ authorize: vi.fn(), get: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));
vi.mock("@/server/config/env", () => ({ loadServerEnv: () => ({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", PRIVY_APP_ID: "test", PRIVY_APP_SECRET: "test" }) }));
vi.mock("@/server/auth/privy-node-verifier", () => ({ createPrivyNodeAccessVerifier: () => ({}) }));
vi.mock("@/server/fan-auth/fan-auth-gate", () => ({ authorizeFanRequest: authorize }));
vi.mock("@/server/fan-auth/supabase-fan-auth-repository", () => ({ createSupabaseFanAuthRepository: () => ({}) }));
vi.mock("@/server/my/my-summary-repository", () => ({ createSupabaseMySummaryRepository: () => ({ get }) }));
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue({ appUserId: "canonical-owner" });
  get.mockResolvedValue({ creators: [] });
});

describe("MY summary stage opt-in", () => {
  it.each(["", "?tierStages=0", "?tierStages=true"])("keeps old requests on the old contract: %s", async (query) => {
    const response = await GET(new Request(`https://byus.kr/api/me/summary${query}`));
    expect(response.status).toBe(200);
    expect(get).toHaveBeenCalledExactlyOnceWith({ appUserId: "canonical-owner", locale: "ko", asOf: expect.any(Date) });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("opts in with the authenticated identity, ignoring query identity", async () => {
    await GET(new Request("https://byus.kr/api/me/summary?locale=en&tierStages=1&appUserId=other", { headers: { authorization: "Bearer token" } }));
    expect(get).toHaveBeenCalledExactlyOnceWith({ appUserId: "canonical-owner", locale: "en", asOf: expect.any(Date), includeStages: true });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ authorization: "Bearer token" }));
  });

  it("does not read any owner data after auth rejection", async () => {
    authorize.mockRejectedValue(new AuthError("AUTHENTICATION_REQUIRED", 401, "denied"));
    const response = await GET(new Request("https://byus.kr/api/me/summary?tierStages=1"));
    expect(response.status).toBe(401);
    expect(get).not.toHaveBeenCalled();
  });
});
