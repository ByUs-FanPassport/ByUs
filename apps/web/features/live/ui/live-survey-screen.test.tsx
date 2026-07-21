import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LiveSurveyScreen } from "./live-survey-screen";

const getAccessToken = vi.fn(async () => "access-token");

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true, getAccessToken }),
}));

const ids = {
  survey: "819b52d9-62c3-450c-b3dc-78d84d2238c6",
  single: "a1f86df9-f5e4-4ee1-b375-d18092b63e6a",
  multiple: "af425d21-e8aa-4a7e-b20f-57b019b94b37",
  rating: "4df8415a-b9ec-4cb8-8e50-73850b887dc1",
  text: "f4742cc2-85c2-4e16-9df1-4a05b1d21346",
  option1: "90339735-90b4-4e85-8707-d2037a6d35f9",
  option2: "62aac40d-dc92-4029-a579-a3bb97fa9132",
};

function payload(options?: { attendance?: boolean; status?: "draft" | "submitted"; revision?: number }) {
  return {
    survey: {
      id: ids.survey,
      version: 1,
      questions: [
        { id: ids.single, type: "single_choice", question: "가장 좋았던 순간은?", required: true, order: 1, options: [{ id: ids.option1, label: "오프닝", order: 1 }, { id: ids.option2, label: "엔딩", order: 2 }] },
        { id: ids.multiple, type: "multiple_choice", question: "다음에 보고 싶은 콘텐츠는?", required: false, order: 2, options: [{ id: ids.option1, label: "토크", order: 1 }, { id: ids.option2, label: "무대", order: 2 }] },
        { id: ids.rating, type: "rating_1_5", question: "LIVE는 어땠나요?", required: true, order: 3, options: [] },
        { id: ids.text, type: "free_text", question: "의견을 남겨 주세요", required: false, order: 4, options: [] },
      ],
    },
    eligibility: { completedAttendance: options?.attendance ?? true },
    response: options?.status ? {
      status: options.status,
      revision: options.revision ?? 1,
      answers: options.status === "draft" ? [{ questionId: ids.single, selectedOptionIds: [ids.option1] }] : [],
      submittedAt: options.status === "submitted" ? "2026-07-21T03:00:00.000Z" : null,
    } : null,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("LiveSurveyScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("renders all four localized question types with accessible native controls", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(payload()));
    render(<LiveSurveyScreen slug="kara-nualeaf" locale="ko" />);
    expect(await screen.findByRole("heading", { name: "LIVE 설문" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "오프닝" })).toBeRequired();
    expect(screen.getByRole("checkbox", { name: "토크" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "5" })).toBeRequired();
    expect(screen.getByRole("textbox", { name: /의견을 남겨 주세요/ })).toHaveAttribute("maxlength", "4000");
    expect(screen.getByRole("link", { name: "KO / EN" })).toHaveAttribute("href", "/live/kara-nualeaf/survey?locale=en");
  });

  it("shows the attendance eligibility gate and retains locale in the Fan Code route", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(payload({ attendance: false })));
    render(<LiveSurveyScreen slug="kara-nualeaf" locale="en" />);
    expect(await screen.findByRole("heading", { name: "Complete attendance to join" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enter Fan Code" })).toHaveAttribute("href", "/live/kara-nualeaf?locale=en#fan-code");
  });

  it("announces required errors inline and focuses the first invalid question", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(payload()));
    render(<LiveSurveyScreen slug="kara-nualeaf" locale="ko" />);
    await screen.findByRole("heading", { name: "LIVE 설문" });
    fireEvent.click(screen.getByRole("button", { name: "설문 제출하기" }));
    expect(await screen.findAllByText("이 질문에 답해 주세요.")).toHaveLength(3);
    await waitFor(() => expect(screen.getByRole("radio", { name: "오프닝" })).toHaveFocus());
  });

  it("debounces draft saving with expectedRevision and stores no free text in session storage", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(payload({ status: "draft", revision: 3 })))
      .mockResolvedValueOnce(jsonResponse({ response: { status: "draft", revision: 4, answers: [{ questionId: ids.single, selectedOptionIds: [ids.option2] }], updatedAt: "2026-07-21T03:00:00.000Z" } }));
    render(<LiveSurveyScreen slug="kara-nualeaf" locale="ko" />);
    const ending = await screen.findByRole("radio", { name: "엔딩" });
    fireEvent.change(screen.getByRole("textbox", { name: "의견을 남겨 주세요" }), { target: { value: "비공개 자유서술" } });
    vi.useFakeTimers();
    fireEvent.click(ending);
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body).toEqual(expect.objectContaining({ expectedRevision: 3, answers: expect.arrayContaining([{ questionId: ids.single, selectedOptionIds: [ids.option2] }, { questionId: ids.text, freeText: "비공개 자유서술" }]) }));
    expect(Object.values(sessionStorage).join(" ")).not.toContain("비공개 자유서술");
    vi.useRealTimers();
  });

  it("never silently overwrites a stale draft and applies the explicit saved-draft choice", async () => {
    const newer = payload({ status: "draft", revision: 8 });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(payload({ status: "draft", revision: 3 })))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "REVISION_CONFLICT" } }, 409))
      .mockResolvedValueOnce(jsonResponse(newer));
    render(<LiveSurveyScreen slug="kara-nualeaf" locale="ko" />);
    fireEvent.click(await screen.findByRole("radio", { name: "엔딩" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "다른 화면에서 저장된 초안이 있어요" })).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByRole("radio", { name: "엔딩" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "저장된 초안 사용" }));
    expect(screen.getByRole("radio", { name: "오프닝" })).toBeChecked();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("guards double submission and renders the approved Survey Stamp completion", async () => {
    let resolveSubmit!: (response: Response) => void;
    const submitPromise = new Promise<Response>((resolve) => { resolveSubmit = resolve; });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(payload()))
      .mockImplementationOnce(() => submitPromise)
      .mockResolvedValueOnce(jsonResponse(payload({ status: "submitted", revision: 1 })));
    const { container } = render(<LiveSurveyScreen slug="kara-nualeaf" locale="ko" />);
    fireEvent.click(await screen.findByRole("radio", { name: "오프닝" }));
    fireEvent.click(screen.getByRole("radio", { name: "5" }));
    const submit = screen.getByRole("button", { name: "설문 제출하기" });
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "오프닝" })).toBeChecked();
      expect(screen.getByRole("radio", { name: "5" })).toBeChecked();
    });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    resolveSubmit(jsonResponse({ response: { status: "submitted", submittedAt: "2026-07-21T03:00:00.000Z", activityId: "3251919c-484a-4277-b81c-21e3905c61e4", scorePoints: 2, stamp: { id: "015c5177-0010-489f-857b-0ea31a986f48", businessStatus: "issued", mintStatus: "queued" } } }));
    expect(await screen.findByRole("heading", { name: "설문 참여가 완료되었습니다" })).toBeInTheDocument();
    expect(screen.getByText("Fan Score +2")).toBeInTheDocument();
    expect(screen.getByAltText("KARA Survey Stamp")).toHaveAttribute("src", expect.stringContaining("kara-survey-stamp.png"));
    expect(container.querySelector('[class*="stampArtwork"]')).toBeInTheDocument();
  });

  it("reconciles an already-submitted response instead of showing a false failure", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(payload()))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "SURVEY_ALREADY_SUBMITTED" } }, 409))
      .mockResolvedValueOnce(jsonResponse(payload({ status: "submitted", revision: 2 })));
    render(<LiveSurveyScreen slug="kara-nualeaf" locale="en" />);
    fireEvent.click(await screen.findByRole("radio", { name: "오프닝" }));
    fireEvent.click(screen.getByRole("radio", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit survey" }));
    expect(await screen.findByRole("heading", { name: "Survey complete" })).toBeInTheDocument();
    expect(screen.queryByText(/couldn’t submit/i)).not.toBeInTheDocument();
  });
});
