import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ContentCmsRepository } from "./content-cms";
import { celebrityHandlers, type CmsRouteDeps } from "./content-cms-route";

const celebrityId = "33333333-3333-4333-8333-333333333333";

function dependencies(
  rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null }),
) {
  return {
    authorize: vi.fn().mockResolvedValue({
      appUserId: "11111111-1111-4111-8111-111111111111",
      allowlistId: "22222222-2222-4222-8222-222222222222",
      email: "ops@byus.test",
      role: "admin",
    }),
    repository: new ContentCmsRepository({ rpc } as never),
    invalidatePublicContent: vi.fn(),
  } satisfies CmsRouteDeps;
}

function request(action: "publish" | "unpublish") {
  return new Request("https://byus.test/api/admin/celebrities", {
    method: "POST",
    headers: {
      authorization: "Bearer test",
      "content-type": "application/json",
    },
    body: JSON.stringify({ action, celebrityId }),
  });
}

describe("content CMS cache invalidation", () => {
  it("invalidates tagged public responses after the publication transaction succeeds", async () => {
    const deps = dependencies();
    const response = await celebrityHandlers(deps).POST(request("publish"));
    expect(response.status).toBe(200);
    expect(deps.invalidatePublicContent).toHaveBeenCalledOnce();
  });

  it("does not invalidate when the publication transaction fails", async () => {
    const deps = dependencies(
      vi.fn().mockResolvedValue({
        data: null,
        error: { message: "database unavailable" },
      }),
    );
    const response = await celebrityHandlers(deps).POST(request("unpublish"));
    expect(response.status).toBe(503);
    expect(deps.invalidatePublicContent).not.toHaveBeenCalled();
  });
});
