import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "../../features/auth/domain/auth-errors";
import {
  createGetOnboardingHandler,
  createPostOnboardingHandler,
  type OnboardingRouteDependencies,
} from "./onboarding-route";

const state = {
  completed: { profile: true, verify: false, reserve: false },
  dismissed: false,
};

describe("onboarding route handlers", () => {
  const authorize = vi.fn();
  const get = vi.fn();
  const dismiss = vi.fn();
  const dependencies: OnboardingRouteDependencies = {
    authorize,
    repository: { get, dismiss },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({ appUserId: "canonical-owner" });
    get.mockResolvedValue(state);
    dismiss.mockResolvedValue({ ...state, dismissed: true });
  });

  it("returns the authenticated account state without accepting an owner", async () => {
    const response = await createGetOnboardingHandler(dependencies)(
      new Request("https://byus.kr/api/me/onboarding?appUserId=other", {
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ onboarding: state });
    expect(authorize).toHaveBeenCalledExactlyOnceWith("Bearer token");
    expect(get).toHaveBeenCalledExactlyOnceWith("canonical-owner");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("permanently dismisses with an empty body for the authenticated account", async () => {
    const response = await createPostOnboardingHandler(dependencies)(
      new Request("https://byus.kr/api/me/onboarding", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      onboarding: { ...state, dismissed: true },
    });
    expect(dismiss).toHaveBeenCalledExactlyOnceWith("canonical-owner");
  });

  it("rejects owner input instead of allowing cross-account dismissal", async () => {
    const response = await createPostOnboardingHandler(dependencies)(
      new Request("https://byus.kr/api/me/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appUserId: "other" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("does not read state after authentication rejection", async () => {
    authorize.mockRejectedValue(
      new AuthError("AUTHENTICATION_REQUIRED", 401, "denied"),
    );
    const response = await createGetOnboardingHandler(dependencies)(
      new Request("https://byus.kr/api/me/onboarding"),
    );

    expect(response.status).toBe(401);
    expect(get).not.toHaveBeenCalled();
  });

  it("fails closed when persistence is unavailable", async () => {
    get.mockRejectedValue(new Error("database unavailable"));
    const response = await createGetOnboardingHandler(dependencies)(
      new Request("https://byus.kr/api/me/onboarding"),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "ONBOARDING_UNAVAILABLE" },
    });
  });
});
