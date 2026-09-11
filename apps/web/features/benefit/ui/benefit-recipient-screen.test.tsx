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
  recipientRequired: method !== "digital" && status === "information_required",
  updatedAt: "2026-09-10T00:00:00.000Z",
  benefitHref: `/benefits/${benefitId}`,
});
const rewardsResponse = (item = reward()) => Response.json({ rewards: [item] });
const details = (overrides: Record<string, unknown> = {}) => ({
  winnerId,
  revision: 1,
  editable: true,
  deadlineAt: "2026-09-30T15:00:00.000Z",
  claimDisposition: "active",
  policy: { version: "v1", method: "physical_shipping", shippingCountry: "KR", requiresShippingAcknowledgment: true, recipientWindowDays: 7, pickupEndsOn: null, pickupVenue: { ko: "", en: "" }, pickupInstructions: { ko: "", en: "" } },
  recipient: null,
  ...overrides,
});
const pickupPolicy = { ...details().policy, method: "on_site_pickup", shippingCountry: null, requiresShippingAcknowledgment: false };
const detailsResponse = (overrides: Record<string, unknown> = {}) => Response.json(details(overrides));

function fillKoreanShipping() {
  fireEvent.change(screen.getByLabelText(/이름/), { target: { value: " 홍길동 " } });
  fireEvent.change(screen.getByLabelText(/연락처/), { target: { value: "010-1234-5678" } });
  fireEvent.change(screen.getByLabelText(/우편번호/), { target: { value: "04524" } });
  fireEvent.change(screen.getByLabelText(/^주소/), { target: { value: "서울시 중구" } });
  fireEvent.change(screen.getByLabelText(/상세 주소/), { target: { value: "101호" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /개인정보 수집·이용에 동의/ }));
}

afterEach(() => {
  authState.ready = true;
  authState.authenticated = true;
  authState.id = "owner-a";
  authState.token = "token";
  getAccessToken.mockClear();
  vi.unstubAllGlobals();
});

describe("Benefit recipient screen", () => {
  it("submits normalized Korean shipping fields with revision and confirms them by GET", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(rewardsResponse())
      .mockResolvedValueOnce(detailsResponse())
      .mockResolvedValueOnce(Response.json({ winnerId, method: "physical_shipping", status: "ready", revision: 2 }))
      .mockResolvedValueOnce(rewardsResponse(reward("physical_shipping", "ready")))
      .mockResolvedValueOnce(detailsResponse({ revision: 2, recipient: { name: "홍길동", phone: "+821012345678", phoneCountry: "KR", postalCode: "04524", address1: "서울시 중구", address2: "101호", shippingCountry: "KR" } }));
    vi.stubGlobal("fetch", fetcher);
    render(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);

    await screen.findByLabelText(/이름/);
    fillKoreanShipping();
    expect(screen.getByText("전화번호 뒤 4자리").nextSibling).toHaveTextContent("5678");
    const submit = screen.getByRole("button", { name: "수령 정보 전달하기" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(await screen.findByText("수령 정보를 전달했어요.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "수령 정보 확인·수정" })).toBeInTheDocument();
    const posts = fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String((posts[0][1] as RequestInit).body))).toEqual({
      consentVersion: "2026-09-raffle-v2", consented: true, name: "홍길동",
      phone: "+821012345678", phoneCountry: "KR", shippingCountry: "KR", expectedRevision: 1,
      postalCode: "04524", address1: "서울시 중구", address2: "101호",
    });
    expect(fetcher).toHaveBeenNthCalledWith(5, `/api/me/rewards/${winnerId}/recipient`, expect.objectContaining({ cache: "no-store" }));
  });

  it("supports a US contact for on-site pickup without shipping fields", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(rewardsResponse(reward("on_site_pickup"))).mockResolvedValueOnce(detailsResponse({ policy: pickupPolicy }))
      .mockResolvedValueOnce(Response.json({ winnerId, method: "on_site_pickup", status: "ready", revision: 2 }))
      .mockResolvedValueOnce(rewardsResponse(reward("on_site_pickup", "ready")))
      .mockResolvedValueOnce(detailsResponse({ policy: pickupPolicy, revision: 2, recipient: { name: "Alex Kim", phone: "+12133734253", phoneCountry: "US", postalCode: null, address1: null, address2: null, shippingCountry: null } }));
    vi.stubGlobal("fetch", fetcher);
    render(<BenefitRecipientScreen winnerId={winnerId} locale="en" />);

    fireEvent.change(await screen.findByLabelText(/Name/), { target: { value: "Alex Kim" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Country calling code" }));
    fireEvent.change(screen.getByPlaceholderText("Search country or calling code"), { target: { value: "United States" } });
    fireEvent.click(screen.getByRole("option", { name: /United StatesUS · \+1/ }));
    fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: "2133734253" } });
    expect(screen.queryByLabelText(/Postal code/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Submit recipient details" }));
    await screen.findByText("Your recipient details were submitted.");

    const post = fetcher.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
      consentVersion: "2026-09-raffle-v2", consented: true, name: "Alex Kim",
      phone: "+12133734253", phoneCountry: "US", expectedRevision: 1,
    });
  });

  it("revalidates the phone when its selected country changes", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(rewardsResponse()).mockResolvedValueOnce(detailsResponse());
    vi.stubGlobal("fetch", fetcher);
    render(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);
    await screen.findByLabelText(/이름/);
    fillKoreanShipping();
    fireEvent.click(screen.getByRole("combobox", { name: "국가번호" }));
    fireEvent.change(screen.getByPlaceholderText("국가명 또는 국가번호 검색"), { target: { value: "미국" } });
    fireEvent.click(screen.getByRole("option", { name: /미국US · \+1/ }));
    fireEvent.click(screen.getByRole("button", { name: "수령 정보 전달하기" }));
    expect(await screen.findByText("선택한 국가에 맞는 전화번호를 입력해 주세요.")).toBeInTheDocument();
    expect(fetcher.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("hydrates an editable Unicode recipient", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(rewardsResponse(reward("on_site_pickup", "ready")))
      .mockResolvedValueOnce(detailsResponse({ policy: pickupPolicy, recipient: { name: "山田 太郎", phone: "+819012345678", phoneCountry: "JP", postalCode: null, address1: null, address2: null, shippingCountry: null } })));
    render(<BenefitRecipientScreen winnerId={winnerId} locale="en" />);
    expect(await screen.findByRole("heading", { name: "Review recipient details" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).toHaveValue("山田 太郎");
    expect(screen.getByRole("combobox", { name: "Country calling code" })).toHaveTextContent("JP+81");
    expect(screen.getByText("Last 4 digits of phone number").nextSibling).toHaveTextContent("5678");
  });

  it("shows a passed deadline with support and does not auto-cancel the win", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(rewardsResponse()).mockResolvedValueOnce(detailsResponse({ editable: false, deadlineAt: "2026-09-10T00:00:00.000Z" })));
    render(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);
    expect(await screen.findByRole("heading", { name: "수령 정보 제출 기한이 지났어요." })).toBeInTheDocument();
    expect(screen.getByText(/당첨 이력은 유지돼요/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ByUs에 문의하기" })).toHaveAttribute("href", "mailto:biz@sallylab.io");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("removes the form after an explicit unclaimed closure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(rewardsResponse()).mockResolvedValueOnce(detailsResponse({ editable: false, claimDisposition: "unclaimed" })));
    render(<BenefitRecipientScreen winnerId={winnerId} locale="en" />);
    expect(await screen.findByRole("heading", { name: "Prize collection has closed." })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("locks POST after an uncertain response until both owner resources are confirmed", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(rewardsResponse()).mockResolvedValueOnce(detailsResponse())
      .mockResolvedValueOnce(Response.json({ error: { code: "REWARD_UNAVAILABLE" } }, { status: 503 }))
      .mockResolvedValueOnce(rewardsResponse()).mockResolvedValueOnce(Response.json({ error: { code: "RECIPIENT_UNAVAILABLE" } }, { status: 503 }))
      .mockResolvedValueOnce(rewardsResponse()).mockResolvedValueOnce(detailsResponse());
    vi.stubGlobal("fetch", fetcher);
    render(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);
    await screen.findByLabelText(/이름/);
    fillKoreanShipping();
    fireEvent.click(screen.getByRole("button", { name: "수령 정보 전달하기" }));

    expect(await screen.findByRole("button", { name: "제출 상태 다시 확인" })).toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "제출 상태 다시 확인" }));
    expect(await screen.findByRole("button", { name: "수령 정보 전달하기" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("focuses the first invalid field and does not call POST", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(rewardsResponse()).mockResolvedValueOnce(detailsResponse());
    vi.stubGlobal("fetch", fetcher);
    render(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);
    fireEvent.click(await screen.findByRole("button", { name: "수령 정보 전달하기" }));
    await waitFor(() => expect(screen.getByLabelText(/이름/)).toHaveFocus());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("clears the form and ignores an old owner response after account switching", async () => {
    let resolveOld: ((value: Response) => void) | undefined;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce(Response.json({ rewards: [] }));
    vi.stubGlobal("fetch", fetcher);
    const rendered = render(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    authState.id = "owner-b";
    rendered.rerender(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);
    resolveOld?.(rewardsResponse());
    expect(await screen.findByRole("heading", { name: "수령 정보를 확인할 수 없어요." })).toBeInTheDocument();
    expect(screen.queryByLabelText(/이름/)).not.toBeInTheDocument();
  });

  it("rejects a mismatched recipient response without rendering private fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(rewardsResponse()).mockResolvedValueOnce(detailsResponse({ winnerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", recipient: { name: "Other owner", phone: "+12133734253", phoneCountry: "US", postalCode: null, address1: null, address2: null, shippingCountry: null } })));
    render(<BenefitRecipientScreen winnerId={winnerId} locale="en" />);
    expect(await screen.findByRole("heading", { name: "We couldn’t load the recipient details." })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Other owner")).not.toBeInTheDocument();
  });

  it("keeps the locale-bearing recipient route through sign-in", async () => {
    authState.authenticated = false;
    vi.stubGlobal("fetch", vi.fn());
    render(<BenefitRecipientScreen winnerId={winnerId} locale="en" />);
    const link = await screen.findByRole("link", { name: "Sign in to continue" });
    expect(decodeURIComponent(link.getAttribute("href") ?? "")).toContain(`/my/rewards/${winnerId}/recipient?locale=en`);
  });
});

it("preserves legacy recipient submission without a policy", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(rewardsResponse()).mockResolvedValueOnce(detailsResponse({ policy: null }))
    .mockResolvedValueOnce(Response.json({ winnerId, method: "physical_shipping", status: "ready", revision: 2 }))
    .mockResolvedValueOnce(rewardsResponse(reward("physical_shipping", "ready"))).mockResolvedValueOnce(detailsResponse({ policy: null, revision: 2 }));
  vi.stubGlobal("fetch", fetcher); render(<BenefitRecipientScreen winnerId={winnerId} locale="ko" />);
  await screen.findByLabelText(/이름/); fillKoreanShipping(); fireEvent.click(screen.getByRole("button", { name: "수령 정보 전달하기" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(true));
  const post = fetcher.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
  const body = JSON.parse(String((post?.[1] as RequestInit).body));
  expect(body.phone).toBe("+821012345678"); expect(body).not.toHaveProperty("phoneCountry"); expect(body).not.toHaveProperty("shippingCountry"); expect(body).not.toHaveProperty("expectedRevision");
});
