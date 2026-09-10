import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuizManager } from "./quiz-manager";

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ getAccessToken: async () => "token" }) }));
vi.mock("./use-admin-session", () => ({
  useAdminSession: () => ({ status: "authorized", admin: { role: "operator" } }),
}));
vi.mock("./operations-shell", () => ({ AdminOperationsShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

describe("quiz manager answer controls", () => {
  it("wraps each native correct-answer radio in a visible explicit hit label", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      items: [{
        id: "quiz-1", version: 1, status: "draft", publishedAt: null, everPublishedAt: null, retiredAt: null,
        questions: [{
          id: "question-1", position: 1, promptKo: "질문", promptEn: "Question", active: true,
          options: [1, 2, 3, 4].map((position) => ({ position, labelKo: `${position}번`, labelEn: `Option ${position}`, isCorrect: position === 1, active: true })),
        }],
      }],
    })));
    render(<QuizManager celebrityId="celebrity-1" />);
    const radio = await screen.findByLabelText("1번 선택지 정답");
    expect(radio).toHaveAttribute("type", "radio");
    expect(radio.closest("label")).toHaveTextContent("정답");
  });
});
