import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PassportCollectionScreen, PassportDetailScreen, StampDetailOverlay, StampDetailScreen } from "./passport-screens";

const getAccessToken = vi.fn(async () => "access-token");
const push = vi.fn();
const back = vi.fn();
let locale = "ko";
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true, getAccessToken }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/passports", useRouter: () => ({ push, back }), useSearchParams: () => new URLSearchParams(`locale=${locale}`) }));

const celebrity = { slug: "kara", name: "KARA", image: { url: "/images/guest-home/kara-card.jpg", alt: "KARA", position: "center" } };
const mint = { status: "minted", txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", tokenId: "42" };
const passport = { id: "11111111-1111-4111-8111-111111111111", owner: { nickname: null }, celebrity, businessStatus: "issued", mint, issuedAt: "2026-07-21T00:00:00.000Z", score: { points: 5, level: "Silver" }, stampSummary: { knowledge: 1, reservation: 1, attendance: 0, survey: 0, total: 2 }, display: { level: "실버", mintStatus: "발급 완료" } };
const stamps = [
  { id: "22222222-2222-4222-8222-222222222222", type: "knowledge", businessStatus: "issued", mint, issuedAt: "2026-07-20T00:00:00.000Z", activityId: "44444444-4444-4444-8444-444444444444", display: { type: "팬 인증", mintStatus: "발급 완료" } },
  { id: "33333333-3333-4333-8333-333333333333", type: "reservation", businessStatus: "issued", mint, issuedAt: "2026-07-21T00:00:00.000Z", activityId: "55555555-5555-4555-8555-555555555555", display: { type: "라이브 예약", mintStatus: "발급 완료" } },
];
const stampDetail = { id: stamps[0].id, type: "knowledge", businessStatus: "issued", mint, issuedAt: "2026-07-20T00:00:00.000Z", passport: { id: passport.id }, owner: { nickname: null }, celebrity, activity: { id: stamps[0].activityId, type: "knowledge", occurredAt: "2026-07-20T00:00:00.000Z", points: 1, display: { type: "팬 인증" } }, display: { type: "팬 인증", mintStatus: "발급 완료" } };

describe("passport fan screens", () => {
  beforeEach(() => {
    locale = "ko";
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_BLOCKCHAIN_EXPLORER_TX_BASE;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
  });

  it("renders only the owned issued collection and retains locale in canonical detail links", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ passports: [passport] }), { status: 200 })));
    render(<PassportCollectionScreen />);
    expect(await screen.findByRole("heading", { name: "KARA" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /KARA/ })).toHaveAttribute("href", `/passports/${passport.id}?locale=ko`);
    expect(screen.getByText("Fan Score").previousSibling).toHaveTextContent("5");
    expect(screen.getByText("디지털 발급이 완료됐어요")).toBeInTheDocument();
  });

  it("renders four semantic slots, newest activity first, and separate score and stamp totals", async () => {
    const activities = [
      { id: "66666666-6666-4666-8666-666666666666", type: "knowledge", occurredAt: "2026-07-20T00:00:00.000Z", points: 1, stampId: stamps[0].id, display: { type: "팬 인증" } },
      { id: "77777777-7777-4777-8777-777777777777", type: "reservation", occurredAt: "2026-07-21T00:00:00.000Z", points: 1, stampId: stamps[1].id, display: { type: "라이브 예약" } },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ passport: { ...passport, stamps, activities } }), { status: 200 })));
    render(<PassportDetailScreen id={passport.id} />);
    expect(await screen.findByRole("heading", { name: "KARA Fan Passport" })).toBeInTheDocument();
    expect(screen.getAllByText("라이브 출석")).toHaveLength(2);
    expect(screen.getAllByText("후기 참여")).toHaveLength(2);
    expect(screen.getAllByText("다음 순간을 기다리는 중")).toHaveLength(2);
    const timeline = screen.getByRole("list");
    expect(timeline.children[0]).toHaveTextContent("라이브 예약");
    expect(screen.getByText("Fan Score").previousSibling).toHaveTextContent("5");
    expect(screen.getByText("Stamp").previousSibling).toHaveTextContent("2");
  });

  it("keeps chain facts collapsed, masks the transaction and never invents wallet data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ stamp: stampDetail }), { status: 200 })));
    render(<StampDetailScreen id={stampDetail.id} />);
    const summary = await screen.findByText("디지털 발급 정보");
    const disclosure = summary.closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    fireEvent.click(summary);
    expect(screen.getByText("0xaaaaaa…aaaaaa")).toBeInTheDocument();
    expect(screen.queryByText(/wallet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "발급 기록 확인" })).not.toBeInTheDocument();
  });

  it("renders an intercepted Stamp in an accessible adaptive overlay and closes with history", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ stamp: stampDetail }), { status: 200 })));
    render(<StampDetailOverlay id={stampDetail.id} />);

    expect(await screen.findByRole("dialog", { name: "Stamp 상세" })).toBeInTheDocument();
    const close = await screen.findByRole("button", { name: "상세 닫기" });
    fireEvent.click(close);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("uses a full-height Bottom Sheet contract for an intercepted Stamp on mobile", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ stamp: stampDetail }), { status: 200 })));
    render(<StampDetailOverlay id={stampDetail.id} />);

    const overlay = await screen.findByRole("dialog", { name: "Stamp 상세" });
    await waitFor(() => expect(overlay).toHaveAttribute("data-variant", "bottom-sheet"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("offers recovery for partial API failure and a locale-preserving retry", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({ passports: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock); render(<PassportCollectionScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /다시 불러오기/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("heading", { name: "아직 발급된 Passport가 없어요." })).toBeInTheDocument();
  });
});
