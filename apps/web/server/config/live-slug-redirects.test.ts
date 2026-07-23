import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("legacy LIVE slug redirects", () => {
  it("permanently redirects Elina and Changha NUALEAF URLs to ByUs URLs", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toEqual(
      expect.arrayContaining([
        {
          source: "/live/elina-nualeaf-live/:path*",
          destination: "/live/elina-byus-live/:path*",
          permanent: true,
        },
        {
          source: "/live/changha-nualeaf-live/:path*",
          destination: "/live/changha-byus-live/:path*",
          permanent: true,
        },
      ]),
    );
  });
});
