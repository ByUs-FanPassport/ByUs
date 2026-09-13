import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHomeBannerManagerRepository } from "./home-banner-manager-repository";

const actor = { appUserId: "11111111-1111-4111-8111-111111111111", allowlistId: "22222222-2222-4222-8222-222222222222", email: "admin@test", role: "admin" as const };
const localization = { title: "", description: "", ctaLabel: "", href: "", alt: "", desktopAssetId: null, mobileAssetId: null };
describe("home banner manager repository", () => {
  it("maps save and revision fields to the atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: "x", revision: 1 }, error: null });
    const repo = createHomeBannerManagerRepository({ url: "http://local", serviceRoleKey: "key" }, { rpc } as never);
    await repo.command(actor, "33333333-3333-4333-8333-333333333333", { action: "save", id: null, expectedRevision: 0, kind: "announcement", celebrityId: null, localizations: { ko: localization, en: localization } });
    expect(rpc).toHaveBeenCalledWith("save_admin_home_banner", expect.objectContaining({ p_expected_revision: 0, p_localizations: { ko: localization, en: localization } }));
  });
  it("sends the complete revision list to reorder", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { updated: 1 }, error: null });
    const repo = createHomeBannerManagerRepository({ url: "http://local", serviceRoleKey: "key" }, { rpc } as never);
    const items = [{ id: "44444444-4444-4444-8444-444444444444", expectedRevision: 3 }];
    await repo.command(actor, "33333333-3333-4333-8333-333333333333", { action: "reorder", items });
    expect(rpc).toHaveBeenCalledWith("reorder_admin_home_banners", expect.objectContaining({ p_items: items }));
  });
});
