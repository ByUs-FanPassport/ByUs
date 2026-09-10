import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  archivedAt: null, updatedAt: "2026-09-10T00:00:00Z", roles: ["artist"],
  localizations: { ko: { name: "직군 검증", summary: "소개", imageAlt: "직군 검증" }, en: { name: "Role proof", summary: "Profile", imageAlt: "Role proof" } }, themes: [], socialLinks: [],
};
afterEach(() => vi.unstubAllGlobals());

it("requires a representative on new profiles and saves all selected activities in order", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [celebrity] }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<AuthorizedCelebrityManager environment="Development" />);
  const primary = screen.getByRole("combobox", { name: "대표 직군" });
  expect(primary).toBeInvalid();
  expect(screen.getByRole("group", { name: "추가 직군" })).toBeDisabled();
  fireEvent.click(await screen.findByRole("button", { name: /직군 검증.*아티스트/ }));
  await waitFor(() => expect(primary).toHaveValue("artist"));
  fireEvent.change(primary, { target: { value: "show_host" } });
  const additional = screen.getByRole("group", { name: "추가 직군" });
  expect(within(additional).getByRole("checkbox", { name: "아티스트" })).toBeChecked();
  fireEvent.click(within(additional).getByRole("checkbox", { name: "크리에이터" }));
  fireEvent.submit(primary.closest("form")!);
  await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init.method === "POST")).toBe(true));
  const [, request] = fetchMock.mock.calls.find(([, init]) => init.method === "POST")!;
  expect(JSON.parse(request.body).payload.roles).toEqual(["show_host", "artist", "creator"]);
});
