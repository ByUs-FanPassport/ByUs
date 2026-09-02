import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createGetMissionBuilderHandler, createPostMissionBuilderHandler } from "./mission-builder-route";

const id = "11111111-1111-4111-8111-111111111111";
const live = "22222222-2222-4222-8222-222222222222";
const base = {
  command: "create" as const,
  type: "vote" as const,
  attendanceRequirement: "not_required" as const,
  title: { ko: "투표", en: "Vote" },
  description: { ko: "", en: "" },
  visibleFrom: "2026-09-02T10:00:00.000Z",
  visibleUntil: "2026-09-02T11:00:00.000Z",
  questions: [{ position: 1, text: { ko: "질문", en: "Question" }, media: null, correctPosition: null, options: [
    { position: 1, label: { ko: "가", en: "A" }, media: null },
    { position: 2, label: { ko: "나", en: "B" }, media: null },
  ] }],
};
const deps = {
  authorize: vi.fn().mockResolvedValue({ appUserId: id, allowlistId: id, role: "admin" as const, email: "admin@example.com" }),
  repository: { write: vi.fn().mockResolvedValue({ missionId: id }), statistics: vi.fn() },
};

describe("Mission builder route", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("returns canonical Mission statistics to an authenticated viewer", async () => {
    const statistics = [{ missionId: id, totalParticipants: 2 }];
    deps.repository.statistics = vi.fn().mockResolvedValue(statistics);
    const response = await createGetMissionBuilderHandler(deps)(new Request("https://byus.test", { headers: { authorization: "Bearer token" } }), { liveEventId: live });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ missions: statistics });
    expect(deps.repository.statistics).toHaveBeenCalledWith({ actor: expect.objectContaining({ appUserId: id }), liveEventId: live });
  });
  it("rejects a missing visibility window before persistence", async () => {
    const { visibleFrom: _from, visibleUntil: _until, ...body } = base;
    const response = await createPostMissionBuilderHandler(deps)(new Request("https://byus.test", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }), { liveEventId: live });
    expect(response.status).toBe(422);
    expect(deps.repository.write).not.toHaveBeenCalled();
  });

  it("rejects a reversed visibility window", async () => {
    const response = await createPostMissionBuilderHandler(deps)(new Request("https://byus.test", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...base, visibleUntil: base.visibleFrom }),
    }), { liveEventId: live });
    expect(response.status).toBe(422);
    expect(deps.repository.write).not.toHaveBeenCalled();
  });

  it("accepts a complete draft update with a new visibility window", async () => {
    deps.repository.write = vi.fn().mockResolvedValue({ missionId: id });
    const response = await createPostMissionBuilderHandler(deps)(new Request("https://byus.test", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...base, command: "update", missionId: id }),
    }), { liveEventId: live });
    expect(response.status).toBe(200);
    expect(deps.repository.write).toHaveBeenCalledWith(expect.objectContaining({ command: expect.objectContaining({ command: "update", missionId: id }) }));
  });

  it("rejects an invalid question graph on draft update", async () => {
    const response = await createPostMissionBuilderHandler(deps)(new Request("https://byus.test", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        ...base, command: "update", missionId: id,
        questions: [{ ...base.questions[0], options: base.questions[0].options.map((option, index) => ({ ...option, position: index + 2 })) }],
      }),
    }), { liveEventId: live });
    expect(response.status).toBe(422);
    expect(deps.repository.write).not.toHaveBeenCalled();
  });
});
