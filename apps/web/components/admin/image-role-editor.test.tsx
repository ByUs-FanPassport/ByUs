import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageRoleEditor } from "./image-role-editor";

const ownerId = "33333333-3333-4333-8333-333333333333";
const asset = { id: "44444444-4444-4444-8444-444444444444", url: "/landscape.jpg", width: 1600, height: 900, mimeType: "image/jpeg", revision: 1 };
const getAccessToken = vi.fn().mockResolvedValue("local-token");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  getAccessToken.mockClear();
});

describe("ImageRoleEditor", () => {
  it("imports an asset and applies approved per-slot framing from revision zero", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/admin/image-roles?") && (!init?.method || init.method === "GET"))
        return { ok: true, status: 200, json: async () => ({ items: [] }) } as Response;
      if (url === "/api/admin/image-assets")
        return { ok: true, status: 200, json: async () => ({ asset }) } as Response;
      if (url === "/api/admin/image-roles") {
        const body = JSON.parse(String(init?.body));
        return { ok: true, status: 200, json: async () => ({ item: { role: body.role, revision: 1, binding: { asset, alt: body.binding.alt, frames: body.binding.frames, revision: 1 } } }) } as Response;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ImageRoleEditor ownerType="celebrity" ownerId={ownerId} locale="ko" canEdit getAccessToken={getAccessToken} />);

    const landscape = (await screen.findByRole("heading", { name: "가로" })).closest("article")!;
    fireEvent.change(within(landscape).getByRole("textbox", { name: "이미지 URL" }), { target: { value: "https://images.example/landscape.jpg" } });
    fireEvent.click(within(landscape).getByRole("button", { name: /URL 가져오기/ }));
    await waitFor(() => expect(landscape.querySelectorAll("img").length).toBeGreaterThan(0));
    expect(landscape.querySelector('input[type="file"]')).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(within(landscape).getAllByRole("option", { name: "전체 보기" })).toHaveLength(2);
    const previews = Array.from(landscape.querySelectorAll<HTMLElement>("[style*='aspect-ratio']"));
    expect(previews).toHaveLength(2);
    expect(previews[0].style.maxWidth).toBe(`${320 * 940 / 360}px`);

    fireEvent.change(within(landscape).getByRole("textbox", { name: "한국어 대체 텍스트" }), { target: { value: "무대 위 셀럽" } });
    fireEvent.change(within(landscape).getByRole("textbox", { name: "English alt text" }), { target: { value: "Celebrity on stage" } });
    for (const select of within(landscape).getAllByRole("combobox", { name: "맞춤 방식" })) fireEvent.change(select, { target: { value: "cover" } });
    for (const checkbox of within(landscape).getAllByRole("checkbox", { name: "이 원본과 위치로 크롭 승인" })) fireEvent.click(checkbox);
    fireEvent.click(within(landscape).getByRole("button", { name: /이 역할 적용/ }));

    await waitFor(() => expect(screen.getByText("이미지 역할을 적용했습니다.")).toBeInTheDocument());
    expect(within(landscape).getByText("설정 버전 1")).toBeInTheDocument();
    const applyCall = fetchMock.mock.calls.find(([url, init]) => String(url) === "/api/admin/image-roles" && init?.method === "POST")!;
    const payload = JSON.parse(String(applyCall[1]?.body));
    expect(payload).toMatchObject({ ownerType: "celebrity", ownerId, role: "landscape", expectedRevision: 0 });
    expect(payload.binding.assetId).toBe(asset.id);
    expect(payload.binding).not.toHaveProperty("asset");
    expect(payload.binding.alt).toEqual({ ko: "무대 위 셀럽", en: "Celebrity on stage" });
    expect(Object.values(payload.binding.frames)).toHaveLength(2);
    expect(Object.values(payload.binding.frames)).toEqual(expect.arrayContaining([
      expect.objectContaining({ fit: "cover", approvedAssetRevision: 1 }),
    ]));
    expect((applyCall[1]?.headers as Headers).get("authorization")).toBe("Bearer local-token");
  });

  it("reloads current records on a 409 conflict without showing a false success", async () => {
    const binding = { asset, alt: { ko: "가로 이미지", en: "Landscape image" }, frames: {}, revision: 2 };
    let getCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("/api/admin/image-roles?") && (!init?.method || init.method === "GET")) {
        getCount += 1;
        return { ok: true, status: 200, json: async () => ({ items: [{ role: "landscape", revision: getCount === 1 ? 2 : 3, binding: { ...binding, revision: getCount === 1 ? 2 : 3 } }] }) } as Response;
      }
      return { ok: false, status: 409, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ImageRoleEditor ownerType="celebrity" ownerId={ownerId} locale="ko" canEdit getAccessToken={getAccessToken} />);

    const landscape = (await screen.findByRole("heading", { name: "가로" })).closest("article")!;
    fireEvent.click(within(landscape).getByRole("button", { name: /이 역할 적용/ }));
    await waitFor(() => expect(screen.getByText("다른 관리자가 먼저 변경했습니다. 최신 값을 다시 불러왔습니다.")).toBeInTheDocument());
    expect(getCount).toBe(2);
    expect(screen.queryByText("이미지 역할을 적용했습니다.")).not.toBeInTheDocument();
    expect(within(landscape).getByText("설정 버전 3")).toBeInTheDocument();
  });

  it("keeps every image-role control read-only for viewers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [] }) }));
    render(<ImageRoleEditor ownerType="live" ownerId={ownerId} locale="ko" canEdit={false} getAccessToken={getAccessToken} />);
    await screen.findByText("Viewer 권한은 현재 설정만 볼 수 있습니다.");
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    for (const input of screen.getAllByRole("textbox")) expect(input).toBeDisabled();
  });
});
