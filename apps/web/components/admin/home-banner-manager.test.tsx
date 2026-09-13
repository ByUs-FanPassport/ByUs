import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeBannerManagerData } from "../../features/home/domain/home-banner";
import { HomeBannerManager } from "./home-banner-manager";

const auth = vi.hoisted(() => ({ getAccessToken: vi.fn(async () => "token") }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => auth }));
vi.mock("./operations-shell", () => ({ AdminOperationsShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const creatorId = "33333333-3333-4333-8333-333333333333";
const asset = (id: string, url = `/images/${id}.webp`) => ({ id, url, width: 1360, height: 680, mimeType: "image/webp", revision: 1 });
const koDesktop = asset("44444444-4444-4444-8444-444444444444");
const enDesktop = asset("55555555-5555-4555-8555-555555555555");

function item(id: string, title: string, revision = 1) {
  return {
    id, kind: "regular_live" as const, celebrityId: creatorId, publicationStatus: "draft" as const, sortOrder: id === firstId ? 0 : 1, revision,
    localizations: {
      ko: { title, description: "매주 금요일", ctaLabel: "방송 보기", href: "/live", alt: `${title} 정기 방송`, desktopImage: koDesktop, mobileImage: null },
      en: { title: `${title} LIVE`, description: "Every Friday", ctaLabel: "View LIVE", href: "/live", alt: `${title} regular LIVE`, desktopImage: enDesktop, mobileImage: null },
    },
  };
}
function fixture(): HomeBannerManagerData {
  return { items: [item(firstId, "카라"), item(secondId, "이퓨")], celebrities: [{ id: creatorId, slug: "kara", nameKo: "카라", nameEn: "Kara" }] };
}

describe("HomeBannerManager", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.stubGlobal("crypto", { randomUUID: () => "99999999-9999-4999-8999-999999999999" }); });

  it("keeps viewer access read-only while showing both locale assets", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(fixture())));
    render(<HomeBannerManager locale="ko" role="viewer" />);
    expect(await screen.findByText("Viewer 권한은 조회만 가능합니다.")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("카라").find((element) => element instanceof HTMLInputElement)).toBeDisabled();
    expect(screen.getByDisplayValue("카라 LIVE")).toBeDisabled();
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("blocks publication and names each missing localized field", async () => {
    const data = fixture();
    const fetcher = vi.fn(async () => Response.json(data));
    vi.stubGlobal("fetch", fetcher);
    render(<HomeBannerManager locale="ko" role="operator" />);
    await screen.findByDisplayValue("카라 LIVE");
    fireEvent.change(screen.getByRole("combobox", { name: "크리에이터" }), { target: { value: "" } });
    fireEvent.change(screen.getAllByRole("textbox", { name: "제목" })[0], { target: { value: "" } });
    fireEvent.change(screen.getAllByRole("textbox", { name: "이동 링크" })[1], { target: { value: "" } });
    fireEvent.click(within(screen.getAllByRole("region", { name: "데스크톱 이미지" })[0]).getByRole("button", { name: "이미지 제거" }));
    fireEvent.click(screen.getByRole("button", { name: "공개" }));
    expect(await screen.findByText("한국어 · 제목")).toBeInTheDocument();
    expect(screen.getByText("한국어 · 데스크톱 이미지")).toBeInTheDocument();
    expect(screen.getByText("English · 이동 링크")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uploads and removes locale-specific images and saves asset ids", async () => {
    const data = fixture();
    const uploaded = asset("66666666-6666-4666-8666-666666666666", "/images/mobile.webp");
    let finishUpload!: (response: Response) => void;
    const uploadResponse = new Promise<Response>((resolve) => { finishUpload = resolve; });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/admin/image-assets") return uploadResponse;
      if (init?.method === "POST") return Response.json({ ...data, items: [{ ...data.items[0], revision: 2 }, data.items[1]] });
      return Response.json(data);
    });
    vi.stubGlobal("fetch", fetcher);
    render(<HomeBannerManager locale="ko" role="operator" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    const mobileCards = screen.getAllByRole("region", { name: "모바일 이미지 (선택 · 없으면 데스크톱 이미지 사용)" });
    fireEvent.change(within(mobileCards[0]).getByLabelText("이미지 업로드"), { target: { files: [new File(["image"], "mobile.png", { type: "image/png" })] } });
    expect(screen.getByRole("button", { name: "새 배너" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "초안 저장" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /카라정기 방송비공개/ })).toBeDisabled();
    await act(async () => { finishUpload(Response.json({ asset: uploaded }, { status: 201 })); });
    await within(mobileCards[0]).findByRole("img");
    fireEvent.click(within(screen.getAllByRole("region", { name: "데스크톱 이미지" })[1]).getByRole("button", { name: "이미지 제거" }));
    fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    const saveCall = fetcher.mock.calls.find(([input, init]) => init?.method === "POST" && String(input) === "/api/admin/home-banners");
    const body = JSON.parse(String(saveCall?.[1]?.body));
    expect(body.localizations.ko.mobileAssetId).toBe(uploaded.id);
    expect(body.localizations.en.desktopAssetId).toBeNull();
  });

  it("saves current copy before publication and can unpublish the result", async () => {
    const data = fixture();
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return Response.json(data);
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      const revision = body.action === "save" ? 2 : body.publicationStatus === "published" ? 3 : 4;
      const publicationStatus = body.publicationStatus === "published" ? "published" : "draft";
      return Response.json({ ...data, items: [{ ...data.items[0], revision, publicationStatus }, data.items[1]] });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<HomeBannerManager locale="ko" role="operator" />);
    await screen.findByDisplayValue("카라 LIVE");
    fireEvent.change(screen.getAllByRole("textbox", { name: "제목" })[0], { target: { value: "새 정기 방송" } });
    fireEvent.click(screen.getByRole("button", { name: "공개" }));
    await screen.findByText("공개 상태를 변경했습니다.");
    expect(bodies.map((body) => body.action)).toEqual(["save", "publication"]);
    expect(bodies[0].localizations).toMatchObject({ ko: { title: "새 정기 방송" } });
    expect(bodies[1]).toMatchObject({ publicationStatus: "published", expectedRevision: 2 });
    fireEvent.click(screen.getByRole("button", { name: "비공개로 전환" }));
    await waitFor(() => expect(bodies).toHaveLength(3));
    expect(bodies[2]).toMatchObject({ action: "publication", publicationStatus: "draft", expectedRevision: 3 });
  });

  it("retains the saved revision and input when publication conflicts", async () => {
    const data = fixture();
    const bodies: Array<Record<string, unknown>> = [];
    let publicationAttempts = 0;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return Response.json(data);
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      if (body.action === "publication" && publicationAttempts++ === 0) return Response.json({ error: "REVISION_CONFLICT" }, { status: 409 });
      const revision = body.action === "save" ? bodies.filter((entry) => entry.action === "save").length + 1 : 4;
      const title = body.action === "save" ? ((body.localizations as { ko: { title: string } }).ko.title) : "충돌 뒤에도 보존";
      return Response.json({ ...data, items: [{ ...data.items[0], revision, publicationStatus: body.publicationStatus === "published" ? "published" : "draft", localizations: { ...data.items[0].localizations, ko: { ...data.items[0].localizations.ko, title } } }, data.items[1]] });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<HomeBannerManager locale="ko" role="operator" />);
    await screen.findByDisplayValue("카라 LIVE");
    fireEvent.change(screen.getAllByRole("textbox", { name: "제목" })[0], { target: { value: "충돌 뒤에도 보존" } });
    fireEvent.click(screen.getByRole("button", { name: "공개" }));
    expect(await screen.findByText(/현재 입력은 보존했습니다/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("충돌 뒤에도 보존")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "공개" }));
    await waitFor(() => expect(bodies).toHaveLength(4));
    expect(bodies[2]).toMatchObject({ action: "save", expectedRevision: 2 });
  });

  it("sends the full ordered revision set and preserves edits on a conflict", async () => {
    const data = fixture();
    let writes = 0;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return Response.json(data);
      writes += 1;
      if (writes === 1) return Response.json({ ...data, items: [item(secondId, "이퓨", 2), item(firstId, "카라", 2)] });
      return Response.json({ error: "REVISION_CONFLICT" }, { status: 409 });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<HomeBannerManager locale="ko" role="operator" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    const title = screen.getAllByDisplayValue("카라").find((element) => element instanceof HTMLInputElement)!;
    fireEvent.change(title, { target: { value: "정렬 중에도 보존" } });
    fireEvent.click(screen.getByRole("button", { name: "아래로" }));
    await screen.findByText("배너 순서를 변경했습니다.");
    const reorderBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(reorderBody).toEqual({ action: "reorder", items: [{ id: secondId, expectedRevision: 1 }, { id: firstId, expectedRevision: 1 }] });
    expect(screen.getByDisplayValue("정렬 중에도 보존")).toBeInTheDocument();
    fireEvent.change(title, { target: { value: "수정 중인 제목" } });
    fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
    expect(await screen.findByText(/현재 입력은 보존했습니다/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("수정 중인 제목")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "서버 데이터 다시 불러오기" })).toBeInTheDocument();
  });
});
