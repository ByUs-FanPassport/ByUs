import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FanActivityPanel } from "./fan-activity-panel";
const getAccessToken = vi.fn(async (): Promise<string | null> => "token");
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true, user: { id: "owner-a" }, getAccessToken }) }));
const summary = { membershipCount: 1, leaderboardAvailable: false, activity: [{ kind: "joined", tier: null, nickname: "별이", avatarUrl: "/images/avatars/star-cream.webp", occurredAt: "2026-09-10T10:00:00Z" }] };
beforeEach(() => { getAccessToken.mockReset().mockResolvedValue("token"); vi.unstubAllGlobals(); });
it.each(["ko", "en"] as const)("shows public activity without reading or offering visibility settings in %s", async locale => {
  const fetcher = vi.fn(async () => Response.json(summary)); vi.stubGlobal("fetch", fetcher);
  render(<FanActivityPanel slug="ifewknow" locale={locale} />);
  expect(await screen.findByText("별이")).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(fetcher.mock.calls.every(call => !String((call as unknown[])[0]).includes("visibility"))).toBe(true);
  expect(screen.queryByText(/증빙|Evidence|공개 설정|Share when/)).not.toBeInTheDocument();
});
