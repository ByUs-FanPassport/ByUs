import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAccessToken, roleState, searchParamsState } = vi.hoisted(() => ({
  getAccessToken: vi.fn(async () => "token"),
  roleState: { current: "viewer" },
  searchParamsState: { current: "" },
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ getAccessToken }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/fans",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(searchParamsState.current),
}));
vi.mock("./use-admin-session", () => ({
  useAdminSession: () => ({
    status: "authorized",
    admin: { role: roleState.current },
  }),
}));

import { FanOperations } from "./fan-operations";

describe("FanOperations", () => {
  beforeEach(() => {
    roleState.current = "viewer";
    searchParamsState.current = "";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              fanId: "11111111-1111-4111-8111-111111111111",
              nickname: "Kamilia",
              accountStatus: "active",
              maskedWallet: "0x1234…abcd",
              createdAt: "2026-09-11T01:00:00Z",
              celebritySummaries: [
                {
                  passportId: "p",
                  celebrity: { id: "c", name: "KARA", archived: false },
                  score: { points: 5, level: "Silver" },
                  activityCounts: {
                    knowledge: 1,
                    reservation: 1,
                    attendance: 1,
                    survey: 0,
                  },
                  passportMintStatus: "minted",
                  benefitSummary: { claims: 1, applications: 0 },
                },
              ],
            },
            {
              fanId: "22222222-2222-4222-8222-222222222222",
              nickname: "Alpha",
              accountStatus: "disabled",
              maskedWallet: null,
              createdAt: "2026-09-10T01:00:00Z",
              celebritySummaries: [
                {
                  passportId: "p2",
                  celebrity: { id: "c", name: "KARA", archived: false },
                  score: { points: 20, level: "Gold" },
                  activityCounts: {
                    knowledge: 2,
                    reservation: 2,
                    attendance: 2,
                    survey: 2,
                  },
                  passportMintStatus: "minted",
                  benefitSummary: { claims: 0, applications: 0 },
                },
              ],
            },
          ],
          nextCursor: {
            createdAt: "2026-09-10T01:00:00Z",
            id: "22222222-2222-4222-8222-222222222222",
          },
        }),
      }),
    );
  });
  it("renders privacy-minimal fan rows with no email column", async () => {
    render(<FanOperations />);
    await waitFor(() =>
      expect(screen.getByText("Kamilia")).toBeInTheDocument(),
    );
    const row = screen.getByText("Kamilia").closest("tr");
    expect(row).toHaveTextContent("이용 가능 · 0x1234…abcd");
    expect(screen.getByRole("heading", { name: "회원 관리" })).toBeInTheDocument();
    expect(screen.getByText("현재 불러온 2명")).toBeInTheDocument();
    expect(
      screen.getByText("다음 결과를 불러올 수 있습니다."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("개인정보 조회 기준").closest("details"),
    ).not.toHaveAttribute("open");
    expect(
      screen.getByRole("columnheader", { name: "패스포트 여정" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "팬 점수" }),
    ).toBeInTheDocument();
    const loadMore = screen.getByRole("button", { name: "다음 회원 불러오기" });
    expect(loadMore).toBeEnabled();
    const sort = screen.getByRole("combobox", { name: "현재 목록 정렬" });
    expect(sort).toHaveValue("recent");
    fireEvent.change(sort, { target: { value: "score" } });
    const dataRows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("Alpha");
    expect(dataRows[1]).toHaveTextContent("Kamilia");
    fireEvent.click(loadMore);
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
        expect.stringContaining(
          "cursorId=22222222-2222-4222-8222-222222222222",
        ),
        expect.any(Object),
      ),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).getAllByRole("row").slice(1),
      ).toHaveLength(2),
    );
    expect(
      screen.queryByRole("columnheader", { name: /email|이메일/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("link").find((link) => link.getAttribute("aria-current") === "page"),
    ).toHaveAttribute("href", "/admin/fans");
  });
  it("moves focus into the dialog, closes with Escape, and restores the row trigger", async () => {
    render(<FanOperations />);
    await waitFor(() =>
      expect(screen.getByText("Kamilia")).toBeInTheDocument(),
    );
    const trigger = screen.getByRole("button", { name: "회원 상세: Kamilia" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "상세 닫기" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("enables score correction only after every audited input is valid", async () => {
    roleState.current = "admin";
    const listResponse = {
      items: [
        {
          fanId: "11111111-1111-4111-8111-111111111111",
          nickname: "Kamilia",
          accountStatus: "active",
          maskedWallet: "0x1234…abcd",
          celebritySummaries: [],
        },
      ],
      nextCursor: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return {
          ok: true,
          json: async () =>
            url.includes("/api/admin/fans/11111111")
              ? {
                  fan: {
                    fanId: "11111111-1111-4111-8111-111111111111",
                    nickname: "Kamilia",
                    accountStatus: "active",
                    wallets: [],
                    passports: [
                      {
                        id: "passport-1",
                        celebrity: { id: "celebrity-1", name: "KARA", archived: false },
                        mintStatus: "minted",
                        score: { points: 5 },
                        activities: [],
                        scoreLedger: [],
                        stamps: [],
                        benefitClaims: [],
                        benefitApplications: [],
                        correctionAllowed: true,
                      },
                    ],
                  },
                }
              : listResponse,
        };
      }),
    );
    render(<FanOperations />);
    fireEvent.click(
      await screen.findByRole("button", { name: "회원 상세: Kamilia" }),
    );
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "교정 기록" });
    expect(within(dialog).getByText("패스포트 NFT")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", { name: "스탬프" }),
    ).toBeInTheDocument();
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "조정값 (-100~100)" }), {
      target: { value: "10" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "교정 사유" }), {
      target: { value: "운영 요청에 따른 점수 교정" },
    });
    expect(submit).toBeDisabled();
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /불변 원장과 감사 로그/ }),
    );
    expect(submit).toBeEnabled();
  });
  it("ignores a stale list response after the account filter changes", async () => {
    const pending: Array<{
      url: string;
      resolve: (value: { ok: true; json: () => Promise<unknown> }) => void;
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (input: RequestInfo | URL) =>
          new Promise((resolve) =>
            pending.push({
              url: String(input),
              resolve: resolve as (value: {
                ok: true;
                json: () => Promise<unknown>;
              }) => void,
            }),
          ),
      ),
    );
    const { rerender } = render(<FanOperations />);
    await waitFor(() => expect(pending).toHaveLength(1));
    searchParamsState.current = "status=disabled";
    rerender(<FanOperations />);
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].url).toContain("status=disabled");
    pending[1].resolve({
      ok: true,
      json: async () => ({
        items: [
          {
            fanId: "22222222-2222-4222-8222-222222222222",
            nickname: "Current disabled member",
            accountStatus: "disabled",
            maskedWallet: null,
            celebritySummaries: [],
          },
        ],
        nextCursor: null,
      }),
    });
    expect(await screen.findByText("Current disabled member")).toBeInTheDocument();
    pending[0].resolve({
      ok: true,
      json: async () => ({
        items: [
          {
            fanId: "11111111-1111-4111-8111-111111111111",
            nickname: "Stale enabled member",
            accountStatus: "active",
            maskedWallet: null,
            celebritySummaries: [],
          },
        ],
        nextCursor: null,
      }),
    });
    await waitFor(() =>
      expect(screen.queryByText("Stale enabled member")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Current disabled member")).toBeInTheDocument();
  });
  it("keeps an exact email query out of the rendered results summary", async () => {
    const email = "fan@example.com";
    searchParamsState.current = `q=${encodeURIComponent(email)}`;
    render(<FanOperations />);
    await screen.findByText("Kamilia");
    expect(
      screen.getByRole("textbox", { name: "닉네임 또는 정확한 이메일" }),
    ).toHaveValue(email);
    expect(screen.getByText(/적용된 조건:/)).toHaveTextContent(
      "이메일 검색 적용",
    );
    expect(document.body).not.toHaveTextContent(email);
  });
});
