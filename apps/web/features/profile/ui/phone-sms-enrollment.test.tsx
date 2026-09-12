import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhoneSmsEnrollment } from "./phone-sms-enrollment";
const id = "11111111-1111-4111-8111-111111111111";
const channel = { id, kind: "kakao", status: "eligible", consented: true, destinationLabel: "010-****-5678", verifiedAt: "2026-09-13T00:00:00Z" };
function setup(options: { unknown?: boolean; failRequest?: boolean; wrongCode?: boolean } = {}) {
  const send = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url.endsWith("/request")) {
      if (options.failRequest) throw new Error("network");
      return Response.json({ challenge: { challengeId: id, destinationLabel: "010-****-5678", expiresAt: new Date(Date.now() + 300000).toISOString(), resendAt: new Date(Date.now() + 60000).toISOString(), status: options.unknown ? "unknown" : "accepted" } });
    }
    if (url.endsWith("/verify")) return options.wrongCode ? Response.json({ error: { code: "PHONE_SMS_ATTEMPTS_EXHAUSTED" } }, { status: 400 }) : Response.json({ verified: true });
    if (url.endsWith("/confirm")) { expect(body.consented).toBe(true); return Response.json({ channel }); }
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", send);
  const onRegistered = vi.fn();
  const props = { locale: "ko" as const, getAccessToken: async () => "token", acquire: () => true, release: vi.fn(), onRegistered };
  render(<PhoneSmsEnrollment {...props} />);
  return { send, onRegistered, options };
}
async function request() {
  fireEvent.change(screen.getByLabelText("휴대폰 번호"), { target: { value: "01012345678" } });
  fireEvent.click(screen.getByRole("button", { name: "인증번호 받기" }));
  await screen.findByLabelText("문자로 받은 인증번호");
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("manual phone enrollment", () => {
  it("verifies a phone without OAuth and requires a separate unchecked consent before registration", async () => {
    const { send, onRegistered } = setup(); await request();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(send.mock.calls.some(([url]) => url.includes("kakao/start"))).toBe(false);
    fireEvent.change(screen.getByLabelText("문자로 받은 인증번호"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "인증번호 확인" }));
    const consent = await screen.findByRole("checkbox"); expect(consent).not.toBeChecked();
    const confirm = screen.getByRole("button", { name: "이 번호로 알림톡 등록" }); expect(confirm).toBeDisabled();
    expect(onRegistered).not.toHaveBeenCalled(); fireEvent.click(consent); fireEvent.click(confirm);
    await screen.findByText("알림톡 수신 번호를 등록했어요."); expect(onRegistered).toHaveBeenCalledWith(channel);
  });
  it("cancels the previous challenge before changing the phone", async () => {
    const { send } = setup(); await request(); fireEvent.click(screen.getByRole("button", { name: "번호 변경" }));
    await screen.findByLabelText("휴대폰 번호");
    expect(send.mock.calls.find(([url]) => url.endsWith("/cancel"))?.[1].body).toBe(JSON.stringify({ challengeId: id }));
    expect(screen.queryByLabelText("문자로 받은 인증번호")).not.toBeInTheDocument();
  });
  it("keeps a request identity across a network retry and prevents duplicate clicks", async () => {
    const { send, options } = setup({ failRequest: true });
    fireEvent.change(screen.getByLabelText("휴대폰 번호"), { target: { value: "01012345678" } });
    const button = screen.getByRole("button", { name: "인증번호 받기" }); fireEvent.click(button); fireEvent.click(button);
    await screen.findByText("요청을 완료하지 못했어요. 다시 시도해 주세요.");
    expect(send).toHaveBeenCalledTimes(1); options.failRequest = false; fireEvent.click(button);
    await screen.findByLabelText("문자로 받은 인증번호");
    expect(JSON.parse(String(send.mock.calls[0][1].body)).requestId).toBe(JSON.parse(String(send.mock.calls[1][1].body)).requestId);
  });
  it("allows an arrived code after ambiguous submission and locks after five wrong attempts", async () => {
    setup({ unknown: true, wrongCode: true }); await request();
    expect(screen.getByText(/문자 접수 결과를 확인하지 못했어요/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("문자로 받은 인증번호"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "인증번호 확인" }));
    await screen.findByText("입력 횟수를 초과했어요. 인증번호를 다시 받아 주세요.");
    expect(screen.getByRole("button", { name: "인증번호 확인" })).toBeDisabled();
  });
  it("expires using server deadline and never automatically resends", async () => {
    const { send } = setup(); await request();
    vi.useFakeTimers(); await act(async () => { vi.setSystemTime(Date.now() + 301000); vi.advanceTimersByTime(1000); });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByRole("button", { name: "인증번호 확인" })).toBeDisabled());
    expect(send).toHaveBeenCalledTimes(1);
  });
});
