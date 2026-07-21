import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuizQuestionsScreen } from "./quiz-questions-screen";

const getAccessToken = vi.fn();
const replace = vi.fn();
const router = { replace };
let privyState = { ready: true, authenticated: true };

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ...privyState, getAccessToken }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const ids = {
  attempt: "11111111-1111-4111-8111-111111111111",
  passport: "22222222-2222-4222-8222-222222222222",
  stamp: "33333333-3333-4333-8333-333333333333",
  q1: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  q2: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  q3: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  o11: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb111",
  o12: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb112",
  o21: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb121",
  o22: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb122",
  o31: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb131",
  o32: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb132",
} as const;

function attempt(selected: Array<string | null> = [null, null, null]) {
  return {
    attempt: { id: ids.attempt, status: "open", score: null, submittedAt: null },
    questions: [
      { id: ids.q1, position: 1, prompt: "KARA의 데뷔곡은?", selectedOptionId: selected[0], options: [
        { id: ids.o11, position: 1, label: "Break It" },
        { id: ids.o12, position: 2, label: "Pretty Girl" },
      ] },
      { id: ids.q2, position: 2, prompt: "공식 팬덤명은?", selectedOptionId: selected[1], options: [
        { id: ids.o21, position: 1, label: "Kamilia" },
        { id: ids.o22, position: 2, label: "Klover" },
      ] },
      { id: ids.q3, position: 3, prompt: "대표곡을 골라 주세요.", selectedOptionId: selected[2], options: [
        { id: ids.o31, position: 1, label: "STEP" },
        { id: ids.o32, position: 2, label: "Mister" },
      ] },
    ],
  };
}

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

describe("FAN-007 quiz questions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    privyState = { ready: true, authenticated: true };
    getAccessToken.mockResolvedValue("privy-token");
    replace.mockReset();
  });

  it("uses the canonical ByUs wordmark in an accessible home link", () => {
    privyState = { ready: true, authenticated: false };
    render(<QuizQuestionsScreen slug="kara" />);

    const home = screen.getByRole("link", { name: "ByUs 홈" });
    expect(home).toHaveAttribute("href", "/");
    expect(within(home).getByRole("img", { name: "ByUs" })).toHaveAttribute(
      "src",
      "/images/guest-home/byus-wordmark.svg",
    );
  });

  it("restores the open server attempt, renders one of exactly three questions, and preserves API option order", async () => {
    const restored = attempt([ids.o11, null, null]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => json({ result: { kind: "attempt", ...restored } }));

    render(<QuizQuestionsScreen slug="kara" />);

    expect(await screen.findByRole("group", { name: "공식 팬덤명은?" })).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.queryByText("KARA의 데뷔곡은?")).not.toBeInTheDocument();
    const options = screen.getAllByRole("radio");
    expect(options.map((option) => option.getAttribute("value"))).toEqual([ids.o21, ids.o22]);
    expect(fetchMock).toHaveBeenCalledWith("/api/celebrities/kara/quiz/attempts?locale=ko", expect.objectContaining({
      method: "POST",
      headers: { authorization: "Bearer privy-token" },
    }));
  });

  it("saves a selection before navigation and disables next while unanswered", async () => {
    const open = attempt();
    const saved = attempt([ids.o12, null, null]);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => json({ result: { kind: "attempt", ...open } }))
      .mockImplementationOnce(() => json({ attempt: saved }));

    render(<QuizQuestionsScreen slug="kara" />);
    const next = await screen.findByRole("button", { name: "다음 질문" });
    expect(next).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Pretty Girl" }));
    expect(await screen.findByText("답변 저장 완료")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/quiz-attempts/${ids.attempt}/answers?locale=ko`, expect.objectContaining({
      method: "PUT",
      headers: expect.objectContaining({ authorization: "Bearer privy-token" }),
      body: JSON.stringify({ questionId: ids.q1, selectedOptionId: ids.o12 }),
    }));

    fireEvent.click(next);
    expect(screen.getByRole("group", { name: "공식 팬덤명은?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "이전 질문" })).toBeEnabled();
  });

  it("submits only after every server answer is saved and redirects pass with attempt and passport", async () => {
    const complete = attempt([ids.o11, ids.o21, ids.o31]);
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => json({ result: { kind: "attempt", ...complete } }))
      .mockImplementationOnce(() => json({ result: {
        attempt: { id: ids.attempt, status: "passed", score: 3, submittedAt: "2026-07-21T00:00:00.000Z" },
        issuance: { passportId: ids.passport, stampId: ids.stamp, scorePoints: 1 },
      } }));

    render(<QuizQuestionsScreen slug="kara" />);
    await screen.findByRole("group", { name: "KARA의 데뷔곡은?" });
    fireEvent.click(screen.getByRole("button", { name: "다음 질문" }));
    fireEvent.click(screen.getByRole("button", { name: "다음 질문" }));
    fireEvent.click(screen.getByRole("button", { name: "팬 인증 결과 확인" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith(
      `/c/kara/verify/result?attempt=${ids.attempt}&passport=${ids.passport}`,
    ));
  });

  it("redirects failure with the attempt only", async () => {
    const complete = attempt([ids.o11, ids.o21, ids.o31]);
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => json({ result: { kind: "attempt", ...complete } }))
      .mockImplementationOnce(() => json({ result: {
        attempt: { id: ids.attempt, status: "failed", score: 1, submittedAt: "2026-07-21T00:00:00.000Z" },
        issuance: null,
      } }));

    render(<QuizQuestionsScreen slug="kara" />);
    await screen.findByRole("group", { name: "KARA의 데뷔곡은?" });
    fireEvent.click(screen.getByRole("button", { name: "다음 질문" }));
    fireEvent.click(screen.getByRole("button", { name: "다음 질문" }));
    fireEvent.click(screen.getByRole("button", { name: "팬 인증 결과 확인" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/c/kara/verify/result?attempt=${ids.attempt}`));
  });

  it("sends an existing Passport holder directly to the owner-scoped detail", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => json({
      result: { kind: "holder", passportId: ids.passport },
    }));

    render(<QuizQuestionsScreen slug="kara" />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/passports/${ids.passport}`));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows authenticated loading, login, retry, and safe invalid-response states", async () => {
    privyState = { ready: false, authenticated: false };
    const { rerender } = render(<QuizQuestionsScreen slug="kara" />);
    expect(screen.getByRole("status", { name: "팬 인증 퀴즈 불러오는 중" })).toBeInTheDocument();

    privyState = { ready: true, authenticated: false };
    rerender(<QuizQuestionsScreen slug="kara" />);
    expect(screen.getByRole("link", { name: "로그인하고 계속하기" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fc%2Fkara%2Fverify%2Fquestions&intent=passport",
    );

    privyState = { ready: true, authenticated: true };
    vi.spyOn(globalThis, "fetch").mockImplementation(() => json({ result: { kind: "attempt", ...attempt(), isCorrect: true } }));
    rerender(<QuizQuestionsScreen slug="kara" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("퀴즈 정보를 안전하게 불러오지 못했어요");
    expect(screen.queryByText(/isCorrect/i)).not.toBeInTheDocument();
    expect(within(screen.getByRole("alert")).getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});
