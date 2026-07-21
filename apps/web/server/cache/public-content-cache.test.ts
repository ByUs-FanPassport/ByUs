import { describe, expect, it } from "vitest";

import {
  PUBLIC_CONTENT_CACHE_CONTROL,
  PUBLIC_CONTENT_CACHE_TAG,
  publicContentCacheHeaders,
} from "./public-content-cache";

describe("public content cache policy", () => {
  it("declares a measurable 60 second edge freshness ceiling", () => {
    expect(PUBLIC_CONTENT_CACHE_CONTROL).toContain("max-age=0");
    expect(PUBLIC_CONTENT_CACHE_CONTROL).toContain("must-revalidate");
    expect(PUBLIC_CONTENT_CACHE_CONTROL).toContain("s-maxage=60");
  });

  it("associates every cacheable response with the publication tag", () => {
    expect(publicContentCacheHeaders()).toMatchObject({
      "vercel-cache-tag": PUBLIC_CONTENT_CACHE_TAG,
    });
  });
});
