import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  ready: true,
  authenticated: true,
  user: { id: "did:privy:fan-one" },
  getAccessToken: vi.fn(async () => "token"),
}));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => auth }));
import { CertificationPanel } from "./certification-panel";
const id = "22222222-2222-4222-8222-222222222222";
describe("CertificationPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    auth.getAccessToken.mockResolvedValue("token");
    auth.ready = true;
    auth.authenticated = true;
  });
  it("renders the public kind union and loads private history only after the history tab is selected", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("/api/me/"))
          return Response.json({
            certifications: [
              {
                id,
                kind: "manual",
                missionId: id,
                title: "콘서트 인증",
                status: "rejected",
                attemptNumber: 1,
                rejectionReason: "티켓 날짜가 보이도록 다시 촬영해 주세요.",
                submittedAt: "2026-09-08T00:00:00.000Z",
                reviewedAt: "2026-09-08T01:00:00.000Z",
                actionHref: `/c/kara/certifications/${id}?locale=ko`,
              },
            ],
          });
        return Response.json({
          certifications: [
            {
              id,
              kind: "manual",
              category: "공연",
              title: "콘서트 인증",
              description: "현장 사진을 제출하세요.",
              status: "available",
              reward: { scorePoints: 2, ticketAmount: 1 },
              actionHref: `/c/kara/certifications/${id}?locale=ko`,
            },
          ],
        });
      });
    render(<CertificationPanel slug="kara" locale="ko" />);
    const mission = await screen.findByRole("link", { name: /콘서트 인증/ });
    expect(mission).toHaveTextContent("+2점");
    expect(mission).toHaveTextContent("+1 응모권");
    fireEvent.click(screen.getByRole("tab", { name: "내 인증 내역" }));
    expect(
      await screen.findByText("티켓 날짜가 보이도록 다시 촬영해 주세요."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /콘서트 인증/ })).toHaveAttribute(
      "href",
      `/c/kara/certifications/${id}?locale=ko&submission=${id}`,
    );
    await waitFor(() => expect(auth.getAccessToken).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/me/"),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("shows the membership platform and Stamp while omitting a zero ticket reward", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/api/me/"))
        return Response.json({
          certifications: [
            {
              id,
              kind: "manual",
              missionId: id,
              title: "Instagram 유료 멤버십 인증",
              status: "rejected",
              attemptNumber: 1,
              rejectionReason: "계정명이 보이게 제출해 주세요.",
              submittedAt: "2026-09-08T00:00:00.000Z",
              reviewedAt: "2026-09-08T01:00:00.000Z",
              actionHref: `/c/kara/certifications/${id}?locale=ko`,
              membershipPlatform: "instagram",
            },
          ],
        });
      return Response.json({
        certifications: [
          {
            id,
            kind: "manual",
            category: "유료 멤버십",
            title: "Instagram 유료 멤버십 인증",
            description: "현재 유료 멤버십 상태를 인증해 주세요.",
            status: "available",
            reward: { scorePoints: 1, ticketAmount: 0, stampCount: 1 },
            actionHref: `/c/kara/certifications/${id}?locale=ko`,
            membershipPlatform: "instagram",
          },
        ],
      });
    });
    render(<CertificationPanel slug="kara" locale="ko" />);

    const mission = await screen.findByRole("link", {
      name: /Instagram 유료 멤버십 인증/,
    });
    expect(mission).toHaveTextContent("Instagram");
    expect(mission).toHaveTextContent("+1점");
    expect(mission).toHaveTextContent("멤버십 Stamp 1개");
    expect(mission).not.toHaveTextContent("응모권");

    fireEvent.click(screen.getByRole("tab", { name: "내 인증 내역" }));
    expect(await screen.findByText("보완 필요")).toBeInTheDocument();
  });
  it("filters certifications without making preparing or closed items actionable", async () => {
    const base = {
      kind: "manual",
      category: "공연",
      description: "사진을 제출하세요.",
      reward: null,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        certifications: [
          {
            ...base,
            id,
            title: "참여 인증",
            status: "available",
            actionHref: "/c/kara/certifications/one?locale=ko",
          },
          {
            ...base,
            id: "33333333-3333-4333-8333-333333333333",
            title: "예정 인증",
            status: "preparing",
            actionHref: "/preparing",
          },
          {
            ...base,
            id: "44444444-4444-4444-8444-444444444444",
            title: "지난 인증",
            status: "closed",
            actionHref: "/closed",
          },
          {
            ...base,
            id: "55555555-5555-4555-8555-555555555555",
            kind: "quiz",
            category: "팬 인증",
            title: "팬 퀴즈",
            status: "available",
            actionHref: "/c/kara/verify?locale=ko",
          },
        ],
      }),
    );
    render(<CertificationPanel slug="kara" locale="ko" />);
    expect(
      await screen.findByRole("link", { name: /참여 인증/ }),
    ).toHaveAttribute("href", "/c/kara/certifications/one?locale=ko");
    expect(screen.getByText("준비 중")).toBeInTheDocument();
    expect(screen.getByText("종료")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /예정 인증|지난 인증/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "팬 인증" }));
    expect(screen.getByRole("link", { name: /팬 퀴즈/ })).toHaveTextContent(
      "퀴즈 풀기",
    );
    expect(screen.queryByText("참여 인증")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "전체" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("supports keyboard tabs and keeps signed-out history private", async () => {
    auth.authenticated = false;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ certifications: [] }));
    render(<CertificationPanel slug="kara" locale="en" />);
    await screen.findByText("No verification missions are available.");
    const missions = screen.getByRole("tab", {
      name: "Available verification missions",
    });
    missions.focus();
    fireEvent.keyDown(missions, { key: "ArrowRight" });
    const history = screen.getByRole("tab", { name: "My history" });
    expect(history).toHaveFocus();
    expect(history).toHaveAttribute("aria-selected", "true");
    expect(
      await screen.findByText("Sign in to see your submission history."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tabpanel", { name: "My history" }),
    ).toHaveAttribute("id", history.getAttribute("aria-controls"));
    expect(
      fetchMock.mock.calls.every(([url]) => !String(url).includes("/api/me/")),
    ).toBe(true);
    fireEvent.keyDown(history, { key: "Home" });
    expect(missions).toHaveFocus();
    expect(missions).toHaveAttribute("aria-selected", "true");
  });

  it("offers retry after a load error and renders the empty result", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ certifications: [] }));
    render(<CertificationPanel slug="kara" locale="ko" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "인증을 불러오지 못했어요.",
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(
      await screen.findByText("현재 참여할 수 있는 인증이 없어요."),
    ).toBeInTheDocument();
  });

  it("falls back to all when a locale change removes the selected category", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      Response.json({
        certifications: [
          {
            id,
            kind: "manual",
            category: String(url).includes("locale=en")
              ? "Membership"
              : "멤버십",
            title: "Instagram",
            description: "Membership verification",
            status: "available",
            reward: null,
            actionHref: "/membership",
          },
        ],
      }),
    );
    const { rerender } = render(<CertificationPanel slug="kara" locale="ko" />);
    fireEvent.click(await screen.findByRole("button", { name: "멤버십" }));
    rerender(<CertificationPanel slug="kara" locale="en" />);
    expect(
      await screen.findByRole("button", { name: "Membership" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("link", { name: /Instagram/ })).toBeInTheDocument();
  });
});
