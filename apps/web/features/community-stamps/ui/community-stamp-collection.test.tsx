import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { APP_LOCALES } from "@/i18n/locales";
import { AVAILABLE_COMMUNITY_STAMPS, COMMUNITY_STAMPS } from "../domain/community-stamps";
import { CommunityStampCollection } from "./community-stamp-collection";

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true, user: { id: "owner" } }) }));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

it("offers owned Stamps instead of an endless retry for an unavailable creator, while retaining network retry", () => {
  const retry = vi.fn();
  const resource = { state: { status: "error" as const, kind: "missing" as const }, retry, replaceData: vi.fn(), refreshFailed: false };
  const view = render(<CommunityStampCollection locale="ko" creator="katseye" resource={resource} />);
  expect(screen.getByRole("status")).toHaveTextContent("현재 이 최애의 스탬프 활동을 이용할 수 없어요.");
  expect(screen.getByRole("link", { name: "내 스탬프 보기" })).toHaveAttribute("href", "/my?locale=ko#community-stamps");
  expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
  view.rerender(<CommunityStampCollection locale="ko" creator="katseye" resource={{ ...resource, state: { status: "error", kind: "network" } }} />);
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(retry).toHaveBeenCalledOnce();
});

it("sends creator comment activity to the fan feed", () => {
  render(<CommunityStampCollection locale="ko" creator="elina" resource={{ state: { status: "ready", data: { stamps: [], today: "2026-10-09" } }, retry: vi.fn(), replaceData: vi.fn(), refreshFailed: false }} />);
  expect(screen.getByRole("link", { name: "댓글 남기기" })).toHaveAttribute("href", "/elina?tab=board&source=fans&locale=ko#celebrity-content");
});

it.each(APP_LOCALES)("shows translated Stamp instructions in %s", (locale) => {
  render(<CommunityStampCollection locale={locale} resource={{ state: { status: "ready", data: { stamps: [], today: "2026-10-09" } }, retry: vi.fn(), replaceData: vi.fn(), refreshFailed: false }} />);

  for (const kind of AVAILABLE_COMMUNITY_STAMPS) {
    const help = COMMUNITY_STAMPS[kind].help[locale];
    expect(help).toBeTruthy();
    expect(screen.getByText(help)).toBeInTheDocument();
  }
  if (locale !== "en") expect(COMMUNITY_STAMPS.first_comment.help[locale]).not.toBe(COMMUNITY_STAMPS.first_comment.help.en);
});

it("hides the duplicate creator count while retaining the account-wide count and earned history", () => {
  const creatorStamp = { id: "11111111-1111-4111-8111-111111111111", kind: "first_comment" as const, celebritySlug: "elina", issuedAt: "2026-10-09T00:00:00.000Z", mint: { status: "queued" as const, txHash: null, tokenId: null } };
  const accountStamp = { ...creatorStamp, id: "22222222-2222-4222-8222-222222222222", kind: "welcome" as const, celebritySlug: null };
  const view = render(<CommunityStampCollection locale="ko" creator="elina" resource={{ state: { status: "ready", data: { stamps: [creatorStamp], today: "2026-10-09" } }, retry: vi.fn(), replaceData: vi.fn(), refreshFailed: false }} />);

  expect(screen.queryByText("1개 수집")).not.toBeInTheDocument();
  expect(screen.getByText("받은 스탬프 전체 보기 · 1")).toBeInTheDocument();

  view.rerender(<CommunityStampCollection locale="ko" resource={{ state: { status: "ready", data: { stamps: [accountStamp], today: "2026-10-09" } }, retry: vi.fn(), replaceData: vi.fn(), refreshFailed: false }} />);
  expect(screen.getByText("1개 수집")).toBeInTheDocument();
});

it.each([
  ["queued", "기록을 등록하고 있어요."],
  ["processing", "기록을 등록하고 있어요."],
  ["retryable", "기록을 등록하고 있어요."],
  ["permanent_failure", "기록 등록 상태를 확인해 주세요."],
  ["minted", "기록 등록이 완료됐어요."],
] as const)("distinguishes the %s registration status from the earned Stamp", (status, expected) => {
  const txHash = status === "minted" ? `0x${"a".repeat(64)}` : null;
  const stamp = { id: "11111111-1111-4111-8111-111111111111", kind: "first_comment" as const, celebritySlug: "elina", issuedAt: "2026-10-09T00:00:00.000Z", mint: { status, txHash, tokenId: status === "minted" ? "42" : null } };
  render(<CommunityStampCollection locale="ko" creator="elina" resource={{ state: { status: "ready", data: { stamps: [stamp], today: "2026-10-09" } }, retry: vi.fn(), replaceData: vi.fn(), refreshFailed: false }} />);

  fireEvent.click(screen.getByRole("button", { name: "스탬프 보기" }));
  expect(screen.getByText(expected)).toBeInTheDocument();
});

it("does not claim registration is complete when a minted Stamp has no transaction hash", () => {
  const stamp = { id: "11111111-1111-4111-8111-111111111111", kind: "first_comment" as const, celebritySlug: "elina", issuedAt: "2026-10-09T00:00:00.000Z", mint: { status: "minted" as const, txHash: null, tokenId: "42" } };
  render(<CommunityStampCollection locale="ko" creator="elina" resource={{ state: { status: "ready", data: { stamps: [stamp], today: "2026-10-09" } }, retry: vi.fn(), replaceData: vi.fn(), refreshFailed: false }} />);

  fireEvent.click(screen.getByRole("button", { name: "스탬프 보기" }));
  expect(screen.getByText("기록 등록 상태를 확인해 주세요.")).toBeInTheDocument();
  expect(screen.queryByText("기록 등록이 완료됐어요.")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "등록 기록 보기" })).not.toBeInTheDocument();
});
