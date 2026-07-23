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

    const dialog = await screen.findByRole("dialog", { name: "혜택 상세" });
    expect(dialog).toHaveAttribute("data-variant", "drawer");
    const close = screen.getByRole("button", { name: "혜택 상세 닫기" });
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
    fireEvent.click(await screen.findByRole("button", { name: /혜택 수령하기/ }));
    const dialog = screen.getByRole("dialog", { name: "혜택 상세" });
    const close = screen.getByRole("button", { name: "혜택 상세 닫기" });
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "true"));
    expect(close).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(dialog.parentElement!);
    expect(routerBack).not.toHaveBeenCalled();

    resolveClaim(new Response(JSON.stringify({
      claimId: "a1f86df9-f5e4-4ee1-b375-d18092b63e6a",
      benefitId: benefit.id,
      deliveryType: "unique_code",
      deliveryValue: "SECRET-42",
      claimedAt: "2026-07-21T00:00:00.000Z",
      replayed: false,
    })));
    await waitFor(() => expect(dialog).not.toHaveAttribute("aria-busy"));
  });
  it("loads API celebrities and benefits, preserving locale and celebrity in detail routes", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(celebrities)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ benefits: [benefit] })),
      );
    render(<BenefitsScreen locale="ko" />);
    expect(screen.getAllByRole("link", { name: "MY" })).toHaveLength(2);
    for (const currentLink of screen.getAllByRole("link", { name: "MY" })) {
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

    expect(await screen.findByRole("heading", { name: benefit.title })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "혜택 목록" })).toHaveAttribute(
      "href",
      "/benefits?locale=ko&celebrity=kara",
    );
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
  it("automatically resumes one matching benefit claim after login", async () => {
    const intent = createAuthIntent({ sourcePath: `/benefits/${benefit.id}`, sourceQuery: "?locale=ko", actionType: "CLAIM_BENEFIT", targetType: "benefit", targetId: benefit.id });
    persistAuthIntent(sessionStorage, intent);
    window.history.replaceState({}, "", `/benefits/${benefit.id}?locale=ko&authIntent=${intent.id}`);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ benefit })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        claimId: "a1f86df9-f5e4-4ee1-b375-d18092b63e6a",
        benefitId: benefit.id,
        deliveryType: "unique_code",
        deliveryValue: "AUTO-SECRET",
        claimedAt: "2026-07-21T00:00:00.000Z",
        replayed: false,
      })));

    render(<BenefitDetailScreen benefitId={benefit.id} locale="ko" />);

    expect(await screen.findByText("AUTO-SECRET")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/claim"))).toHaveLength(1);
    expect(sessionStorage.getItem(`byus:auth-intent:v1:${intent.id}`)).toBeNull();
  });
  it("offers a contextual login action to a guest without attempting the mutation", async () => {
    authenticated = false;
    const locked = { ...benefit, state: "locked" as const };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ benefit: locked })));
    render(<BenefitDetailScreen benefitId={benefit.id} locale="ko" />);
    expect(await screen.findByRole("link", { name: "로그인하고 혜택 이어받기" })).toHaveAttribute("href", expect.stringContaining("intent=benefit-claim"));
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
