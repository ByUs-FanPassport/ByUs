import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dependencies: vi.fn(),
  get: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
  post: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
}));
vi.mock("../../../../server/g5/home-banner-manager-route-dependencies", () => ({
  createHomeBannerManagerDependencies: mocks.dependencies,
}));
vi.mock("../../../../server/g5/home-banner-manager-route", () => ({
  createHomeBannerManagerHandlers: () => ({ GET: mocks.get, POST: mocks.post }),
}));

it("defers environment-dependent initialization until a request reaches the route", async () => {
  mocks.dependencies.mockImplementation(() => { throw new Error("build-time environment must not be loaded"); });
  const route = await import("./route");
  expect(mocks.dependencies).not.toHaveBeenCalled();

  mocks.dependencies.mockReturnValue({});
  const get = new Request("https://example.test/api/admin/home-banners");
  const post = new Request(get.url, { method: "POST" });
  await route.GET(get);
  await route.POST(post);
  expect(mocks.dependencies).toHaveBeenCalledTimes(2);
  expect(mocks.get).toHaveBeenCalledWith(get);
  expect(mocks.post).toHaveBeenCalledWith(post);
});
