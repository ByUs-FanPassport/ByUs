import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ find: vi.fn(), read: vi.fn() }));
vi.mock("@/server/content/published-content-repository", () => ({ createPublishedContentRepositoryFromEnvironment: () => ({ findBySlug: state.find }) }));
vi.mock("@/server/youtube/youtube-uploads", () => ({ readYouTubeUploads: state.read }));
import { GET } from "./route";
const request = new Request("https://byus.kr/api/celebrities/elina/youtube");
beforeEach(() => { state.find.mockReset(); state.read.mockReset(); });
it("rechecks publication before serving cached public uploads", async () => {
  state.find.mockResolvedValue(null);
  expect((await GET(request, { params: Promise.resolve({ slug: "elina" }) })).status).toBe(404);
  expect(state.read).not.toHaveBeenCalled();
  state.find.mockResolvedValue({ socialLinks: [{ platform: "youtube", url: "https://youtube.com/@ElinaKarimova" }] });
  state.read.mockResolvedValue([]);
  expect(await (await GET(request, { params: Promise.resolve({ slug: "elina" }) })).json()).toEqual({ items: [], nextCursor: null });
  expect(state.read).toHaveBeenCalledWith("https://youtube.com/@ElinaKarimova");
  state.read.mockResolvedValue(null);
  expect((await GET(request, { params: Promise.resolve({ slug: "elina" }) })).status).toBe(503);
});
