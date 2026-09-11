import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CreatorFanLink } from "./creator-fan-link";
import { notifyFanActivityUpdated } from "./fan-activity-updates";
let authenticated = true;
let ownerId = "owner";
const getAccessToken = vi.fn(async () => "token");
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated, user: { id: ownerId }, getAccessToken }) }));
const summary = (verified: boolean, slug = "elina") => ({
  profile: { nickname: null },
  creators: [{ celebrity: { slug, name: "엘리나", image: "/elina.jpg" }, relationship: verified ? "passport" : "first_reaction_only",
    passport: verified ? { id: "11111111-1111-4111-8111-111111111111", tier: "Bronze", score: 0, remainingToNextTier: 10 } : null,
    ticketBalance: 0, firstReaction: { completedAt: "2026-09-01T00:00:00Z", txHash: null } }],
  live: { upcoming: [], history: [] }, rewards: { availableCount: 0, entries: 0, items: [] },
  collection: { passportCount: verified ? 1 : 0, stampCount: 0, collectibleCount: 0, recent: [] }, unreadNotificationCount: 0,
});
beforeEach(() => { authenticated = true; ownerId = "owner"; vi.unstubAllGlobals(); });
it("does not call a reaction-only relationship completed fan verification", async () => {
  const fetcher = vi.fn(async () => Response.json({ summary: summary(false) }));
  vi.stubGlobal("fetch", fetcher);
  render(<CreatorFanLink slug="elina" name="엘리나" locale="ko" />);
  expect(await screen.findByRole("link", { name: "엘리나 입덕하기" })).not.toHaveAttribute("data-verified");
  expect(fetcher.mock.calls).toHaveLength(1);
});
it("shows completion only for the matching creator Passport", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ summary: summary(true) })));
  render(<><CreatorFanLink slug="elina" name="엘리나" locale="ko" /><CreatorFanLink slug="kara" name="KARA" locale="ko" /></>);
  expect(await screen.findByRole("link", { name: "엘리나 입덕 완료" })).toHaveAttribute("data-verified", "true");
  expect(await screen.findByRole("link", { name: "KARA 입덕하기" })).not.toHaveAttribute("data-verified");
});
it("refreshes a mounted card after fan verification creates a Passport", async () => {
  let verified = false;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ summary: summary(verified) })));
  render(<CreatorFanLink slug="elina" name="엘리나" locale="ko" />);
  await screen.findByRole("link", { name: "엘리나 입덕하기" });
  verified = true;
  act(() => notifyFanActivityUpdated("owner", ["summary", "passports"]));
  await screen.findByRole("link", { name: "엘리나 입덕 완료" });
});
it("clears verification immediately after logout", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ summary: summary(true) })));
  const { rerender } = render(<CreatorFanLink slug="elina" name="엘리나" locale="ko" />);
  await screen.findByRole("link", { name: "엘리나 입덕 완료" });
  authenticated = false;
  rerender(<CreatorFanLink slug="elina" name="엘리나" locale="ko" />);
  expect(screen.getByRole("link", { name: "엘리나 입덕하기" })).not.toHaveAttribute("data-verified");
});
it("never displays the previous owner's completion when switching accounts", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ summary: summary(ownerId === "owner") })));
  const { rerender } = render(<CreatorFanLink slug="elina" name="엘리나" locale="ko" />);
  await screen.findByRole("link", { name: "엘리나 입덕 완료" });
  ownerId = "other";
  rerender(<CreatorFanLink slug="elina" name="엘리나" locale="ko" />);
  expect(screen.queryByRole("link", { name: "엘리나 입덕 완료" })).not.toBeInTheDocument();
  await screen.findByRole("link", { name: "엘리나 입덕하기" });
});
it("keeps errors distinct from unverified and preserves the fan page route", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 503 })));
  render(<CreatorFanLink slug="elina" name="엘리나" locale="ko" />);
  expect(await screen.findByRole("link", { name: "엘리나 팬페이지 보기" })).toHaveAttribute("href", "/c/elina?locale=ko");
});
it("uses verification wording in English", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ summary: summary(true) })));
  render(<CreatorFanLink slug="elina" name="Elina" locale="en" />);
  expect(await screen.findByRole("link", { name: "Elina Fan verified" })).toHaveAttribute("href", "/c/elina?locale=en");
});
