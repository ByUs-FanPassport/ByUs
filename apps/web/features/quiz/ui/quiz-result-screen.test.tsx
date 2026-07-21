import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuizResultScreen } from "./quiz-result-screen";

const getAccessToken = vi.fn();
const push = vi.fn();
let authenticated = true;

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated, getAccessToken }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const attemptId = "10000000-0000-4000-8000-000000000001";
const passportId = "20000000-0000-4000-8000-000000000002";
const stampId = "30000000-0000-4000-8000-000000000003";

function terminalAttempt(status: "passed" | "failed", score: 1 | 2) {
  return {
    attempt: {
      attempt: { id: attemptId, status, score, submittedAt: "2026-07-21T05:00:00.000Z" },
      questions: [1, 2, 3].map((position) => {
        const options = [1, 2].map((optionPosition) => ({
          id: `${position}${optionPosition}000000-0000-4000-8000-00000000000${optionPosition}`,
          position: optionPosition,
          label: `보기 ${optionPosition}`,
        }));
        return {
          id: `${position}0000000-0000-4000-8000-00000000000${position}`,
          position,
          prompt: `문항 ${position}`,
          selectedOptionId: options[0].id,
          options,
        };
      }),
    },
  };
}

const issuance = {
  passport: {
    id: passportId,
    businessStatus: "issued",
    mintStatus: "queued",
    tokenId: null,
    issuedAt: "2026-07-21T05:00:00+00:00",
  },
  celebrity: {
    slug: "kara",
    name: "KARA",
    image: { url: "/images/kara.jpg", alt: "KARA", position: "center" },
  },
  firstStamp: {
    type: "knowledge",
    businessStatus: "issued",
    mintStatus: "queued",
    tokenId: null,
    issuedAt: "2026-07-21T05:00:00+00:00",
  },
  score: { points: 1 },
};

describe("QuizResultScreen", () => {
  beforeEach(() => {
    authenticated = true;
    getAccessToken.mockResolvedValue("access-token");
    push.mockClear();
    vi.spyOn(globalThis, "fetch").mockReset();
  });

  it("preserves the exact pass result destination when authentication is required", async () => {
    authenticated = false;
    render(<QuizResultScreen attemptId={attemptId} passportId={passportId} celebritySlug="kara" />);
    const returnTo = `/c/kara/verify/result?attempt=${attemptId}&passport=${passportId}`;
    expect(screen.getByRole("heading", { name: "로그인이 필요해요." })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "ByUs" })).toHaveAttribute("src", expect.stringContaining("byus-wordmark.svg"));
    expect(screen.getByRole("link", { name: "로그인하고 결과 확인하기" })).toHaveAttribute(
      "href",
      `/login?returnTo=${encodeURIComponent(returnTo)}&intent=passport`,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads the terminal pass without exposing answers and gets existing issuance once", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(terminalAttempt("passed", 2)))
      .mockResolvedValueOnce(Response.json({ issuance }));

    render(<QuizResultScreen attemptId={attemptId} passportId={passportId} celebritySlug="kara" />);

    expect(await screen.findByRole("heading", { name: "KARA Official Fan 인증 완료" })).toBeInTheDocument();
    expect(screen.getByText("3문항 중 2문항을 맞혔어요.")).toBeInTheDocument();
    expect(screen.queryByText(/정답과 해설/)).not.toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Passport 받기" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(await screen.findByRole("dialog", { name: "KARA 팬 Passport 발급" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(
      `/api/passports/${passportId}/issuance?locale=ko`,
      expect.objectContaining({ method: "GET", headers: { authorization: "Bearer access-token" } }),
    );
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "POST" && String(init))).toBe(false);
  });

  it("starts a fresh attempt after failure and navigates to its question snapshot", async () => {
    const nextAttemptId = "40000000-0000-4000-8000-000000000004";
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(terminalAttempt("failed", 1)))
      .mockResolvedValueOnce(Response.json({
        result: { kind: "attempt", ...terminalAttempt("failed", 1).attempt, attempt: { id: nextAttemptId, status: "open", score: null, submittedAt: null } },
      }));

    render(<QuizResultScreen attemptId={attemptId} passportId={null} celebritySlug="kara" />);
    expect(await screen.findByRole("heading", { name: "조금만 더 알아보고 다시 도전해 볼까요?" })).toBeInTheDocument();
    expect(screen.getByText("정답과 해설은 공개하지 않아요. 새 문항으로 다시 도전할 수 있습니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다시 도전" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/c/kara/verify/questions?attempt=${nextAttemptId}`));
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/celebrities/kara/quiz/attempts?locale=ko",
      expect.objectContaining({ method: "POST", headers: { authorization: "Bearer access-token" } }),
    );
  });

  it("does not render a pass result when the terminal status contradicts its passport query", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(terminalAttempt("failed", 1)));
    render(<QuizResultScreen attemptId={attemptId} passportId={passportId} celebritySlug="kara" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("결과 정보를 확인할 수 없어요.");
    expect(screen.queryByRole("button", { name: "Passport 받기" })).not.toBeInTheDocument();
  });
});
