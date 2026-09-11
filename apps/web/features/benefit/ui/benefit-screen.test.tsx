import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BenefitDetailOverlay,
  BenefitDetailScreen,
  BenefitsScreen,
} from "./benefit-screen";
import { createAuthIntent, persistAuthIntent } from "@/components/auth-intent";

const getAccessToken = vi.fn(async () => "token");
const routerBack = vi.hoisted(() => vi.fn());
let authenticated = true;
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated, getAccessToken }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/benefits",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ back: routerBack, replace: vi.fn() }),
}));

const benefit = {
  id: "819b52d9-62c3-450c-b3dc-78d84d2238c6",
  slug: "fan-call",
  title: "KARA 영상 메시지",
  summary: "함께한 기록을 위한 영상 메시지",
  eligibilityLabel: "Gold 이상",
  deliveryLabel: "수령 후 코드 제공",
  deliveryType: "unique_code",
  allocationMode: "direct_claim",
  applicationStatus: null,
  claimOpensAt: "2026-07-20T00:00:00.000Z",
  claimClosesAt: "2026-08-20T00:00:00.000Z",
  minimumScore: 10,
  minimumLevel: "Gold",
  requiredStampType: null,
  requiredActivityType: null,
  state: "eligible",
} as const;
const ifewBenefit = {
  ...benefit,
  id: "41ae7883-098e-49f2-9229-4f6962160141",
  slug: "ifew-banksy-tickets-20260912",
  title: "뱅크시 전시 티켓",
  summary: "이퓨의 틱톡 100일 기념 LIVE 혜택",
  eligibilityLabel: "이퓨 응모권으로 응모하세요.",
  deliveryLabel: "당첨자 10명에게 1장씩 지급합니다.",
  allocationMode: "application_selection",
  minimumScore: 0,
  minimumLevel: "Bronze",
  state: "eligible",
  entry: {
    campaignId: "55555555-5555-4555-8555-555555555555",
    creatorTicketBalance: 0,
    enteredTickets: 0,
    perFanTicketLimit: null,
    remainingBenefitTickets: null,
    entryOpensAt: "2020-01-01T00:00:00.000Z",
    entryClosesAt: "2099-01-01T00:00:00.000Z",
    canEnter: true,
    entries: [],
  },
} as const;
const celebrities = { celebrities: [{ slug: "kara", name: "KARA" }] };

describe("benefit screens", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    routerBack.mockReset();
    authenticated = true;
    sessionStorage.clear();
    window.history.replaceState({}, "", "/benefits");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });
  });
  it("opens the intercepted detail as a labelled drawer and closes through browser history", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ benefit })),
    );
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    render(
      <BenefitDetailOverlay
        benefitId={benefit.id}
        locale="ko"
        celebrity="kara"
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "혜택 정보" });
    expect(dialog).toHaveAttribute("data-variant", "drawer");
    const close = screen.getByRole("button", { name: "혜택 정보 닫기" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.click(close);
    expect(routerBack).toHaveBeenCalledTimes(1);
  });
  it("uses a bottom sheet on mobile and handles Escape with router.back", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ benefit })),
    );
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    render(<BenefitDetailOverlay benefitId={benefit.id} locale="en" />);

    const dialog = await screen.findByRole("dialog", {
      name: "Benefit details",
    });
    await waitFor(() =>
      expect(dialog).toHaveAttribute("data-variant", "bottom-sheet"),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(routerBack).toHaveBeenCalledTimes(1);
  });
  it("keeps the overlay open while a benefit mutation is pending", async () => {
    let resolveClaim!: (response: Response) => void;
    const claimResponse = new Promise<Response>((resolve) => {
      resolveClaim = resolve;
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ benefit })))
      .mockImplementationOnce(() => claimResponse);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    render(<BenefitDetailOverlay benefitId={benefit.id} locale="ko" />);
    fireEvent.click(
      await screen.findByRole("button", { name: /혜택 수령하기/ }),
    );
    const dialog = screen.getByRole("dialog", { name: "혜택 정보" });
    const close = screen.getByRole("button", { name: "혜택 정보 닫기" });
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "true"));
    expect(close).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(dialog.parentElement!);
    expect(routerBack).not.toHaveBeenCalled();

    resolveClaim(
      new Response(
        JSON.stringify({
      claimId: "a1f86df9-f5e4-4ee1-b375-d18092b63e6a",
      benefitId: benefit.id,
      deliveryType: "unique_code",
      deliveryValue: "SECRET-42",
      claimedAt: "2026-07-21T00:00:00.000Z",
      replayed: false,
        }),
      ),
    );
    await waitFor(() => expect(dialog).not.toHaveAttribute("aria-busy"));
  });
  it("loads API celebrities and benefits, preserving locale and celebrity in detail routes", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(celebrities)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ benefits: [benefit] })),
      );
    render(<BenefitsScreen locale="ko" />);
    const currentMyLinks = screen
      .getAllByRole("link", { name: "MY" })
      .filter((link) => link.hasAttribute("aria-current"));
    expect(currentMyLinks).toHaveLength(2);
    for (const currentLink of currentMyLinks) {
      expect(currentLink).toHaveAttribute("aria-current", "page");
    }
    expect(
      await screen.findByRole("heading", { name: "KARA 영상 메시지" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /혜택 자세히 보기/ }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("locale=ko&celebrity=kara"),
    );
  });
  it("synchronizes a successful overlay action with the preserved background card", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(celebrities)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ benefits: [benefit] })),
      );
    render(<BenefitsScreen locale="ko" />);
    expect(await screen.findByText("수령 가능")).toBeInTheDocument();

    window.dispatchEvent(
      new CustomEvent("byus:benefit-updated", {
        detail: {
          id: benefit.id,
          state: "claimed",
          applicationStatus: null,
        },
      }),
    );

    expect(await screen.findByText("수령 완료")).toBeInTheDocument();
    expect(screen.queryByText("수령 가능")).not.toBeInTheDocument();
  });
  it("keeps the direct detail presentation as a full page with its own return link", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ benefit })),
    );
    render(
      <BenefitDetailScreen
        benefitId={benefit.id}
        locale="ko"
        celebrity="kara"
      />,
    );

    expect(
      await screen.findByRole("heading", { name: benefit.title }),
    ).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "혜택 목록" })).toHaveAttribute(
      "href",
      "/benefits?locale=ko&celebrity=kara",
    );
  });
  it("localizes known Korean benefit terms and presents the claim period as two scannable rows", async () => {
    const expiredBenefit = {
      ...benefit,
      state: "expired" as const,
      minimumLevel: "Bronze",
      eligibilityLabel: "Survey Stamp 보유",
      deliveryLabel: "공식 YouTube URL",
      requiredStampType: "survey",
      requiredActivityType: "survey",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ benefit: expiredBenefit })),
    );

    render(<BenefitDetailScreen benefitId={benefit.id} locale="ko" />);

    expect(await screen.findByText("설문 도장 보유")).toBeInTheDocument();
    expect(screen.getByText("브론즈")).toBeInTheDocument();
    expect(screen.getAllByText("설문")).toHaveLength(2);
    expect(screen.getByText("공식 YouTube 링크")).toBeInTheDocument();
    expect(screen.getByText("시작")).toBeInTheDocument();
    expect(screen.getByText("마감")).toBeInTheDocument();
    expect(
      screen.getByText("이 혜택은 수령 기간이 끝났어요."),
    ).toBeInTheDocument();
  });
  it("renders a useful empty state", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(celebrities)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ benefits: [] })));
    render(<BenefitsScreen locale="ko" initialCelebrity="kara" />);
    expect(
      await screen.findByText("이 셀럽의 공개된 혜택이 아직 없어요."),
    ).toBeInTheDocument();
  });
  it("claims once on rapid clicks and reveals the delivery secret only after success", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ benefit })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            claimId: "a1f86df9-f5e4-4ee1-b375-d18092b63e6a",
            benefitId: benefit.id,
            deliveryType: "unique_code",
            deliveryValue: "SECRET-42",
            claimedAt: "2026-07-21T00:00:00.000Z",
            replayed: false,
          }),
        ),
      );
    render(
      <BenefitDetailScreen
        benefitId={benefit.id}
        locale="ko"
        celebrity="kara"
      />,
    );
    const button = await screen.findByRole("button", { name: /혜택 수령하기/ });
    expect(screen.queryByText("SECRET-42")).not.toBeInTheDocument();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByText("SECRET-42")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const claimCall = fetchMock.mock.calls[1];
    expect(claimCall[0]).toContain("/claim");
    expect(JSON.parse(String(claimCall[1]?.body))).toEqual({
      idempotencyKey: expect.any(String),
    });
  });
  it("uses the creator in the incoming link instead of the first creator", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ celebrities: [{ slug: "elina", name: "엘리나" }, { slug: "ifewknow", name: "이퓨" }] }))
      .mockResolvedValueOnce(Response.json({ benefits: [benefit] }));
    render(<BenefitsScreen locale="ko" initialCelebrity="ifewknow" />);
    await screen.findByRole("heading", { name: benefit.title });
    expect(screen.getByRole("combobox")).toHaveValue("ifewknow");
    expect(fetchMock).toHaveBeenCalledWith("/api/benefits?locale=ko&celebrity=ifewknow", expect.anything());
  });
  it("distinguishes raffle entry eligibility and uses its exact KST deadline", async () => {
    const raffle = {
      ...benefit,
      allocationMode: "application_selection",
      eligibilityLabel: "이퓨 응모권으로 9월 19일 밤 12시(KST)까지 응모하세요.",
      entry: {
        campaignId: "55555555-5555-4555-8555-555555555555",
        creatorTicketBalance: 1, enteredTickets: 1, perFanTicketLimit: null, remainingBenefitTickets: null,
        entryOpensAt: "2026-09-09T08:53:24.796Z", entryClosesAt: "2026-09-19T15:00:00Z",
        canEnter: true, entries: [],
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ benefit: raffle }));
    render(<BenefitDetailScreen benefitId={benefit.id} locale="ko" />);
    expect(await screen.findByText("응모 가능")).toBeInTheDocument();
    expect(screen.queryByText("수령 가능")).not.toBeInTheDocument();
    const deadline = screen.getByText("응모 마감").nextElementSibling;
    expect(deadline).toHaveTextContent("2026년 9월 20일 00:00 (KST)");
    expect(deadline?.querySelector("time")).toHaveAttribute("datetime", raffle.entry.entryClosesAt);
    expect(screen.getByText("이퓨 응모권으로 2026년 9월 20일 00:00 (KST)까지 응모하세요.")).toBeInTheDocument();
    expect(screen.queryByText(/밤 12시/)).not.toBeInTheDocument();
    expect(screen.getByText("필요 팬 점수")).toBeInTheDocument();
    expect(screen.getByText("필요 등급")).toBeInTheDocument();
  });
  it("gives a first-time IfeW fan with no raffle tickets a truthful next action", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ benefit: ifewBenefit }),
    );

    render(<BenefitDetailScreen benefitId={ifewBenefit.id} locale="ko" />);

    expect(
      await screen.findByRole("heading", {
        name: "더현대 서울 뱅크시 전시 관람권",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("현재 보유한 응모권이 없어요.")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByText("필요 팬 점수")).not.toBeInTheDocument();
    expect(screen.queryByText("필요 등급")).not.toBeInTheDocument();
    expect(
      screen.getByText(/받은 응모권은 수량을 선택해 직접 응모해야 해요/),
    ).toBeInTheDocument();
    const nextAction = screen.getByRole("link", {
      name: "팬 인증하고 LIVE 참여하기",
    });
    expect(nextAction).toHaveAttribute("data-fan-action-emphasis", "primary");
    expect(nextAction).toHaveAttribute(
      "href",
      "/c/ifewknow/verify?locale=ko&returnTo=%2Flive%2Fifew-100-days-tiktok-20260912%3Flocale%3Dko",
    );
  });
  it("keeps prior IfeW entry history when the current balance is zero", async () => {
    const entered = {
      ...ifewBenefit,
      entry: {
        ...ifewBenefit.entry,
        enteredTickets: 3,
        entries: [
          {
            entryId: "44444444-4444-4444-8444-444444444444",
            ticketAmount: 3,
            enteredAt: "2026-09-10T00:00:00.000Z",
          },
        ],
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ benefit: entered }),
    );

    render(<BenefitDetailScreen benefitId={entered.id} locale="ko" />);

    expect(await screen.findByText("현재 보유한 응모권이 없어요.")).toBeInTheDocument();
    expect(screen.getByText("보유 응모권").nextElementSibling).toHaveTextContent("0");
    expect(screen.getByText("이 혜택의 응모 수").nextElementSibling).toHaveTextContent("3");
    expect(screen.getByRole("heading", { name: "응모 이력" })).toBeInTheDocument();
    expect(screen.getByText(/3 응모/)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "팬 인증하고 LIVE 참여하기" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "이퓨 LIVE 자세히 보기" }),
    ).toHaveAttribute("href", "/live/ifew-100-days-tiktok-20260912?locale=ko");
  });
  it("enters campaign Tickets once on rapid clicks and refreshes balance and history", async () => {
    let resultRefreshes = 0;
    let entryDone = false;
    let resolveEntry!: (response: Response) => void;
    const entryResponse = new Promise<Response>((resolve) => {
      resolveEntry = resolve;
    });
    const campaignBenefit = {
      ...benefit,
      entry: {
        campaignId: "55555555-5555-4555-8555-555555555555",
        creatorTicketBalance: 25,
        enteredTickets: 3,
        perFanTicketLimit: null,
        remainingBenefitTickets: null,
        entryOpensAt: "2020-01-01T00:00:00.000Z",
        entryClosesAt: "2099-01-01T00:00:00.000Z",
        canEnter: true,
        entries: [],
      },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/result?locale=ko")) { resultRefreshes += 1; return Promise.resolve(Response.json({
        benefitId: benefit.id, campaignId: campaignBenefit.entry.campaignId, title: benefit.title, benefitHref: `/benefits/${benefit.id}`,
        state: "pending", enteredTickets: entryDone ? 5 : 3, entryClosesAt: campaignBenefit.entry.entryClosesAt,
        publishedAt: null, winnerId: null, method: "digital", fulfillmentStatus: null, claimDisposition: "active",
        recipientDeadlineAt: null, recipientSubmitted: false, recipientEditable: false, policy: null,
      })); }
      if (url.endsWith("/entries")) return entryResponse;
      return Promise.resolve(new Response(JSON.stringify({ benefit: campaignBenefit })));
    });
    render(<BenefitDetailScreen benefitId={benefit.id} locale="ko" />);
    const amount = await screen.findByRole("spinbutton", {
      name: "사용할 응모권 수",
    });
    fireEvent.change(amount, { target: { value: "2" } });
    fireEvent.click(
      screen.getByRole("button", { name: "응모권으로 응모하기" }),
    );
    expect(
      await screen.findByRole("heading", { name: "응모권 사용 확인" }),
    ).toBeInTheDocument();
    expect(screen.getByText("현재 보유").nextElementSibling).toHaveTextContent(
      "25",
    );
    expect(screen.getByText("이번 차감").nextElementSibling).toHaveTextContent(
      "-2",
    );
    expect(
      screen.getByText("응모 후 잔액").nextElementSibling,
    ).toHaveTextContent("23");
    const confirm = screen.getByRole("button", {
      name: "이 수량으로 응모 확정",
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/entries"))).toBe(true));
    entryDone = true;
    resolveEntry(
      new Response(
        JSON.stringify({
      entryId: "44444444-4444-4444-8444-444444444444",
      benefitId: benefit.id,
      campaignId: "55555555-5555-4555-8555-555555555555",
      ticketAmount: 2,
      benefitTicketTotal: 5,
      perFanTicketLimit: null,
      remainingBenefitTickets: null,
      ticketLedgerId: "66666666-6666-4666-8666-666666666666",
      resultingBalance: 23,
      replayed: false,
        }),
      ),
    );
    expect(await screen.findByText("응모가 완료됐어요")).toBeInTheDocument();
    await waitFor(() => expect(resultRefreshes).toBeGreaterThanOrEqual(2));
    expect(screen.getByText("사용한 응모권").nextElementSibling).toHaveTextContent("5");
    expect(screen.getAllByText(/2 응모/)).toHaveLength(2);
    expect(screen.getAllByText("23").length).toBeGreaterThan(0);
    const call = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/entries"))!;
    expect(call[0]).toContain("/entries");
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({
      ticketAmount: 2,
    });
  });
  it("reuses the same entry idempotency key after a retry", async () => {
    const campaignBenefit = {
      ...benefit,
      entry: {
        campaignId: "55555555-5555-4555-8555-555555555555",
        creatorTicketBalance: 5,
        enteredTickets: 0,
        perFanTicketLimit: 5,
        remainingBenefitTickets: 5,
        entryOpensAt: "2020-01-01T00:00:00.000Z",
        entryClosesAt: "2099-01-01T00:00:00.000Z",
        canEnter: true,
        entries: [],
      },
    };
    let entryAttempt = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/result?locale=ko")) return Promise.resolve(new Response(null, { status: 503 }));
      if (!url.endsWith("/entries")) return Promise.resolve(new Response(JSON.stringify({ benefit: campaignBenefit })));
      entryAttempt += 1;
      if (entryAttempt === 1) return Promise.resolve(new Response(null, { status: 503 }));
      return Promise.resolve(new Response(
          JSON.stringify({
            entryId: "44444444-4444-4444-8444-444444444444",
            benefitId: benefit.id,
            campaignId: campaignBenefit.entry.campaignId,
            ticketAmount: 3,
            benefitTicketTotal: 3,
            perFanTicketLimit: 5,
            remainingBenefitTickets: 2,
            ticketLedgerId: "66666666-6666-4666-8666-666666666666",
            resultingBalance: 2,
            replayed: false,
          }),
        ));
    });
    render(<BenefitDetailScreen benefitId={benefit.id} locale="ko" />);
    fireEvent.change(
      await screen.findByRole("spinbutton", { name: "사용할 응모권 수" }),
      { target: { value: "3" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "응모권으로 응모하기" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "이 수량으로 응모 확정" }),
    );
    expect(await screen.findByText(/응모하지 못했어요/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "이 수량으로 응모 확정" }),
    );
    expect(await screen.findByText("응모가 완료됐어요")).toBeInTheDocument();
    const entryCalls = fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/entries"));
    const first = JSON.parse(String(entryCalls[0][1]?.body));
    const second = JSON.parse(String(entryCalls[1][1]?.body));
    expect(first).toEqual({
      idempotencyKey: expect.any(String),
      ticketAmount: 3,
  });
    expect(second).toEqual(first);
  });
  it("requires the Korean-address acknowledgment and posts the active shipping policy version", async () => {
    const shippingBenefit = {
      ...ifewBenefit,
      entry: {
        ...ifewBenefit.entry,
        creatorTicketBalance: 3,
        fulfillmentPolicy: {
          version: "shipping-v2",
          method: "physical_shipping",
          shippingCountry: "KR",
          requiresShippingAcknowledgment: true,
          recipientWindowDays: 7,
          pickupEndsOn: null,
          pickupVenue: { ko: "", en: "" },
          pickupInstructions: { ko: "", en: "" },
        },
      },
    } as const;
    const entryResult = {
      entryId: "44444444-4444-4444-8444-444444444444",
      benefitId: shippingBenefit.id,
      campaignId: shippingBenefit.entry.campaignId,
      ticketAmount: 1,
      benefitTicketTotal: 1,
      perFanTicketLimit: null,
      remainingBenefitTickets: null,
      ticketLedgerId: "66666666-6666-4666-8666-666666666666",
      resultingBalance: 2,
      replayed: false,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/result?locale=ko")) return Promise.resolve(new Response(null, { status: 503 }));
      if (url.endsWith("/entries")) return Promise.resolve(Response.json(entryResult));
      return Promise.resolve(Response.json({ benefit: shippingBenefit }));
    });
    render(<BenefitDetailScreen benefitId={shippingBenefit.id} locale="ko" />);
    expect(await screen.findByText("한국 주소로만 배송")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "응모권으로 응모하기" }));
    const confirm = screen.getByRole("button", { name: "이 수량으로 응모 확정" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "대한민국 내 주소로 받을 수 있음을 확인했습니다." }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(await screen.findByText("응모가 완료됐어요")).toBeInTheDocument();
    const entryCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/entries"))!;
    expect(JSON.parse(String(entryCall[1]?.body))).toMatchObject({
      policyAcknowledgment: { policyVersion: "shipping-v2", canReceiveInKorea: true },
    });
  });
  it("posts an onsite policy version without showing a Korean-address checkbox", async () => {
    const onsiteBenefit = {
      ...ifewBenefit,
      entry: {
        ...ifewBenefit.entry,
        creatorTicketBalance: 2,
        fulfillmentPolicy: {
          version: "onsite-v1",
          method: "on_site_pickup",
          shippingCountry: null,
          requiresShippingAcknowledgment: false,
          recipientWindowDays: 7,
          pickupEndsOn: "2026-11-03",
          pickupVenue: { ko: "전시장 입장 데스크", en: "Exhibition entrance desk" },
          pickupInstructions: { ko: "성명과 휴대폰 뒤 4자리로 확인", en: "Confirm your name and phone digits" },
        },
      },
    } as const;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/result?locale=ko")) return Promise.resolve(new Response(null, { status: 503 }));
      if (url.endsWith("/entries")) return Promise.resolve(Response.json({
        entryId: "44444444-4444-4444-8444-444444444444", benefitId: onsiteBenefit.id,
        campaignId: onsiteBenefit.entry.campaignId, ticketAmount: 1, benefitTicketTotal: 1,
        perFanTicketLimit: null, remainingBenefitTickets: null,
        ticketLedgerId: "66666666-6666-4666-8666-666666666666", resultingBalance: 1, replayed: false,
      }));
      return Promise.resolve(Response.json({ benefit: onsiteBenefit }));
    });
    render(<BenefitDetailScreen benefitId={onsiteBenefit.id} locale="ko" />);
    expect(await screen.findByText("현장 수령")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "응모권으로 응모하기" }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "이 수량으로 응모 확정" }));
    expect(await screen.findByText("응모가 완료됐어요")).toBeInTheDocument();
    const entryCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/entries"))!;
    expect(JSON.parse(String(entryCall[1]?.body))).toMatchObject({
      policyAcknowledgment: { policyVersion: "onsite-v1", canReceiveInKorea: false },
    });
  });
  it("refreshes a stale policy and clears the shipping acknowledgment", async () => {
    const policy = (version: string) => ({
      version,
      method: "physical_shipping" as const,
      shippingCountry: "KR" as const,
      requiresShippingAcknowledgment: true,
      recipientWindowDays: 7 as const,
      pickupEndsOn: null,
      pickupVenue: { ko: "", en: "" },
      pickupInstructions: { ko: "", en: "" },
    });
    let benefitReads = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/result?locale=ko")) return Promise.resolve(new Response(null, { status: 503 }));
      if (url.endsWith("/entries")) return Promise.resolve(Response.json(
        { error: { code: "RAFFLE_POLICY_ACK_REQUIRED" } },
        { status: 409 },
      ));
      benefitReads += 1;
      return Promise.resolve(Response.json({
        benefit: {
          ...ifewBenefit,
          entry: {
            ...ifewBenefit.entry,
            creatorTicketBalance: 2,
            fulfillmentPolicy: policy(benefitReads === 1 ? "shipping-v1" : "shipping-v2"),
          },
        },
      }));
    });
    render(<BenefitDetailScreen benefitId={ifewBenefit.id} locale="ko" />);
    fireEvent.click(await screen.findByRole("button", { name: "응모권으로 응모하기" }));
    const checkbox = screen.getByRole("checkbox", { name: "대한민국 내 주소로 받을 수 있음을 확인했습니다." });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "이 수량으로 응모 확정" }));
    expect(await screen.findByText(/경품 수령 조건이 변경됐어요/)).toBeInTheDocument();
    expect(benefitReads).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "응모권으로 응모하기" }));
    expect(screen.getByRole("checkbox", { name: "대한민국 내 주소로 받을 수 있음을 확인했습니다." })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "이 수량으로 응모 확정" })).toBeDisabled();
    const entryCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/entries"))!;
    expect(JSON.parse(String(entryCall[1]?.body))).toMatchObject({
      policyAcknowledgment: { policyVersion: "shipping-v1" },
    });
  });
  it.each([
    [
      "limit reached",
      { creatorTicketBalance: 5, remainingBenefitTickets: 0, canEnter: true },
      "이 혜택의 응모 한도에 도달했어요.",
    ],
    [
      "closed",
      { creatorTicketBalance: 5, remainingBenefitTickets: 5, canEnter: false },
      "응모가 종료됐어요.",
    ],
  ])(
    "renders the %s entry state without posting",
    async (_name, state, label) => {
      const campaignBenefit = {
        ...ifewBenefit,
        entry: {
          ...ifewBenefit.entry,
          enteredTickets: 3,
          perFanTicketLimit: 5,
          ...state,
        },
      };
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ benefit: campaignBenefit })),
        );
      render(<BenefitDetailScreen benefitId={campaignBenefit.id} locale="ko" />);
      expect(await screen.findByText(label)).toBeInTheDocument();
      expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "팬 인증하고 LIVE 참여하기" }),
      ).not.toBeInTheDocument();
      expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/entries"))).toHaveLength(0);
    },
  );
  it.each([
    ["open", { canEnter: true }, "응모 가능"],
    [
      "upcoming",
      { canEnter: false, entryOpensAt: "2098-01-01T00:00:00.000Z" },
      "응모 예정",
    ],
    [
      "closed",
      { canEnter: false, entryOpensAt: "2020-01-01T00:00:00.000Z" },
      "응모 종료",
    ],
  ])("shows the guest raffle window as %s instead of locked", async (_name, entry, label) => {
    authenticated = false;
    const guestRaffle = {
      ...ifewBenefit,
      state: "locked" as const,
      entry: { ...ifewBenefit.entry, ...entry },
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          celebrities: [{ slug: "ifewknow", name: "이퓨" }],
        }),
      )
      .mockResolvedValueOnce(Response.json({ benefits: [guestRaffle] }));

    render(<BenefitsScreen locale="ko" initialCelebrity="ifewknow" />);

    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.queryByText("잠김")).not.toBeInTheDocument();
  });
  it("keeps non-baseline raffle requirements visible", async () => {
    const constrainedRaffle = {
      ...ifewBenefit,
      id: benefit.id,
      minimumScore: 10,
      minimumLevel: "Gold" as const,
      requiredStampType: "survey" as const,
      requiredActivityType: "attendance" as const,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ benefit: constrainedRaffle }),
    );

    render(<BenefitDetailScreen benefitId={constrainedRaffle.id} locale="ko" />);

    expect(await screen.findByText("필요 팬 점수")).toBeInTheDocument();
    expect(screen.getByText("필요 등급")).toBeInTheDocument();
    expect(screen.getByText("필요 도장")).toBeInTheDocument();
    expect(screen.getByText("필요 활동")).toBeInTheDocument();
    expect(screen.getByText("골드")).toBeInTheDocument();
    expect(screen.getByText("attendance")).toBeInTheDocument();
  });
  it("keeps baseline score and level visible for a direct-claim benefit", async () => {
    const baselineDirectClaim = {
      ...benefit,
      minimumScore: 0,
      minimumLevel: "Bronze" as const,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ benefit: baselineDirectClaim }),
    );

    render(
      <BenefitDetailScreen benefitId={baselineDirectClaim.id} locale="ko" />,
    );

    expect(await screen.findByText("필요 팬 점수")).toBeInTheDocument();
    expect(screen.getByText("필요 등급")).toBeInTheDocument();
    expect(screen.getByText("브론즈")).toBeInTheDocument();
  });
  it("automatically resumes one matching benefit claim after login", async () => {
    const intent = createAuthIntent({
      sourcePath: `/benefits/${benefit.id}`,
      sourceQuery: "?locale=ko",
      actionType: "CLAIM_BENEFIT",
      targetType: "benefit",
      targetId: benefit.id,
    });
    persistAuthIntent(sessionStorage, intent);
    window.history.replaceState(
      {},
      "",
      `/benefits/${benefit.id}?locale=ko&authIntent=${intent.id}`,
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ benefit })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
        claimId: "a1f86df9-f5e4-4ee1-b375-d18092b63e6a",
        benefitId: benefit.id,
        deliveryType: "unique_code",
        deliveryValue: "AUTO-SECRET",
        claimedAt: "2026-07-21T00:00:00.000Z",
        replayed: false,
          }),
        ),
      );

    render(<BenefitDetailScreen benefitId={benefit.id} locale="ko" />);

    expect(await screen.findByText("AUTO-SECRET")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/claim")),
    ).toHaveLength(1);
    expect(
      sessionStorage.getItem(`byus:auth-intent:v1:${intent.id}`),
    ).toBeNull();
  });
  it("offers a contextual login action to a guest without attempting the mutation", async () => {
    authenticated = false;
    const locked = { ...benefit, state: "locked" as const };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ benefit: locked })));
    render(<BenefitDetailScreen benefitId={benefit.id} locale="ko" />);
    expect(
      await screen.findByRole("link", { name: "로그인하고 혜택 이어받기" }),
    ).toHaveAttribute("href", expect.stringContaining("intent=benefit-claim"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("uses a safe external link after an external URL claim", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ benefit })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            claimId: "a1f86df9-f5e4-4ee1-b375-d18092b63e6a",
            benefitId: benefit.id,
            deliveryType: "external_url",
            deliveryValue: "https://example.com/redeem",
            claimedAt: "2026-07-21T00:00:00.000Z",
            replayed: false,
          }),
        ),
      );
    render(<BenefitDetailScreen benefitId={benefit.id} locale="en" />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Claim benefit/ }),
    );
    const link = await screen.findByRole("link", { name: /Open benefit/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
  it("renders text delivery as readable content without code controls", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
        benefit: { ...benefit, deliveryType: "text" },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            claimId: "a1f86df9-f5e4-4ee1-b375-d18092b63e6a",
            benefitId: benefit.id,
            deliveryType: "text",
            deliveryValue: "ByUs 디지털 메시지가 보관함에 추가되었어요.",
            claimedAt: "2026-07-21T00:00:00.000Z",
            replayed: false,
          }),
        ),
      );
    render(<BenefitDetailScreen benefitId={benefit.id} locale="ko" />);
    fireEvent.click(
      await screen.findByRole("button", { name: /혜택 수령하기/ }),
    );
    expect(
      await screen.findByText("ByUs 디지털 메시지가 보관함에 추가되었어요."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "코드 복사" }),
    ).not.toBeInTheDocument();
  });
  it("offers retry on an API failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 503 }),
    );
    render(<BenefitDetailScreen benefitId={benefit.id} locale="ko" />);
    expect(
      await screen.findByRole("button", { name: "다시 불러오기" }),
    ).toBeInTheDocument();
  });
  it("submits an application instead of claiming and shows its Korean status", async () => {
    const applicationBenefit = {
      ...benefit,
      allocationMode: "application_selection" as const,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ benefit: applicationBenefit })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            applicationId: "33333333-3333-4333-8333-333333333333",
            status: "submitted",
            replayed: false,
          }),
        ),
      );
    render(
      <BenefitDetailScreen
        benefitId={benefit.id}
        locale="ko"
        celebrity="kara"
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "혜택 신청하기" }),
    );
    expect(await screen.findByText("신청이 접수되었어요")).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/applications");
    expect(fetchMock.mock.calls[1]?.[0]).not.toContain("/claim");
    expect(
      (fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>)[
        "idempotency-key"
      ],
    ).toMatch(/[0-9a-f-]{36}/);
  });
  it("renders a persisted English application decision without a direct claim CTA", async () => {
    const applicationBenefit = {
      ...benefit,
      allocationMode: "application_selection" as const,
      applicationStatus: "not_selected" as const,
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ benefit: applicationBenefit })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            application: {
              applicationId: "33333333-3333-4333-8333-333333333333",
              benefitId: benefit.id,
              status: "not_selected",
              submittedAt: "2026-07-21T00:00:00.000Z",
              claim: null,
            },
          }),
        ),
      );
    render(<BenefitDetailScreen benefitId={benefit.id} locale="en" />);
    expect(
      await screen.findByText("Selection for this benefit is complete"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Claim benefit" }),
    ).not.toBeInTheDocument();
  });
  it("reveals selected unique delivery only through the owner application endpoint", async () => {
    const selected = {
      ...benefit,
      allocationMode: "application_selection" as const,
      applicationStatus: "selected" as const,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ benefit: selected })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            application: {
              applicationId: "33333333-3333-4333-8333-333333333333",
              benefitId: benefit.id,
              status: "selected",
              submittedAt: "2026-07-21T00:00:00.000Z",
              claim: {
                claimId: "a1f86df9-f5e4-4ee1-b375-d18092b63e6a",
                benefitId: benefit.id,
                deliveryType: "unique_code",
                deliveryValue: "SELECTED-SECRET",
                claimedAt: "2026-07-21T12:00:00.000Z",
              },
            },
          }),
        ),
      );
    render(<BenefitDetailScreen benefitId={benefit.id} locale="ko" />);
    expect(await screen.findByText("SELECTED-SECRET")).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/applications");
    expect(
      screen.queryByRole("button", { name: "혜택 수령하기" }),
    ).not.toBeInTheDocument();
  });
});
