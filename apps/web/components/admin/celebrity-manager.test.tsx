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
  const primary = screen.getByRole("combobox", { name: "대표 분류" });
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
  expect(Array.from(primary.querySelectorAll("option")).map((option) => option.value)).toEqual(["", "idol", "singer", "actor", "creator", "show_host", "brand"]);
});

it("keeps saved person and brand profiles in their category and saves blank external URLs as null", async () => {
  const brand = { ...celebrity, id: "44444444-4444-4444-8444-444444444444", slug: "runmusic", primaryRole: "brand", websiteUrl: "https://runmusic.example", ticketUrl: "https://wgrw.raceplan.co.kr/entryperson", localizations: { ko: { name: "런뮤직", summary: "브랜드 소개", imageAlt: "런뮤직 로고" }, en: { name: "Runmusic", summary: "Brand profile", imageAlt: "Runmusic logo" } } };
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [brand] }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<AuthorizedCelebrityManager environment="Development" />);

  fireEvent.click(await screen.findByRole("button", { name: /런뮤직.*브랜드/ }));
  const primary = document.querySelector<HTMLSelectElement>('select[required]')!;
  expect(primary).toHaveValue("brand");
  expect(primary.querySelector<HTMLOptionElement>('option[value="singer"]')).toBeDisabled();
  expect(primary.querySelector<HTMLOptionElement>('option[value="brand"]')).not.toBeDisabled();
  expect(screen.getByRole("link", { name: "팬 퀴즈" })).toHaveAttribute("href", `/admin/celebrities/${brand.id}/quiz`);

  const website = screen.getByRole("textbox", { name: "공식 웹사이트" });
  expect(website).toHaveValue("https://runmusic.example");
  fireEvent.change(website, { target: { value: "" } });
  const ticket = screen.getByRole("textbox", { name: "예매·참가 신청 URL" });
  expect(ticket).toHaveValue("https://wgrw.raceplan.co.kr/entryperson");
  fireEvent.change(ticket, { target: { value: "" } });
  fireEvent.submit(primary.closest("form")!);
  await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init.method === "POST")).toBe(true));
  const [, request] = fetchMock.mock.calls.find(([, init]) => init.method === "POST")!;
  expect(JSON.parse(request.body).payload).toEqual(expect.objectContaining({ websiteUrl: null, ticketUrl: null }));
});

it("makes list scope and new-versus-edit mode explicit", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ items: [celebrity] }),
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<AuthorizedCelebrityManager environment="Development" />);
  expect(screen.getByRole("heading", { name: "새 크리에이터 등록" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "초안 저장" })).toBeDisabled();
  expect(await screen.findByText("1개 검색 결과 · 전체 1개")).toBeInTheDocument();
  const status = screen.getByRole("combobox", { name: "공개 상태" });
  fireEvent.change(status, { target: { value: "published" } });
  expect(screen.getByText("조건에 맞는 크리에이터가 없습니다.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "조건 지우기" }));
  const item = await screen.findByRole("button", { name: /직군 검증.*가수.*초안/ });
  fireEvent.click(item);
  expect(
    screen.getByRole("heading", { name: "직군 검증 편집" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "변경 저장" })).toBeEnabled();
});

it("rejects reserved paths and locks a slug after first publication", async () => {
  const publishedBefore = { ...celebrity, everPublishedAt: "2026-09-10T01:00:00Z" };
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [publishedBefore] }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<AuthorizedCelebrityManager environment="Development" />);

  const newSlug = screen.getByRole("textbox", { name: "주소 경로" });
  fireEvent.change(newSlug, { target: { value: "admin" } });
  expect(screen.getByRole("button", { name: "초안 저장" })).toBeDisabled();

  fireEvent.click(await screen.findByRole("button", { name: /직군 검증.*가수/ }));
  expect(screen.getByRole("textbox", { name: "주소 경로" })).toBeDisabled();
  expect(screen.getByText(/최초 공개 후에는 변경할 수 없습니다/)).toBeInTheDocument();
});

it("pages the full creator list and resets to the first page when filters change", async () => {
  const items = Array.from({ length: 41 }, (_, index) => ({ ...celebrity, id: `creator-${index}`, slug: `creator-${index}`, localizations: { ...celebrity.localizations, ko: { ...celebrity.localizations.ko, name: `크리에이터 ${index}` } } }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items }) }));
  render(<AuthorizedCelebrityManager environment="Development" />);
  expect(await screen.findByRole("button", { name: /크리에이터 0.*가수/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /크리에이터 20.*가수/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "다음 페이지" }));
  expect(screen.getByRole("button", { name: /크리에이터 20.*가수/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /크리에이터 0.*가수/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "마지막 페이지" }));
  expect(screen.getByRole("button", { name: /크리에이터 40.*가수/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "다음 페이지" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "이름 또는 주소 검색" }), { target: { value: "creator-0" } });
  expect(screen.getByRole("button", { name: /크리에이터 0.*가수/ })).toBeInTheDocument();
  expect(screen.getByText("전체 1건 중 1–1건")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "조건 지우기" }));
  expect(screen.getByRole("button", { name: "1페이지" })).toHaveAttribute("aria-current", "page");
});
