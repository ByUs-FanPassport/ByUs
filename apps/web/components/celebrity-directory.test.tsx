import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CelebrityDirectory } from "./celebrity-directory";

const publishedCelebrityFixtures = [
  { slug: "kara", locale: "ko", name: "KARA", summary: "KARA summary", image: { url: "/images/guest-home/kara-card.jpg", alt: "KARA portrait", position: "center" }, themes: [], socialLinks: [], displayOrder: 0, fanCount: 12_800_000, upcomingLive: { slug: "kara-live", celebritySlug: "kara", locale: "ko", title: "KARA LIVE", startsAt: "2026-07-24T11:00:00.000Z", effectiveStatus: "scheduled" } },
  { slug: "elina", locale: "ko", name: "Elina", summary: "Elina summary", image: { url: "/images/guest-home/elina-card.jpg", alt: "Elina portrait", position: "center" }, themes: [], socialLinks: [], displayOrder: 1, fanCount: 3_200_000, upcomingLive: null },
  { slug: "changha", locale: "ko", name: "Changha", summary: "Changha summary", image: { url: "/images/guest-home/changha-card.jpg", alt: "Changha portrait", position: "center" }, themes: [], socialLinks: [], displayOrder: 2, fanCount: 1_450_000, upcomingLive: null },
] as const;

let authenticated = false;
const getAccessToken = vi.fn();
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated, getAccessToken }) }));

describe("published celebrity directory", () => {
  beforeEach(() => { authenticated = false; getAccessToken.mockReset(); vi.unstubAllGlobals(); });

  it("preserves published order and exposes useful search and sort controls", () => {
    render(<CelebrityDirectory celebrities={publishedCelebrityFixtures} locale="ko" />);
    expect(screen.getByRole("link", { name: "ByUs 홈" })).toHaveAttribute("href", "/?locale=ko");
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getAllByRole("article")[0]).toHaveTextContent("KARA");
    expect(screen.getByRole("link", { name: "KARA 팬페이지 보기" })).toHaveAttribute("href", "/c/kara?locale=ko");
    expect(screen.getByText(/7월 24일.*LIVE 예정/)).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "셀럽 검색" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "정렬" })).toHaveValue("published");
  });

  it("filters by name and teaches recovery from a zero-result filter", () => {
    render(<CelebrityDirectory celebrities={publishedCelebrityFixtures} locale="ko" />);
    fireEvent.change(screen.getByRole("searchbox", { name: "셀럽 검색" }), { target: { value: "Elina" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Elina" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "셀럽 검색" }), { target: { value: "없는 셀럽" } });
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ passports: [{ id: "passport-1", celebrity: { slug: "kara" } }] }) }));
    render(<CelebrityDirectory celebrities={publishedCelebrityFixtures} locale="ko" />);
    await waitFor(() => expect(screen.getByText("Passport 보유")).toBeInTheDocument());
    const filter = screen.getByRole("checkbox", { name: "내 Passport만" });
    expect(filter).toBeEnabled();
    fireEvent.click(filter);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "KARA" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/passports?locale=ko", expect.objectContaining({ headers: { Authorization: "Bearer token" } }));
  });

  it("keeps the Passport filter unavailable for guests with an explanation", () => {
    render(<CelebrityDirectory celebrities={publishedCelebrityFixtures} locale="ko" />);
    expect(screen.getByRole("checkbox", { name: "내 Passport만" })).toBeDisabled();
    expect(screen.getByText("Passport 보유 필터는 로그인 후 사용할 수 있어요.")).toBeInTheDocument();
  });

  it("teaches the user what happens next when no published rows exist", () => {
    render(<CelebrityDirectory celebrities={[]} locale="ko" />);
    expect(screen.getByRole("status")).toHaveTextContent("지금 공개된 셀럽이 없어요.");
    expect(screen.getByRole("link", { name: "오늘의 LIVE로 돌아가기" })).toHaveAttribute("href", "/?locale=ko");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("localizes directory controls and preserves English locale in navigation", () => {
    const english = publishedCelebrityFixtures.map((celebrity) => ({ ...celebrity, locale: "en" as const, upcomingLive: celebrity.upcomingLive ? { ...celebrity.upcomingLive, locale: "en" as const } : null }));
    render(<CelebrityDirectory celebrities={english} locale="en" />);
    expect(screen.getByRole("heading", { name: "Find your favorite" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search celebrities" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "KARA fan page" })).toHaveAttribute("href", "/c/kara?locale=en");
  });
});
