import { beforeEach, describe, expect, it, vi } from "vitest";

const { createDependencies, getHandler, postHandler } = vi.hoisted(() => ({
  createDependencies: vi.fn(),
  getHandler: vi.fn(),
  postHandler: vi.fn(),
}));

vi.mock("@/server/onboarding/onboarding-route-dependencies", () => ({
  createOnboardingRouteDependencies: createDependencies,
  onboardingUnavailableResponse: () =>
    Response.json(
      { error: { code: "ONBOARDING_UNAVAILABLE" } },
      { status: 503 },
    ),
}));
vi.mock("@/server/onboarding/onboarding-route", () => ({
  createGetOnboardingHandler: getHandler,
  createPostOnboardingHandler: postHandler,
}));

import { GET, POST } from "./route";

describe("/api/me/onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDependencies.mockReturnValue({ marker: "dependencies" });
  });

  it.each([
    ["GET", GET, getHandler],
    ["POST", POST, postHandler],
  ] as const)("wires %s through the server handler", async (_, route, factory) => {
    const response = Response.json({ ok: true });
    const handler = vi.fn().mockResolvedValue(response);
    factory.mockReturnValue(handler);
    const request = new Request("https://byus.kr/api/me/onboarding", {
      method: route === POST ? "POST" : "GET",
    });

    await expect(route(request)).resolves.toBe(response);
    expect(factory).toHaveBeenCalledExactlyOnceWith({ marker: "dependencies" });
    expect(handler).toHaveBeenCalledExactlyOnceWith(request);
  });

  it("fails closed if dependency creation fails", async () => {
    createDependencies.mockImplementation(() => {
      throw new Error("configuration unavailable");
    });

    const response = await GET(
      new Request("https://byus.kr/api/me/onboarding"),
    );
    expect(response.status).toBe(503);
  });
});
