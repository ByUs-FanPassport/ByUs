import type { ComponentProps, ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishedCelebrity } from "@/server/content/content-domain";
import type { BenefitCatalogItem } from "../domain/benefit";
import type { BenefitEntryResult } from "../domain/benefit-entry";
import type { RaffleList } from "../domain/raffle";

let authenticated = false;
let ownerId = "owner-a";
const getAccessToken = vi.fn(async () => "token");
const routerPush = vi.fn();

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    ready: true,
    authenticated,
    user: authenticated ? { id: ownerId } : null,
    getAccessToken,
  }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<"a"> & { href: string }) =>
    <a href={String(href)} {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));
vi.mock("@/components/fan-shell/fan-app-shell", () => ({
  FanAppFrame: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

import { CreatorRafflesScreen } from "./creator-raffles-screen";

const benefitIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
] as const;
const campaignId = "55555555-5555-4555-8555-555555555555";
const operationId = "66666666-6666-4666-8666-666666666666";

const celebrity: PublishedCelebrity = {
  slug: "creator",
  locale: "ko",
  name: "Creator",
  summary: "Creator summary",
  image: { url: "/creator.jpg", alt: "Creator portrait", position: "center" },
  roles: ["creator"],
  themes: [],
  socialLinks: [],
  displayOrder: 0,
  fanCount: 10,
};

const digitalPolicy = {
  version: "digital-v1",
  method: "digital" as const,
  shippingCountry: null,
  requiresShippingAcknowledgment: false,
  recipientWindowDays: 7 as const,
  pickupEndsOn: null,
  pickupVenue: { ko: "", en: "" },
  pickupInstructions: { ko: "", en: "" },
};
const shippingPolicy = {
  ...digitalPolicy,
  version: "shipping-v1",
  method: "physical_shipping" as const,
  shippingCountry: "KR" as const,
  requiresShippingAcknowledgment: true,
};

function raffle(index = 0, overrides: Partial<RaffleList["raffles"][number]> = {}) {
  return {
    id: benefitIds[index]!,
    benefitId: benefitIds[index]!,
    title: `선물 ${index + 1}`,
    summary: `선물 ${index + 1} 설명`,
    imageUrl: null,
    winnerQuantity: index + 1,
    status: "open" as const,
    entryOpensAt: "2026-01-01T00:00:00.000Z",
    entryClosesAt: "2030-01-01T00:00:00.000Z",
    fulfillmentMethod: "digital" as const,
    fulfillmentPolicy: digitalPolicy,
    perFanTicketLimit: 3,
    ...overrides,
  };
}

function benefit(
  id = benefitIds[0],
  overrides: Partial<NonNullable<BenefitCatalogItem["entry"]>> = {},
): BenefitCatalogItem {
  return {
    id,
    slug: `gift-${benefitIds.indexOf(id as typeof benefitIds[number]) + 1}`,
    title: "선물",
    summary: "선물 설명",
    eligibilityLabel: "Silver 이상",
    deliveryLabel: "디지털 지급",
    deliveryType: "unique_code",
    allocationMode: "direct_claim",
    applicationStatus: null,
    claimOpensAt: "2026-01-01T00:00:00.000Z",
    claimClosesAt: "2030-01-01T00:00:00.000Z",
    minimumScore: 0,
    minimumLevel: "Silver",
    requiredStampType: null,
    requiredActivityType: null,
    state: "eligible",
    entry: {
      fulfillmentPolicy: digitalPolicy,
      campaignId,
      creatorTicketBalance: 4,
      enteredTickets: 1,
      perFanTicketLimit: 3,
      remainingBenefitTickets: 3,
      entryOpensAt: "2026-01-01T00:00:00.000Z",
      entryClosesAt: "2030-01-01T00:00:00.000Z",
      canEnter: true,
      entries: [],
      ...overrides,
    },
  };
}

function accepted(overrides: Partial<BenefitEntryResult> = {}): BenefitEntryResult {
  return {
    entryId: "77777777-7777-4777-8777-777777777777",
    benefitId: benefitIds[0],
    campaignId,
    ticketAmount: 2,
    benefitTicketTotal: 7,
    perFanTicketLimit: 3,
    remainingBenefitTickets: 1,
    ticketLedgerId: "88888888-8888-4888-8888-888888888888",
    resultingBalance: 2,
    replayed: false,
    ...overrides,
  };
}

function benefitsResponse(items: BenefitCatalogItem[] = [benefit()]) {
  return Response.json({ benefits: items });
}

function renderDetail(options: {
  locale?: "ko" | "en";
  raffleItem?: RaffleList["raffles"][number];
} = {}) {
  const raffleItem = options.raffleItem ?? raffle();
  return render(
    <CreatorRafflesScreen
      celebrity={celebrity}
      locale={options.locale ?? "ko"}
      raffles={[raffleItem]}
      benefitId={raffleItem.benefitId ?? undefined}
    />,
  );
}

function postCalls(fetcher: ReturnType<typeof vi.fn>) {
  return fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
}

async function chooseAndConfirm(amount = 1) {
  const input = await screen.findByLabelText("사용할 응모권");
  fireEvent.change(input, { target: { value: String(amount) } });
  fireEvent.click(screen.getByRole("button", { name: `${amount}장으로 응모하기` }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "응모 확정" }));
}

beforeEach(() => {
  authenticated = false;
  ownerId = "owner-a";
  getAccessToken.mockClear();
  routerPush.mockClear();
  sessionStorage.clear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(operationId);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("creator raffle catalog and entry integration", () => {
  it.each([1, 2, 3, 4])("keeps all %i gifts in the catalog with distinct detail links", (count) => {
    const raffles = Array.from({ length: count }, (_, index) => raffle(index));
    render(<CreatorRafflesScreen celebrity={celebrity} locale="ko" raffles={raffles} />);

    const catalog = screen.getByTestId("raffle-grid");
    expect(within(catalog).getAllByRole("article")).toHaveLength(count);
    const links = within(catalog).getAllByRole("link", { name: "선물 보고 응모하기" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      benefitIds.slice(0, count).map((id) => `/c/creator/raffles/${id}?locale=ko`),
    );
  });

  it("preserves the exact guest detail return path in the login link", async () => {
    renderDetail();

    const link = screen.getByRole("link", { name: "로그인하고 응모하기" });
    expect(link.getAttribute("href")).toContain(
      `returnTo=${encodeURIComponent(`/c/creator/raffles/${benefitIds[0]}?locale=ko`)}`,
    );
    fireEvent.click(link);
    expect(routerPush).toHaveBeenCalledWith(
      `/login?returnTo=${encodeURIComponent(`/c/creator/raffles/${benefitIds[0]}?locale=ko&authIntent=${operationId}`)}&locale=ko&intent=benefit-application&entity=${benefitIds[0]}&authIntent=${operationId}`,
    );
    expect(JSON.parse(sessionStorage.getItem(`byus:auth-intent:v1:${operationId}`)!)).toMatchObject({
      sourcePath: `/c/creator/raffles/${benefitIds[0]}`,
      targetId: benefitIds[0],
      actionType: "APPLY_BENEFIT",
    });
  });

  it("clamps quantity to zero and the available gift limit", async () => {
    authenticated = true;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(benefitsResponse()));
    renderDetail();
    const input = await screen.findByLabelText("사용할 응모권");
    expect(input).toHaveAttribute("max", "3");

    fireEvent.change(input, { target: { value: "0" } });
    expect(input).toHaveValue(0);
    expect(screen.getByRole("button", { name: "0장으로 응모하기" })).toBeDisabled();

    fireEvent.change(input, { target: { value: "99" } });
    expect(input).toHaveValue(3);
    expect(screen.getByRole("button", { name: "응모권 1장 늘리기" })).toBeDisabled();
    expect(screen.getByText("이 선물의 응모 한도 3장", { exact: false })).toBeInTheDocument();
  });

  it("requires shipping acknowledgment and cancelling confirmation never POSTs", async () => {
    authenticated = true;
    const shippingBenefit = benefit(benefitIds[0], { fulfillmentPolicy: shippingPolicy });
    const fetcher = vi.fn().mockResolvedValue(benefitsResponse([shippingBenefit]));
    vi.stubGlobal("fetch", fetcher);
    renderDetail({ raffleItem: raffle(0, {
      fulfillmentMethod: "physical_shipping",
      fulfillmentPolicy: shippingPolicy,
    }) });

    const entryButton = await screen.findByRole("button", { name: "1장으로 응모하기" });
    expect(entryButton).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "대한민국 내 주소로 받을 수 있음을 확인했습니다." }));
    expect(entryButton).toBeEnabled();
    fireEvent.click(entryButton);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "수량 다시 선택" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(postCalls(fetcher)).toHaveLength(0);
  });

  it("renders server-authoritative entry and balance totals after success", async () => {
    authenticated = true;
    const current = benefit(benefitIds[0], {
      creatorTicketBalance: 2,
      enteredTickets: 7,
      remainingBenefitTickets: 1,
    });
    const fetcher = vi.fn().mockImplementation((input, init) => {
      if (init?.method === "POST") return Promise.resolve(Response.json(accepted()));
      if (String(input).includes(`/${benefitIds[0]}?locale=ko`)) {
        return Promise.resolve(Response.json({ benefit: current }));
      }
      return Promise.resolve(benefitsResponse());
    });
    vi.stubGlobal("fetch", fetcher);
    renderDetail();

    await chooseAndConfirm(2);

    const receiptHeading = await screen.findByRole("heading", { name: "응모가 완료됐어요" });
    expect(receiptHeading).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(receiptHeading));
    await waitFor(() => expect(screen.getByText("7장")).toBeInTheDocument());
    expect(screen.getByText("2장")).toBeInTheDocument();
    expect(JSON.parse(postCalls(fetcher)[0]![1].body as string)).toMatchObject({
      ticketAmount: 2,
      idempotencyKey: operationId,
    });
    const enterAgain = screen.getByRole("button", { name: "이 선물에 더 응모하기" });
    await waitFor(() => expect(enterAgain).toBeEnabled());
    fireEvent.click(enterAgain);
    const entryHeading = screen.getByRole("heading", { name: "이번 선물에 몇 장을 보낼까요?" });
    await waitFor(() => expect(document.activeElement).toBe(entryHeading));
  });

  it("shows rejection without a success receipt", async () => {
    authenticated = true;
    const fetcher = vi.fn().mockImplementation((_input, init) => init?.method === "POST"
      ? Promise.resolve(Response.json({ error: { code: "INSUFFICIENT_TICKETS" } }, { status: 409 }))
      : Promise.resolve(benefitsResponse()));
    vi.stubGlobal("fetch", fetcher);
    renderDetail();

    await chooseAndConfirm(1);

    expect(await screen.findByRole("alert")).toHaveTextContent("응모가 접수되지 않았어요");
    expect(screen.queryByRole("heading", { name: "응모가 완료됐어요" })).not.toBeInTheDocument();
    expect(postCalls(fetcher)).toHaveLength(1);
  });

  it("offers a same-payload retry after an uncertain POST", async () => {
    authenticated = true;
    const current = benefit(benefitIds[0], {
      creatorTicketBalance: 2,
      enteredTickets: 3,
      remainingBenefitTickets: 1,
    });
    let postCount = 0;
    const fetcher = vi.fn().mockImplementation((input, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? Promise.reject(new Error("response lost"))
          : Promise.resolve(Response.json(accepted({ ticketAmount: 2, benefitTicketTotal: 3 })));
      }
      if (String(input).includes(`/${benefitIds[0]}?locale=ko`)) {
        return Promise.resolve(Response.json({ benefit: current }));
      }
      return Promise.resolve(benefitsResponse());
    });
    vi.stubGlobal("fetch", fetcher);
    renderDetail();

    await chooseAndConfirm(2);
    const failedDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(failedDialog).getByRole("button", { name: "수량 다시 선택" }));
    const retry = await screen.findByRole("button", { name: "같은 응모 요청 확인" });
    expect(screen.getByText("확인할 요청: 2장")).toBeInTheDocument();
    fireEvent.click(retry);
    expect(await screen.findByRole("heading", { name: "응모가 완료됐어요" })).toBeInTheDocument();

    const bodies = postCalls(fetcher).map(([, init]) => init.body);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
  });

  it("remounts owner-scoped entry UI when the authenticated owner changes", async () => {
    authenticated = true;
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(benefitsResponse([
      benefit(benefitIds[0], { creatorTicketBalance: ownerId === "owner-a" ? 4 : 2 }),
    ])));
    vi.stubGlobal("fetch", fetcher);
    const view = renderDetail();
    const input = await screen.findByLabelText("사용할 응모권");
    fireEvent.change(input, { target: { value: "3" } });
    expect(input).toHaveValue(3);

    ownerId = "owner-b";
    view.rerender(
      <CreatorRafflesScreen celebrity={celebrity} locale="ko" raffles={[raffle()]} benefitId={benefitIds[0]} />,
    );

    await waitFor(() => expect(screen.getByLabelText("사용할 응모권")).toHaveValue(1));
    expect(await screen.findByText("Creator 응모권 2장 보유")).toBeInTheDocument();
    expect(screen.queryByText("확인할 요청:", { exact: false })).not.toBeInTheDocument();
  });

  it("renders the English catalog and detail controls with English locale links", async () => {
    const catalog = render(
      <CreatorRafflesScreen celebrity={celebrity} locale="en" raffles={[raffle()]} />,
    );
    expect(screen.getByRole("heading", { name: "Which gift will you choose?" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View gift and enter" })).toHaveAttribute(
      "href",
      `/c/creator/raffles/${benefitIds[0]}?locale=en`,
    );
    catalog.unmount();

    renderDetail({ locale: "en" });
    expect(screen.getByRole("heading", { name: "How many tickets for this gift?" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to enter" })).toHaveAttribute(
      "href",
      expect.stringContaining("locale=en"),
    );
  });

  it("keeps public gifts without a benefit target non-clickable and falls back to catalog for an unknown detail", () => {
    const publicOnly = raffle(0, { benefitId: null, title: "공개 예정 선물" });
    render(
      <CreatorRafflesScreen
        celebrity={celebrity}
        locale="ko"
        raffles={[publicOnly]}
        benefitId="99999999-9999-4999-8999-999999999999"
      />,
    );

    expect(screen.getByRole("heading", { name: "어떤 선물이 마음에 드나요?" })).toBeInTheDocument();
    expect(screen.getByText("공개 예정 선물")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "선물 보고 응모하기" })).not.toBeInTheDocument();
  });
});
