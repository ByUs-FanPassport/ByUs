import { describe, expect, it, vi } from "vitest";

const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag }));

import { PUBLIC_CONTENT_CACHE_TAG } from "./public-content-cache";
import { invalidatePublicContentCache } from "./public-content-revalidation";

describe("public content revalidation", () => {
  it("requests immediate deletion of the response cache tag", () => {
    invalidatePublicContentCache();
    expect(revalidateTag).toHaveBeenCalledWith(PUBLIC_CONTENT_CACHE_TAG, {
      expire: 0,
    });
  });
});
