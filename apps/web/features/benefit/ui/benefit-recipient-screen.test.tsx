import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BenefitRecipientScreen } from "./benefit-recipient-screen";

const winnerId = "11111111-1111-4111-8111-111111111111";
const benefitId = "22222222-2222-4222-8222-222222222222";
const authState = vi.hoisted(() => ({ ready: true, authenticated: true, id: "owner-a", token: "token" }));
const getAccessToken = vi.hoisted(() => vi.fn(async () => authState.token as string | null));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    ready: authState.ready,
    authenticated: authState.authenticated,
    user: authState.authenticated ? { id: authState.id } : null,
    getAccessToken,
  }),
}));

const reward = (method: "physical_shipping" | "on_site_pickup" | "digital" = "physical_shipping", status = "information_required") => ({
  rewardResultId: "33333333-3333-4333-8333-333333333333",
  winnerId,
  benefitId,
  title: method === "physical_shipping" ? "응원 키트" : method === "on_site_pickup" ? "Meet & Greet Pass" : "Digital reward",
  campaignId: "44444444-4444-4444-8444-444444444444",
  result: "won",
  method,
  status,
  enteredTickets: 3,
  recipientRequired: status === "information_required",
  updatedAt: "2026-09-10T00:00:00.000Z",
  benefitHref: `/benefits/${benefitId}`,
});
const rewardsResponse = (item = reward()) => Response.json({ rewards: [item] });

afterEach(() => {
  authState.ready = true;
  authState.authenticated = true;
  authState.id = "owner-a";
  authState.token = "token";
  getAccessToken.mockClear();
  vi.unstubAllGlobals();
});

describe("Benefit recipient screen", () => {
  it("submits the bounded Korean shipping fields once and confirms ready by GET", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(rewardsResponse())
      .mockResolvedValueOnce(Response.json({ winnerId, method: "physical_shipping", status: "ready", revision: 2 }))
      .mockResolvedValueOnce(rewardsResponse(reward("physical_shipping", "ready")));
    vi.stubGlobal("fetch", fetcher);
    render(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);

    fireEvent.change(await screen.findByLabelText(/이름/), { target: { value: " 홍길동 " } });
    fireEvent.change(screen.getByLabelText(/연락처/), { target: { value: "010-1234-5678" } });
    fireEvent.change(screen.getByLabelText(/우편번호/), { target: { value: "12345" } });
    fireEvent.change(screen.getByLabelText(/^주소/), { target: { value: "서울시 중구" } });
    fireEvent.change(screen.getByLabelText(/상세 주소/), { target: { value: "101호" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /개인정보 수집·이용에 동의/ }));
    const submit = screen.getByRole("button", { name: "수령 정보 전달하기" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(await screen.findByRole("heading", { name: "수령 정보를 전달했어요." })).toBeInTheDocument();
    const posts = fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String((posts[0][1] as RequestInit).body))).toEqual({
      consentVersion: "2026-09-v1",
      consented: true,
      name: "홍길동",
      phone: "010-1234-5678",
      postalCode: "12345",
      address1: "서울시 중구",
      address2: "101호",
    });
    expect(fetcher).toHaveBeenNthCalledWith(3, "/api/me/rewards?locale=ko", expect.objectContaining({ cache: "no-store" }));
  });

  it("renders and sends only name and phone for English on-site pickup", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(rewardsResponse(reward("on_site_pickup")))
      .mockResolvedValueOnce(Response.json({ winnerId, method: "on_site_pickup", status: "ready", revision: 2 }))
      .mockResolvedValueOnce(rewardsResponse(reward("on_site_pickup", "ready")));
    vi.stubGlobal("fetch", fetcher);
    render(<BenefitRecipientScreen winnerId={winnerId} locale="en" />);

    fireEvent.change(await screen.findByLabelText(/Name/), { target: { value: "Alex Kim" } });
    fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: "+82 10 1234 5678" } });
    expect(screen.queryByLabelText(/Postal code/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Privacy Policy" })).toHaveAttribute("href", "/privacy?locale=en");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Submit recipient details" }));
    await screen.findByRole("heading", { name: "Your recipient details were submitted." });

    const post = fetcher.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
      consentVersion: "2026-09-v1",
      consented: true,
      name: "Alex Kim",
      phone: "+82 10 1234 5678",
    });
  });

  it("locks POST after an uncertain response and GET failure until status is confirmed", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(rewardsResponse())
      .mockResolvedValueOnce(Response.json({ error: { code: "REWARD_UNAVAILABLE" } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ error: { code: "REWARDS_UNAVAILABLE" } }, { status: 503 }))
      .mockResolvedValueOnce(rewardsResponse());
    vi.stubGlobal("fetch", fetcher);
    render(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);

    fireEvent.change(await screen.findByLabelText(/이름/), { target: { value: "홍길동" } });
    fireEvent.change(screen.getByLabelText(/연락처/), { target: { value: "01012345678" } });
    fireEvent.change(screen.getByLabelText(/우편번호/), { target: { value: "12345" } });
    fireEvent.change(screen.getByLabelText(/^주소/), { target: { value: "서울" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "수령 정보 전달하기" }));

    expect(await screen.findByRole("button", { name: "제출 상태 다시 확인" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "수령 정보 전달하기" })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "제출 상태 다시 확인" }));
    expect(await screen.findByRole("button", { name: "수령 정보 전달하기" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(1);
  });

  it("focuses the first invalid field and does not call POST", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(rewardsResponse());
    vi.stubGlobal("fetch", fetcher);
    render(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);
    const submit = await screen.findByRole("button", { name: "수령 정보 전달하기" });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByLabelText(/이름/)).toHaveFocus());
    expect(screen.getByLabelText(/이름/)).toHaveAttribute("aria-invalid", "true");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("shows completed status without rendering or reading back PII", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(rewardsResponse(reward("physical_shipping", "shipping_in_transit"))));
    render(<BenefitRecipientScreen winnerId={winnerId} locale="en" />);
    expect(await screen.findByRole("heading", { name: "Your recipient details were submitted." })).toBeInTheDocument();
    expect(screen.getByText("In transit")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it.each([
    ["ko", "ready", "이 혜택은 수령 정보를 입력하지 않아도 돼요."],
    ["en", "digital_delivered", "This reward does not need recipient details."],
  ] as const)("does not claim recipient submission for a %s digital reward in %s", async (locale, status, heading) => {
    const digital = { ...reward("digital", status), recipientRequired: false };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(rewardsResponse(digital)));
    render(<BenefitRecipientScreen winnerId={winnerId} locale={locale} />);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it("clears the form and ignores an old owner response after account switching", async () => {
    let resolveOld: ((value: Response) => void) | undefined;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(Response.json({ rewards: [] }));
    vi.stubGlobal("fetch", fetcher);
    const rendered = render(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    authState.id = "owner-b";
    rendered.rerender(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);
    resolveOld?.(rewardsResponse());
    expect(await screen.findByRole("heading", { name: "수령 정보를 확인할 수 없어요." })).toBeInTheDocument();
    expect(screen.queryByLabelText(/이름/)).not.toBeInTheDocument();
  });

  it("keeps the locale-bearing recipient route through sign-in", async () => {
    authState.authenticated = false;
    vi.stubGlobal("fetch", vi.fn());
    render(<BenefitRecipientScreen winnerId={winnerId} locale="en" />);
    const link = await screen.findByRole("link", { name: "Sign in to continue" });
    expect(link.getAttribute("href")).toContain("/login?");
    expect(decodeURIComponent(link.getAttribute("href") ?? "")).toContain(`/my/rewards/${winnerId}/recipient?locale=en`);
  });

  it("recovers from an initial access-token rejection without staying in loading", async () => {
    getAccessToken.mockRejectedValueOnce(new Error("token unavailable"));
    const fetcher = vi.fn().mockResolvedValueOnce(rewardsResponse());
    vi.stubGlobal("fetch", fetcher);
    render(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);

    const retry = await screen.findByRole("button", { name: "다시 시도" });
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(await screen.findByLabelText(/이름/)).toBeInTheDocument();
  });

  it("keeps submission retryable when token acquisition fails before POST", async () => {
    getAccessToken.mockResolvedValueOnce("token").mockRejectedValueOnce(new Error("token unavailable"));
    const fetcher = vi.fn().mockResolvedValueOnce(rewardsResponse());
    vi.stubGlobal("fetch", fetcher);
    render(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);

    fireEvent.change(await screen.findByLabelText(/이름/), { target: { value: "홍길동" } });
    fireEvent.change(screen.getByLabelText(/연락처/), { target: { value: "01012345678" } });
    fireEvent.change(screen.getByLabelText(/우편번호/), { target: { value: "12345" } });
    fireEvent.change(screen.getByLabelText(/^주소/), { target: { value: "서울" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "수령 정보 전달하기" }));

    expect(await screen.findByText("수령 정보를 불러오지 못했어요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "수령 정보 전달하기" })).toBeEnabled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not unlock POST when locale changes during an uncertain submission", async () => {
    let resolvePost: ((value: Response) => void) | undefined;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(rewardsResponse())
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolvePost = resolve; }))
      .mockResolvedValueOnce(rewardsResponse(reward("physical_shipping", "ready")));
    vi.stubGlobal("fetch", fetcher);
    const rendered = render(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);
    fireEvent.change(await screen.findByLabelText(/이름/), { target: { value: "홍길동" } });
    fireEvent.change(screen.getByLabelText(/연락처/), { target: { value: "01012345678" } });
    fireEvent.change(screen.getByLabelText(/우편번호/), { target: { value: "12345" } });
    fireEvent.change(screen.getByLabelText(/^주소/), { target: { value: "서울" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "수령 정보 전달하기" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(true));

    rendered.rerender(<BenefitRecipientScreen winnerId={winnerId} locale="en" />);
    expect(screen.queryByRole("button", { name: "Submit recipient details" })).not.toBeInTheDocument();
    resolvePost?.(Response.json({ error: { code: "REWARD_UNAVAILABLE" } }, { status: 503 }));
    expect(await screen.findByRole("heading", { name: "Your recipient details were submitted." })).toBeInTheDocument();
    expect(fetcher).toHaveBeenNthCalledWith(3, "/api/me/rewards?locale=en", expect.anything());
    expect(fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(1);
  });

  it("uses the latest locale for confirmation and retry copy after a submission", async () => {
    let resolvePost: ((value: Response) => void) | undefined;
    const englishReward = { ...reward(), title: "English reward" };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(rewardsResponse())
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolvePost = resolve; }))
      .mockResolvedValueOnce(Response.json({ error: { code: "REWARDS_UNAVAILABLE" } }, { status: 503 }))
      .mockResolvedValueOnce(rewardsResponse(englishReward));
    vi.stubGlobal("fetch", fetcher);
    const rendered = render(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);
    fireEvent.change(await screen.findByLabelText(/이름/), { target: { value: "홍길동" } });
    fireEvent.change(screen.getByLabelText(/연락처/), { target: { value: "01012345678" } });
    fireEvent.change(screen.getByLabelText(/우편번호/), { target: { value: "12345" } });
    fireEvent.change(screen.getByLabelText(/^주소/), { target: { value: "서울" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "수령 정보 전달하기" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(true));

    rendered.rerender(<BenefitRecipientScreen winnerId={winnerId} locale="en" />);
    await screen.findByText("Checking your submission status.");
    resolvePost?.(Response.json({ error: { code: "REWARD_UNAVAILABLE" } }, { status: 503 }));

    expect(await screen.findByRole("button", { name: "Check submission status" })).toBeInTheDocument();
    expect(screen.getByText("Check the current status before trying again to prevent a duplicate submission.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check submission status" }));
    expect(await screen.findByText("English reward")).toBeInTheDocument();
    expect(screen.getByText("Status confirmed. You can submit again.")).toBeInTheDocument();
    expect(fetcher).toHaveBeenNthCalledWith(3, "/api/me/rewards?locale=en", expect.anything());
    expect(fetcher).toHaveBeenNthCalledWith(4, "/api/me/rewards?locale=en", expect.anything());
  });

  it("ignores an aborted old-locale token read after the new locale is ready", async () => {
    let rejectOldToken: ((reason: Error) => void) | undefined;
    getAccessToken
      .mockImplementationOnce(() => new Promise<string>((_resolve, reject) => { rejectOldToken = reject; }))
      .mockResolvedValueOnce("token");
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const item = { ...reward(), title: String(input).includes("locale=en") ? "English reward" : "한국어 혜택" };
      return rewardsResponse(item);
    });
    vi.stubGlobal("fetch", fetcher);
    const rendered = render(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);
    rendered.rerender(<BenefitRecipientScreen winnerId={winnerId} locale="en" />);
    expect(await screen.findByText("English reward")).toBeInTheDocument();
    rejectOldToken?.(new Error("old token failed"));
    await waitFor(() => expect(screen.queryByText("We couldn’t load the recipient details.")).not.toBeInTheDocument());
    expect(screen.getByText("English reward")).toBeInTheDocument();
  });
});
