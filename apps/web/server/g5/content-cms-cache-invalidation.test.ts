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

it.each([true, false])("invalidates role edits only after a successful save (%s)", async (success) => {
  const deps = dependencies(vi.fn().mockResolvedValue(success ? { data: { roles: ["artist"] }, error: null } : { data: null, error: { message: "failed" } }));
  const response = await celebrityHandlers(deps).POST(new Request("https://byus.test/api/admin/celebrities", {
    method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" },
    body: JSON.stringify({ action: "save", celebrityId, payload: {
      slug: "kara", imageUrl: "/kara.jpg", imagePosition: "center", displayOrder: 0, fanCount: 10, roles: ["artist"],
      localizations: { ko: { name: "카라", summary: "소개", imageAlt: "카라" }, en: { name: "KARA", summary: "Profile", imageAlt: "KARA" } }, themes: [], socialLinks: [],
    } }),
  }));
  expect(response.status).toBe(success ? 200 : 503);
  expect(deps.invalidatePublicContent).toHaveBeenCalledTimes(success ? 1 : 0);
});

it.each([null, celebrityId])("rejects missing roles on creation but accepts an existing edit (%s)", async (id) => {
  const rpc = vi.fn().mockResolvedValue({ data: { roles: ["artist"] }, error: null });
  const deps = dependencies(rpc);
  const response = await celebrityHandlers(deps).POST(new Request("https://byus.test/api/admin/celebrities", {
    method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" },
    body: JSON.stringify({ action: "save", celebrityId: id, payload: {
      slug: "kara", imageUrl: "/kara.jpg", imagePosition: "center", displayOrder: 0, fanCount: 10,
      localizations: { ko: { name: "카라", summary: "소개", imageAlt: "카라" }, en: { name: "KARA", summary: "Profile", imageAlt: "KARA" } }, themes: [], socialLinks: [],
    } }),
  }));
  expect(response.status).toBe(id === null ? 400 : 200);
  expect(rpc).toHaveBeenCalledTimes(id === null ? 0 : 1);
  expect(deps.invalidatePublicContent).toHaveBeenCalledTimes(id === null ? 0 : 1);
});
