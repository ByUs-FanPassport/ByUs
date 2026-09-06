import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CelebrityDirectory, directoryIntroduction } from "./celebrity-directory";

const publishedCelebrityFixtures = [
  { slug: "kara", locale: "ko", name: "KARA", summary: "KARA summary", image: { url: "/images/guest-home/kara-card.jpg", alt: "KARA portrait", position: "center" }, themes: [], socialLinks: [], displayOrder: 0, fanCount: 12_800_000, upcomingLive: { slug: "kara-live", celebritySlug: "kara", locale: "ko", title: "KARA LIVE", startsAt: "2026-07-24T11:00:00.000Z", effectiveStatus: "scheduled" } },
  { slug: "elina", locale: "ko", name: "Elina", summary: "Elina summary", image: { url: "/images/guest-home/elina-card.jpg", alt: "Elina portrait", position: "center" }, themes: [], socialLinks: [], displayOrder: 1, fanCount: 3_200_000, upcomingLive: null },
  { slug: "changha", locale: "ko", name: "Changha", summary: "Changha summary", image: { url: "/images/guest-home/changha-card.jpg", alt: "Changha portrait", position: "center" }, themes: [], socialLinks: [], displayOrder: 2, fanCount: 1_450_000, upcomingLive: null },
] as const;
const ownedPassport = {
  id: "11111111-1111-4111-8111-111111111111",
  owner: { nickname: "Jewel_KAT" },
  celebrity: {
    slug: "kara",
    name: "KARA",
    image: {
      url: "/images/guest-home/kara-card.jpg",
      alt: "KARA portrait",
      position: "center",
    },
  },
  businessStatus: "issued",
  mint: {
    status: "queued",
    txHash: null,
    tokenId: null,
  },
  issuedAt: "2026-07-26T00:00:00.000Z",
  score: {
    points: 1,
    level: "Bronze",
  },
  stampSummary: {
    knowledge: 1,
    reservation: 0,
    attendance: 0,
    survey: 0,
    total: 1,
  },
  display: {
    level: "브론즈",
    mintStatus: "발급 대기",
  },
} as const;

let authenticated = false;
let ownerId = "owner-a";
const getAccessToken = vi.fn();
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated, user: { id: ownerId }, getAccessToken }) }));

describe("published celebrity directory", () => {
  beforeEach(() => { authenticated = false; getAccessToken.mockReset(); vi.unstubAllGlobals(); });

  it("prioritizes editorial leads and exposes useful search and sort controls", () => {
    render(<CelebrityDirectory celebrities={publishedCelebrityFixtures} locale="ko" />);
    expect(screen.getAllByRole("link", { name: "ByUs 홈" })[0]).toHaveAttribute("href", "/?locale=ko");
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getAllByRole("article")[0]).toHaveTextContent("Changha");
    expect(screen.getByRole("link", { name: "KARA 만나보기" })).toHaveAttribute("href", "/c/kara?locale=ko");
    expect(screen.getByText("LIVE 예정")).toHaveAttribute("data-live-status", "scheduled");
    expect(screen.getByText(/7월 24일/)).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "이름으로 찾기" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "정렬" })).toHaveValue("published");
  });

  it("filters by name and teaches recovery from a zero-result filter", () => {
    render(<CelebrityDirectory celebrities={publishedCelebrityFixtures} locale="ko" />);
    fireEvent.change(screen.getByRole("searchbox", { name: "이름으로 찾기" }), { target: { value: "Elina" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Elina" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "이름으로 찾기" }), { target: { value: "없는 셀럽" } });
    expect(screen.getByRole("status")).toHaveTextContent("검색 결과가 없어요.");
    fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("sorts without mutating the published input order", () => {
    render(<CelebrityDirectory celebrities={publishedCelebrityFixtures} locale="ko" />);
    fireEvent.change(screen.getByRole("combobox", { name: "정렬" }), { target: { value: "name-asc" } });
    expect(screen.getAllByRole("article")[0]).toHaveTextContent("Changha");
    expect(publishedCelebrityFixtures[0]?.slug).toBe("kara");
  });

  it("uses the authenticated Passport projection for filtering and ownership badges", async () => {
    authenticated = true;
    getAccessToken.mockResolvedValue("token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ passports: [ownedPassport] }),
    }));
    render(<CelebrityDirectory celebrities={publishedCelebrityFixtures} locale="ko" />);
    await waitFor(() => expect(screen.getByText("패스포트 보유")).toBeInTheDocument());
    const filter = screen.getByRole("checkbox", { name: "내 패스포트만" });
    expect(filter).toBeEnabled();
    fireEvent.click(filter);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "KARA" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/passports?locale=ko", expect.objectContaining({ headers: { Authorization: "Bearer token" } }));
  });

  it("keeps the Passport filter unavailable when the API DTO is malformed", async () => {
    authenticated = true;
    getAccessToken.mockResolvedValue("token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        passports: [{ ...ownedPassport, display: undefined }],
      }),
    }));

    render(<CelebrityDirectory celebrities={publishedCelebrityFixtures} locale="ko" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("내 패스포트를 확인하지 못했어요.");
    expect(screen.getByRole("checkbox", { name: "내 패스포트만" })).toBeDisabled();
  });

  it("sends guests to login with the selected filter and search context", () => {
    render(<CelebrityDirectory celebrities={publishedCelebrityFixtures} locale="ko" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "KARA" } });
    const login = new URL(screen.getByRole("link", { name: "내 패스포트만" }).getAttribute("href")!, "https://byus.test");
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("returnTo")).toBe("/celebrities?locale=ko&owned=1&q=KARA&sort=published");
    expect(screen.getByText("내 패스포트만 보려면 로그인해 주세요.")).toBeInTheDocument();
  });

  it("teaches the user what happens next when no published rows exist", () => {
    render(<CelebrityDirectory celebrities={[]} locale="ko" />);
    expect(screen.getByRole("status")).toHaveTextContent("지금 공개된 셀럽이 없어요.");
    expect(screen.getByRole("link", { name: "LIVE 둘러보기" })).toHaveAttribute("href", "/?locale=ko");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("localizes directory controls and preserves English locale in navigation", () => {
    const english = publishedCelebrityFixtures.map((celebrity) => ({ ...celebrity, locale: "en" as const, upcomingLive: celebrity.upcomingLive ? { ...celebrity.upcomingLive, locale: "en" as const } : null }));
    render(<CelebrityDirectory celebrities={english} locale="en" />);
    expect(screen.getByRole("heading", { name: "Find your favorite" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search celebrities" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Meet KARA" })).toHaveAttribute("href", "/c/kara?locale=en");
  });
});

it("uses one whole-card link and complete introductory sentence", () => {
  render(<CelebrityDirectory celebrities={publishedCelebrityFixtures} locale="ko"/>);
  const link = screen.getByRole("link", { name:"KARA 만나보기" });
  expect(link.querySelector("img")).not.toBeNull();
  expect(link.querySelector("h2")).toHaveTextContent("KARA");
  expect(link.querySelector("a")).toBeNull();
  expect(directoryIntroduction("엘리나는 노래와 뷰티를 공유합니다. 함께한 순간을 기록하세요.", "ko")).toBe("엘리나는 노래와 뷰티를 공유합니다.");
  expect(directoryIntroduction("A complete introduction without punctuation", "en")).toBe("A complete introduction without punctuation");
});

it("keeps identical card treatment in default and sorted discovery", () => {
  const { container } = render(<CelebrityDirectory celebrities={publishedCelebrityFixtures} locale="ko" />);
  expect(container.querySelectorAll('[data-supporting="true"]')).toHaveLength(0);
  expect(new Set([...container.querySelectorAll("article")].map(a => a.className)).size).toBe(1);
  fireEvent.change(screen.getByRole("combobox", { name: "정렬" }), { target: { value: "name-asc" } });
  expect(container.querySelectorAll('[data-supporting="true"]')).toHaveLength(0);
});

 it("restores the owned filter after login once Passports load", async () => {
   authenticated = true;
   getAccessToken.mockResolvedValue("token");
   vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok:true,json:async()=>({passports:[ownedPassport]})}));
   render(<CelebrityDirectory celebrities={publishedCelebrityFixtures} locale="ko" initialOwnedOnly initialSort="name-asc" />);
   await waitFor(()=>expect(screen.getAllByRole("article")).toHaveLength(1));
   expect(screen.getByRole("checkbox",{name:"내 패스포트만"})).toBeChecked();
   expect(screen.getByRole("heading",{name:"KARA"})).toBeInTheDocument();
 });

 it("clears prior owner badges immediately and ignores late responses after switching accounts", async () => {
   authenticated = true; ownerId = "owner-a";
   getAccessToken.mockResolvedValue("token");
   let resolveOld!: (value: unknown) => void;
   const late = new Promise(resolve => { resolveOld = resolve; });
   const fetchMock = vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({passports:[ownedPassport]})})
     .mockResolvedValueOnce({ok:true,json:()=>late})
     .mockResolvedValue({ok:true,json:async()=>({passports:[]})});
   vi.stubGlobal("fetch",fetchMock);
   const view=render(<CelebrityDirectory celebrities={publishedCelebrityFixtures} locale="ko" />);
   await screen.findByText("패스포트 보유");
   fireEvent.focus(window);
   await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
   ownerId="owner-b";
   view.rerender(<CelebrityDirectory celebrities={publishedCelebrityFixtures} locale="ko" />);
   expect(screen.queryByText("패스포트 보유")).not.toBeInTheDocument();
   await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(3));
   await act(async()=>resolveOld({passports:[ownedPassport]}));
   expect(screen.queryByText("패스포트 보유")).not.toBeInTheDocument();
 });
