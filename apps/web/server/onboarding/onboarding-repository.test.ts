import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SupabaseOnboardingRepository } from "./onboarding-repository";

const state = {
  completed: { profile: true, verify: true, reserve: false },
  dismissed: false,
};

describe("SupabaseOnboardingRepository", () => {
  const rpc = vi.fn();
  const repository = new SupabaseOnboardingRepository({ rpc });

  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: state, error: null });
  });

  it("reads canonical account-wide onboarding state", async () => {
    await expect(repository.get("owner-a")).resolves.toEqual(state);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "read_owned_onboarding_state",
      { p_app_user_id: "owner-a" },
    );
  });

  it("persists dismissal for the authenticated owner", async () => {
    rpc.mockResolvedValue({
      data: { ...state, dismissed: true },
      error: null,
    });

    await expect(repository.dismiss("owner-b")).resolves.toEqual({
      ...state,
      dismissed: true,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "dismiss_owned_onboarding",
      { p_app_user_id: "owner-b" },
    );
  });

  it.each([
    { data: state, error: { message: "database unavailable" } },
    { data: { completed: { profile: true } }, error: null },
  ])("fails closed when the state cannot be trusted", async (result) => {
    rpc.mockResolvedValue(result);
    await expect(repository.get("owner-a")).rejects.toThrow(
      "ONBOARDING_UNAVAILABLE",
    );
  });
});
