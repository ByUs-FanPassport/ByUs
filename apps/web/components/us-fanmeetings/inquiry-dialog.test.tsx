import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FanmeetingInquiryProvider, InquiryButton } from "./inquiry-dialog";

function renderInquiry(locale: "ko" | "en" = "ko") {
  render(<FanmeetingInquiryProvider locale={locale}><InquiryButton>Open inquiry</InquiryButton><InquiryButton>Second entry</InquiryButton></FanmeetingInquiryProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Open inquiry" }));
}

async function fillValid(locale: "ko" | "en" = "ko") {
  fireEvent.change(await screen.findByLabelText(locale === "ko" ? "담당자명" : "Contact name"), { target: { value: "Jewel" } });
  fireEvent.change(screen.getByLabelText(locale === "ko" ? "회사명" : "Company"), { target: { value: "Sally Lab" } });
  fireEvent.change(screen.getByLabelText(locale === "ko" ? "회신 이메일" : "Reply email"), { target: { value: "jewel@example.com" } });
  fireEvent.change(screen.getByLabelText(locale === "ko" ? "문의 내용" : "Project details"), { target: { value: "New York fan meeting" } });
  fireEvent.click(screen.getByRole("checkbox"));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Fanmeeting inquiry dialog", () => {
  it("submits the normalized payload once and clears the next form after acceptance", async () => {
    vi.spyOn(window.crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
    const request = vi.fn().mockResolvedValue(Response.json({ status: "accepted" }, { status: 202 }));
    vi.stubGlobal("fetch", request);
    renderInquiry();
    await fillValid();
    fireEvent.click(screen.getByRole("button", { name: "문의 접수하기" }));
    expect(await screen.findByRole("heading", { name: "문의가 접수됐어요" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "확인" })).toHaveFocus();
    const [, init] = request.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      locale: "ko", name: "Jewel", company: "Sally Lab", email: "jewel@example.com", message: "New York fan meeting", consent: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    fireEvent.click(screen.getByRole("button", { name: "Second entry" }));
    expect(await screen.findByLabelText("담당자명")).toHaveValue("");
  });

  it("keeps the draft across an API error, close, and another trigger", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "INQUIRY_RATE_LIMITED" } }, { status: 429 })));
    renderInquiry();
    await fillValid();
    fireEvent.click(screen.getByRole("button", { name: "문의 접수하기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
    fireEvent.click(screen.getByRole("button", { name: "문의창 닫기" }));
    fireEvent.click(screen.getByRole("button", { name: "Second entry" }));
    expect(await screen.findByLabelText("문의 내용")).toHaveValue("New York fan meeting");
  });

  it("reuses the idempotency key after a timeout and retry with identical input", async () => {
    vi.spyOn(window.crypto, "randomUUID").mockReturnValue("22222222-2222-4222-8222-222222222222");
    const request = vi.fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }))
      .mockResolvedValueOnce(Response.json({ status: "accepted" }, { status: 200 }));
    vi.stubGlobal("fetch", request);
    renderInquiry();
    await fillValid();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "문의 접수하기" }));
    expect(screen.getByRole("button", { name: "접수 중" })).toBeDisabled();
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("응답이 지연되고 있어요.");
    fireEvent.click(screen.getByRole("button", { name: "문의 접수하기" }));
    await act(async () => { await Promise.resolve(); });
    const keys = request.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).idempotencyKey);
    expect(keys).toEqual(["22222222-2222-4222-8222-222222222222", "22222222-2222-4222-8222-222222222222"]);
  });

  it("creates a new key after the payload changes and renders English labels", async () => {
    vi.spyOn(window.crypto, "randomUUID")
      .mockReturnValueOnce("33333333-3333-4333-8333-333333333333")
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444");
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { code: "INQUIRY_INVALID" } }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ status: "accepted" }, { status: 202 }));
    vi.stubGlobal("fetch", request);
    renderInquiry("en");
    await fillValid("en");
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please review");
    fireEvent.change(screen.getByLabelText("Project details"), { target: { value: "Los Angeles fan meeting" } });
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const keys = request.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).idempotencyKey);
    expect(keys).toEqual(["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"]);
  });
});
