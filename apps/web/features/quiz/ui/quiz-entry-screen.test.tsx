import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuizEntryScreen } from "./quiz-entry-screen";
import { createAuthIntent, persistAuthIntent } from "@/components/auth-intent";

const getAccessToken = vi.fn();
const push = vi.fn();
let privyState = { ready: true, authenticated: true };

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ...privyState, getAccessToken }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const attemptId = "11111111-1111-4111-8111-111111111111";
const intro = { celebrity: { slug: "kara", name: "KARA" }, quiz: { availability: "available", totalQuestions: 3, passThreshold: 2 } };
const questions = [1, 2, 3].map((position) => ({
  id: `${position}0000000-0000-4000-8000-00000000000${position}`,
  position,
  prompt: `문항 ${position}`,
  selectedOptionId: null,
  options: [1, 2].map((optionPosition) => ({ id: `${position}${optionPosition}000000-0000-4000-8000-00000000000${optionPosition}`, position: optionPosition, label: `보기 ${optionPosition}` })),
}));

describe("QuizEntryScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    privyState = { ready: true, authenticated: true };
    getAccessToken.mockResolvedValue("privy-token");
    push.mockReset();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/c/kara/verify");
  });

  it("loads the public intro and starts the server-owned attempt before navigating", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ intro }))
      .mockResolvedValueOnce(Response.json({ result: { kind: "attempt", attempt: { id: attemptId, status: "open", score: null, submittedAt: null }, questions } }));

    render(<QuizEntryScreen slug="kara" />);
    expect(await screen.findByRole("heading", { name: /KARA를 향한/ })).toBeInTheDocument();
    const home = screen.getByRole("link", { name: "ByUs 홈" });
    expect(within(home).getByRole("img", { name: "ByUs" })).toHaveAttribute("src", "/images/guest-home/byus-wordmark.svg");
    fireEvent.click(screen.getByRole("button", { name: "팬 인증 시작하기" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/c/kara/verify/questions?attempt=${attemptId}`));
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/public/celebrities/kara/quiz?locale=ko", expect.objectContaining({ method: "GET", cache: "no-store" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/celebrities/kara/quiz/attempts?locale=ko", expect.objectContaining({ method: "POST", headers: { authorization: "Bearer privy-token" } }));
  });

  it("preserves the canonical entry route through login", async () => {
    privyState = { ready: true, authenticated: false };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ intro }));
    render(<QuizEntryScreen slug="kara" />);
    expect(await screen.findByRole("link", { name: "로그인하고 시작하기" })).toHaveAttribute("href", `/login?returnTo=${encodeURIComponent("/c/kara/verify")}&locale=ko&intent=passport&entity=kara`);
  });

  it("resumes a matching durable verification action once and consumes it after the server projection", async () => {
    const intent = createAuthIntent({ sourcePath: "/c/kara/verify", sourceQuery: "", actionType: "START_FAN_VERIFICATION", targetType: "celebrity", targetId: "kara" });
    persistAuthIntent(sessionStorage, intent);
    window.history.replaceState({}, "", `/c/kara/verify?authIntent=${intent.id}`);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ intro }))
      .mockResolvedValueOnce(Response.json({ result: { kind: "holder", passportId: "22222222-2222-4222-8222-222222222222" } }));

    render(<QuizEntryScreen slug="kara" />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/passports/22222222-2222-4222-8222-222222222222"));
    expect(sessionStorage.getItem(`byus:auth-intent:v1:${intent.id}`)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("renders an honest unavailable state without starting an attempt", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ intro: { ...intro, quiz: { ...intro.quiz, availability: "unavailable" } } }));
    render(<QuizEntryScreen slug="kara" />);
    expect(await screen.findByRole("heading", { name: "아직 팬 인증 퀴즈가 준비되지 않았어요." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "팬페이지로 돌아가기" })).toHaveAttribute("href", "/c/kara");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable error when the public contract cannot be loaded", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 }));
    render(<QuizEntryScreen slug="kara" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("현재 참여할 수 있는 팬 인증 퀴즈가 없어요.");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});
