import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CommunityStampCollection } from "./community-stamp-collection";

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true, user: { id: "owner" } }) }));

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
