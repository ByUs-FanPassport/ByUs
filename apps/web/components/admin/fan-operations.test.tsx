import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAccessToken } = vi.hoisted(() => ({
  getAccessToken: vi.fn(async () => "token"),
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ getAccessToken }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/fans",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./use-admin-session", () => ({
  useAdminSession: () => ({ status: "authorized", admin: { role: "viewer" } }),
}));

import { FanOperations } from "./fan-operations";

describe("FanOperations", () => {
  beforeEach(() => {
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
          ],
        }),
      }),
    );
  });
  it("renders privacy-minimal fan rows with no email column", async () => {
    render(<FanOperations />);
    await waitFor(() =>
      expect(screen.getByText("Kamilia")).toBeInTheDocument(),
    );
    expect(screen.getByText("0x1234…abcd")).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: /email|이메일/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "팬 운영" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
  it("moves focus into the dialog, closes with Escape, and restores the row trigger", async () => {
    render(<FanOperations />);
    await waitFor(() =>
      expect(screen.getByText("Kamilia")).toBeInTheDocument(),
    );
    const trigger = screen.getByRole("button", { name: "팬 상세: Kamilia" });
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
});
