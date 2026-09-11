import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AuthorizedCelebrityManager } from "./celebrity-manager";

const getAccessToken = vi.hoisted(() => vi.fn().mockResolvedValue("local-token"));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ getAccessToken }) }));
vi.mock("./use-admin-session", () => ({ useAdminSession: () => ({ status: "authorized", admin: { role: "admin" } }) }));
vi.mock("./operations-shell", () => ({ AdminOperationsShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("./notice-manager", () => ({ NoticeManager: () => null }));

const celebrity = {
  id: "33333333-3333-4333-8333-333333333333", slug: "role-proof", status: "draft", imageUrl: "/proof.jpg", imagePosition: "center", displayOrder: 0, fanCount: 10,
  archivedAt: null, updatedAt: "2026-09-10T00:00:00Z", primaryRole: "singer",
  localizations: { ko: { name: "직군 검증", summary: "소개", imageAlt: "직군 검증" }, en: { name: "Role proof", summary: "Profile", imageAlt: "Role proof" } }, themes: [], socialLinks: [],
};
afterEach(() => vi.unstubAllGlobals());

it("requires exactly one primary role and saves no legacy activity array", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [celebrity] }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<AuthorizedCelebrityManager environment="Development" />);
  const primary = screen.getByRole("combobox", { name: "대표 직군" });
  expect(primary).toBeInvalid();
  expect(screen.queryByRole("group", { name: "추가 직군" })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: /직군 검증.*가수/ }));
  await waitFor(() => expect(primary).toHaveValue("singer"));
  expect(screen.getByRole("textbox", { name: "기본 이미지 URL (초안 생성용)" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "기본 이미지 위치 (초안 생성용)" })).toBeDisabled();
  fireEvent.change(primary, { target: { value: "show_host" } });
  fireEvent.submit(primary.closest("form")!);
  await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init.method === "POST")).toBe(true));
  const [, request] = fetchMock.mock.calls.find(([, init]) => init.method === "POST")!;
  const payload = JSON.parse(request.body).payload;
  expect(payload.primaryRole).toBe("show_host");
  expect(payload).not.toHaveProperty("roles");
  expect(Array.from(primary.querySelectorAll("option")).map((option) => option.value)).toEqual(["", "idol", "singer", "actor", "creator", "show_host"]);
});
