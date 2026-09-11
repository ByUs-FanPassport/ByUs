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
    expect(
      await screen.findByRole("link", { name: /콘서트 인증/ }),
    ).toHaveTextContent("+2점 · +1 응모권");
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
      if (String(input).includes("/api/me/")) return Response.json({ certifications: [{
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
      }] });
      return Response.json({ certifications: [{
        id,
        kind: "manual",
        category: "유료 멤버십",
        title: "Instagram 유료 멤버십 인증",
        description: "현재 유료 멤버십 상태를 인증해 주세요.",
        status: "available",
        reward: { scorePoints: 1, ticketAmount: 0, stampCount: 1 },
        actionHref: `/c/kara/certifications/${id}?locale=ko`,
        membershipPlatform: "instagram",
      }] });
    });
    render(<CertificationPanel slug="kara" locale="ko" />);

    const mission = await screen.findByRole("link", { name: /Instagram 유료 멤버십 인증/ });
    expect(mission).toHaveTextContent("Instagram");
    expect(mission).toHaveTextContent("+1점 · 멤버십 Stamp 1개");
    expect(mission).not.toHaveTextContent("응모권");

    fireEvent.click(screen.getByRole("tab", { name: "내 인증 내역" }));
    expect(await screen.findByText("보완 필요")).toBeInTheDocument();
  });
});
