import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { APP_LOCALES } from "@/i18n/locales";
import { leaderboardActivityCopy } from "@/i18n/catalogs/features__fanpage__ui__leaderboard-activities";
import { LeaderboardPanel } from "./leaderboard-panel";

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: false, getAccessToken: async () => null }) }));
vi.mock("./fan-gathering", () => ({ FanGatheringPanel: () => <div data-testid="gathering" /> }));
const rows = ["별빛팬", "봄날", "달빛"].map((nickname, index) => ({ rank: index + 1, nickname, avatarUrl: "/images/avatars/star-pink.webp", points: 7 }));
const data = { membershipCount: 100, fanCount: 110, available: true, asOf: "2026-10-09T00:00:00Z", rows, me: rows[1] };
beforeEach(() => vi.unstubAllGlobals());

it("shows the ranking without gathering and keeps all three medal names accessible", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(data)));
  const { container } = render(<LeaderboardPanel slug="elina" locale="ko" />);
  const table = await screen.findByRole("table");
  expect(screen.queryByTestId("gathering")).not.toBeInTheDocument();
  for (const medal of ["금메달", "은메달", "동메달"]) expect(within(table).getByText(medal)).toBeInTheDocument();
  expect(container.querySelectorAll('[data-medal]')).toHaveLength(3);
  expect(within(table).getAllByRole("row")).toHaveLength(4);
});

it("uses server-ranked category results and keeps the filter focused through loading", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(async (url: string) => url.includes("category=mission") ? new Promise<Response>(done => { resolve = done; }) : Response.json(data));
  vi.stubGlobal("fetch", fetcher);
  render(<LeaderboardPanel slug="elina" locale="ko" />);
  await screen.findByRole("table");
  const filter = screen.getByRole("button", { name: "미션", exact: true });
  filter.focus(); fireEvent.click(filter);
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("category=mission"), expect.anything()));
  expect(filter).toHaveFocus(); expect(filter).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  await act(async () => resolve(Response.json({ ...data, rows: [{ ...rows[2], rank: 1, points: 2 }], me: null })));
  const table = await screen.findByRole("table");
  expect(within(table).getByText("달빛")).toBeInTheDocument();
  expect(within(table).queryByText("별빛팬")).not.toBeInTheDocument();
  expect(filter).toHaveFocus();
});

it("shows gathering only below the threshold and respects callers that omit it", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "LEADERBOARD_NOT_AVAILABLE" }, fanCount: 99 }, { status: 403 })));
  const view = render(<LeaderboardPanel slug="elina" locale="ko" />);
  await screen.findByTestId("gathering");
  expect(screen.getByText("현재 99명 / 100명")).toBeInTheDocument();
  view.rerender(<LeaderboardPanel slug="elina" locale="ko" showGathering={false} />);
  expect(screen.queryByTestId("gathering")).not.toBeInTheDocument();
});

it("keeps an empty activity open with a localized route back to activities", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...data, rows: [], me: null })));
  render(<LeaderboardPanel slug="elina" locale="ja" />);
  expect(await screen.findByText(leaderboardActivityCopy.ja.empty)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: leaderboardActivityCopy.ja.explore })).toHaveAttribute("href", "/elina?tab=home&locale=ja#celebrity-content");
  expect(screen.queryByTestId("gathering")).not.toBeInTheDocument();
});

it("offers retry without flashing gathering on a transient API failure", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: "UNAVAILABLE" } }, { status: 503 })).mockResolvedValueOnce(Response.json(data));
  vi.stubGlobal("fetch", fetcher);
  render(<LeaderboardPanel slug="elina" locale="ko" />);
  fireEvent.click(await screen.findByRole("button", { name: "다시 시도" }));
  await screen.findByRole("table");
  expect(screen.queryByTestId("gathering")).not.toBeInTheDocument();
});

it.each(APP_LOCALES)("provides all activity labels and variable mission rewards in %s", locale => {
  const copy = leaderboardActivityCopy[locale];
  expect(Object.values(copy.categories)).toHaveLength(5);
  for (const label of Object.values(copy.categories)) expect(label.trim()).not.toBe("");
  expect(copy.medals).toHaveLength(3);
  expect(copy.descriptions.mission).not.toMatch(/\b2\b/);
});
