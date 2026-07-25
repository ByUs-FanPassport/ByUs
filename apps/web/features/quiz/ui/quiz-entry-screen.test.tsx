import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuizEntryScreen } from "./quiz-entry-screen";
import { createAuthIntent, persistAuthIntent } from "@/components/auth-intent";

const getAccessToken = vi.fn();
const push = vi.fn();
const replace = vi.fn();
const router = { push, replace };
let privyState = { ready: true, authenticated: true };

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ...privyState, getAccessToken }) }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

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
    replace.mockReset();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/c/kara/verify");
  });

  it("loads the public intro and starts the server-owned attempt before navigating", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/me/profile") return Response.json({ profile: { completed: true } });
      if (url.includes("/api/public/")) return Response.json({ intro });
      return Response.json({ result: { kind: "attempt", attempt: { id: attemptId, status: "open", score: null, submittedAt: null }, questions } });
    });

    render(<QuizEntryScreen locale="ko" slug="kara" />);
    expect(await screen.findByRole("heading", { name: /KARA를 향한/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "KARA 팬페이지로 돌아가기" })).toHaveAttribute("href", "/c/kara?locale=ko");
    const home = screen.getByRole("link", { name: "ByUs 홈" });
    expect(within(home).getByRole("img", { name: "ByUs" })).toHaveAttribute("src", "/images/guest-home/byus-wordmark.svg");
    fireEvent.click(screen.getByRole("button", { name: "팬 인증 시작하기" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/c/kara/verify/questions?attempt=${attemptId}&locale=ko`));
    expect(fetchMock).toHaveBeenCalledWith("/api/public/celebrities/kara/quiz?locale=ko", expect.objectContaining({ method: "GET", cache: "no-store" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/celebrities/kara/quiz/attempts?locale=ko", expect.objectContaining({ method: "POST", headers: { authorization: "Bearer privy-token" } }));
  });

  it("preserves the canonical entry route through login", async () => {
    privyState = { ready: true, authenticated: false };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ intro }));
    render(<QuizEntryScreen locale="ko" slug="kara" />);
    expect(await screen.findByRole("link", { name: "로그인하고 시작하기" })).toHaveAttribute("href", `/login?returnTo=${encodeURIComponent("/c/kara/verify?locale=ko")}&locale=ko&intent=passport&entity=kara`);
  });

  it("resumes a matching durable verification action once and consumes it after the server projection", async () => {
    const intent = createAuthIntent({ sourcePath: "/c/kara/verify", sourceQuery: "", actionType: "START_FAN_VERIFICATION", targetType: "celebrity", targetId: "kara" });
    persistAuthIntent(sessionStorage, intent);
    window.history.replaceState({}, "", `/c/kara/verify?authIntent=${intent.id}`);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/me/profile") return Response.json({ profile: { completed: true } });
      if (url.includes("/api/public/")) return Response.json({ intro });
      return Response.json({ result: { kind: "holder", passportId: "22222222-2222-4222-8222-222222222222" } });
    });

    render(<QuizEntryScreen locale="ko" slug="kara" />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/passports/22222222-2222-4222-8222-222222222222?locale=ko"));
    expect(sessionStorage.getItem(`byus:auth-intent:v1:${intent.id}`)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("renders an honest unavailable state without starting an attempt", async () => {
    privyState = { ready: true, authenticated: false };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ intro: { ...intro, quiz: { ...intro.quiz, availability: "unavailable" } } }));
    render(<QuizEntryScreen locale="ko" slug="kara" />);
    expect(await screen.findByRole("heading", { name: "아직 팬 인증 퀴즈가 준비되지 않았어요." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "팬페이지로 돌아가기" })).toHaveAttribute("href", "/c/kara?locale=ko");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redirects an authenticated user without a profile to contextual onboarding", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/me/profile") return Response.json({ profile: { completed: false } });
      return Response.json({ intro });
    });
    render(<QuizEntryScreen locale="ko" slug="kara" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(
      "/onboarding/profile?returnTo=%2Fc%2Fkara%2Fverify%3Flocale%3Dko&locale=ko&intent=passport&entity=kara",
    ));
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/quiz/attempts"), expect.anything());
  });

  it("shows a retryable error when the public contract cannot be loaded", async () => {
    privyState = { ready: true, authenticated: false };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 }));
    render(<QuizEntryScreen locale="ko" slug="kara" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("현재 참여할 수 있는 팬 인증 퀴즈가 없어요.");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("threads English locale through copy, APIs, auth intent, and fan-page links", async () => {
    privyState = { ready: true, authenticated: false };
    const englishIntro = {
      celebrity: { slug: "katseye", name: "KATSEYE" },
      quiz: { availability: "available", totalQuestions: 3, passThreshold: 2 },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ intro: englishIntro }));

    render(<QuizEntryScreen locale="en" slug="katseye" />);

    expect(await screen.findByRole("heading", { name: /See how well you know KATSEYE/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to KATSEYE fan page" })).toHaveAttribute(
      "href",
      "/c/katseye?locale=en",
    );
    expect(screen.getByRole("link", { name: "Sign in to start" })).toHaveAttribute(
      "href",
      `/login?returnTo=${encodeURIComponent("/c/katseye/verify?locale=en")}&locale=en&intent=passport&entity=katseye`,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/celebrities/katseye/quiz?locale=en",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
