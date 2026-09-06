import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PassportCollectionScreen, PassportDetailScreen, StampDetailOverlay, StampDetailScreen } from "./passport-screens";

const getAccessToken = vi.fn(async () => "access-token");
const push = vi.fn();
const back = vi.fn();
const explorerBaseUrl = "https://sepolia-explorer.giwa.io";
const maskedHash = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
let locale = "ko";
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true, getAccessToken }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/passports", useRouter: () => ({ push, back }), useSearchParams: () => new URLSearchParams(`locale=${locale}`) }));

const celebrity = { slug: "kara", name: "KARA", image: { url: "/images/guest-home/kara-card.jpg", alt: "KARA", position: "center" } };
const mint = { status: "minted", txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", tokenId: "42" };
const passport = { id: "11111111-1111-4111-8111-111111111111", owner: { nickname: null }, celebrity, businessStatus: "issued", mint, issuedAt: "2026-07-21T00:00:00.000Z", score: { points: 15, level: "Silver" }, stampSummary: { knowledge: 1, reservation: 1, attendance: 0, survey: 0, total: 2 }, display: { level: "실버", mintStatus: "발급 완료" } };
const context = { sourceType: "quiz_pass", sourceId: "88888888-8888-4888-8888-888888888888", live: null };
const stamps = [
  { id: "22222222-2222-4222-8222-222222222222", type: "knowledge", businessStatus: "issued", mint, issuedAt: "2026-07-20T00:00:00.000Z", activityId: "44444444-4444-4444-8444-444444444444", context, display: { type: "팬 인증", mintStatus: "발급 완료" } },
  { id: "33333333-3333-4333-8333-333333333333", type: "reservation", businessStatus: "issued", mint, issuedAt: "2026-07-21T00:00:00.000Z", activityId: "55555555-5555-4555-8555-555555555555", context: { sourceType: "live_reservation", sourceId: "99999999-9999-4999-8999-999999999999", live: { slug: "kara-live", title: "KARA LIVE", linkable: true } }, display: { type: "라이브 예약", mintStatus: "발급 완료" } },
];
const stampDetail = { id: stamps[0].id, type: "knowledge", businessStatus: "issued", mint, issuedAt: "2026-07-20T00:00:00.000Z", passport: { id: passport.id }, owner: { nickname: null }, celebrity, activity: { id: stamps[0].activityId, type: "knowledge", occurredAt: "2026-07-20T00:00:00.000Z", points: 1, context, display: { type: "팬 인증" } }, display: { type: "팬 인증", mintStatus: "발급 완료" } };

describe("passport fan screens", () => {
  beforeEach(() => {
    locale = "ko";
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
  });

  it("renders only the owned issued collection and retains locale in canonical detail links", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ passports: [passport] }), { status: 200 })));
    const { container } = render(<PassportCollectionScreen />);
    expect(await screen.findByRole("heading", { name: "KARA" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /KARA/ })).toHaveAttribute("href", `/passports/${passport.id}?locale=ko`);
    expect(screen.getByRole("link", { name: /^15\s*팬 점수$/ })).toHaveAttribute("href", `/passports/${passport.id}?locale=ko#activity`);
    expect(screen.getByRole("link", { name: /^2\s*스탬프$/ })).toHaveAttribute("href", `/passports/${passport.id}?locale=ko#stamp-book`);
    expect(container.querySelector("#collection")).toBeInTheDocument();
    expect(container.querySelector("a a")).toBeNull();
    expect(screen.queryByText("디지털 발급이 완료됐어요")).not.toBeInTheDocument();
  });

  it("fails closed when the Passport collection API DTO is malformed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      passports: [{ ...passport, display: undefined }],
    }), { status: 200 })));

    render(<PassportCollectionScreen />);

    expect(await screen.findByRole("alert")).toHaveTextContent("기록을 불러오지 못했어요.");
    expect(screen.getByRole("button", { name: "다시 불러오기" })).toBeInTheDocument();
  });

  it("renders each actual Stamp, newest activity first, and separate score and stamp totals", async () => {
    const activities = [
      { id: "66666666-6666-4666-8666-666666666666", type: "knowledge", occurredAt: "2026-07-20T00:00:00.000Z", points: 1, stampId: stamps[0].id, context, display: { type: "팬 인증" } },
      { id: "77777777-7777-4777-8777-777777777777", type: "reservation", occurredAt: "2026-07-21T00:00:00.000Z", points: 1, stampId: stamps[1].id, context: stamps[1].context, display: { type: "라이브 예약" } },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ passport: { ...passport, stamps, activities, progress: { currentScore: 15, currentLevel: "Silver", nextLevel: "Gold", nextThreshold: 50, remainingPoints: 35, percent: 30, maxed: false }, nextBenefit: null } }), { status: 200 })));
    const { container } = render(<PassportDetailScreen id={passport.id} explorerBaseUrl={explorerBaseUrl} />);
    expect(await screen.findByRole("heading", { name: "KARA Fan Passport" })).toBeInTheDocument();
    expect(screen.queryByText("다음 순간을 기다리는 중")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /받은 스탬프 보기/ })).toHaveLength(2);
    expect(container.querySelectorAll("[data-passport-stamp]")).toHaveLength(2);
    expect(screen.getByLabelText("STAR: KARA")).toHaveTextContent("KARA");
    expect(screen.getByLabelText(`FAN ID: ${passport.id}`)).toHaveTextContent("11111111…1111");
    expect(screen.getByRole("link", { name: "KARA 최애 페이지 보기" })).toHaveAttribute("href", "/c/kara?locale=ko");
    expect(screen.getByRole("link", { name: /^15\s*팬 점수$/ })).toHaveAttribute("href", "#activity");
    expect(screen.getByRole("link", { name: /^2\s*스탬프$/ })).toHaveAttribute("href", "#stamp-book");
    expect(container.querySelector("#activity")).toBeInTheDocument();
    expect(container.querySelector("#stamp-book")).toBeInTheDocument();
    const timeline = screen.getByRole("list");
    expect(timeline.children[0]).toHaveTextContent("라이브 예약");
    expect(timeline.children[0]).toHaveTextContent("KARA LIVE");
    expect(screen.getByText("팬 점수").previousSibling).toHaveTextContent("15");
    expect(screen.getByText("스탬프").previousSibling).toHaveTextContent("2");
  });

  it("renders a pending First Reaction as relationship history without a transaction link or Stamp count", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      passport: {
        ...passport,
        stamps: [],
        activities: [],
        stampSummary: { knowledge: 0, reservation: 0, attendance: 0, survey: 0, total: 0 },
        progress: { currentScore: 15, currentLevel: "Silver", nextLevel: "Gold", nextThreshold: 50, remainingPoints: 35, percent: 30, maxed: false },
        nextBenefit: null,
        firstReaction: {
          reactionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          stampId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
          activityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
          reactionType: "FirstReaction",
          mintStatus: "queued",
          txHash: null,
          issuedAt: "2026-07-19T00:00:00.000Z",
        },
      },
    })));

    render(<PassportDetailScreen id={passport.id} explorerBaseUrl={explorerBaseUrl} />);

    expect(await screen.findByRole("heading", { name: "첫 반응" })).toBeInTheDocument();
    expect(screen.getByText("첫 마음을 남긴 날")).toBeInTheDocument();
    expect(screen.getByText("안전하게 발급을 준비하고 있어요")).toBeInTheDocument();
    expect(screen.getByText("스탬프").previousSibling).toHaveTextContent("0");
    expect(screen.queryByRole("link", { name: /첫 반응 거래 기록/ })).not.toBeInTheDocument();
  });

  it("links a minted First Reaction to its validated transaction without adding a normal Stamp", async () => {
    const firstReactionTx = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      passport: {
        ...passport,
        stamps: [],
        activities: [],
        stampSummary: { knowledge: 0, reservation: 0, attendance: 0, survey: 0, total: 0 },
        progress: { currentScore: 15, currentLevel: "Silver", nextLevel: "Gold", nextThreshold: 50, remainingPoints: 35, percent: 30, maxed: false },
        nextBenefit: null,
        firstReaction: {
          reactionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
          stampId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
          activityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
          reactionType: "FirstReaction",
          mintStatus: "minted",
          txHash: firstReactionTx,
          issuedAt: "2026-07-19T00:00:00.000Z",
        },
      },
    })));

    render(<PassportDetailScreen id={passport.id} explorerBaseUrl={`${explorerBaseUrl}/`} />);

    expect(await screen.findByRole("heading", { name: "첫 반응" })).toBeInTheDocument();
    const transactionLink = screen.getByRole("link", {
      name: `첫 반응 거래 기록 ${firstReactionTx}, GIWA Sepolia Explorer에서 새 탭으로 열기`,
    });
    expect(transactionLink).toHaveTextContent(maskedHash(firstReactionTx));
    expect(transactionLink).toHaveAttribute("href", `${explorerBaseUrl}/tx/${firstReactionTx}`);
    expect(screen.getByText("스탬프").previousSibling).toHaveTextContent("0");
  });

  it("refreshes a pending First Reaction on return and keeps the displayed history while reading", async () => {
    const tx = `0x${"b".repeat(64)}`;
    const detail = {
      ...passport, stamps: [], activities: [],
      stampSummary: { knowledge: 0, reservation: 0, attendance: 0, survey: 0, total: 0 },
      progress: { currentScore: 15, currentLevel: "Silver", nextLevel: "Gold", nextThreshold: 50, remainingPoints: 35, percent: 30, maxed: false },
      nextBenefit: null,
      firstReaction: { reactionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", stampId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", activityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", reactionType: "FirstReaction", mintStatus: "queued", txHash: null, issuedAt: "2026-09-06T01:32:55Z" },
    };
    let finish!: (response: Response) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ passport: detail }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    render(<PassportDetailScreen id={passport.id} explorerBaseUrl={explorerBaseUrl} />);
    const history = await screen.findByRole("region", { name: "첫 반응" });
    expect(within(history).getByText("안전하게 발급을 준비하고 있어요")).toBeInTheDocument();
    fireEvent.focus(window);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(history).toBeInTheDocument();
    await act(async () => { finish(Response.json({ passport: { ...detail, firstReaction: { ...detail.firstReaction, mintStatus: "minted", txHash: tx } } })); });
    expect(await within(history).findByText("디지털 발급이 완료됐어요")).toBeInTheDocument();
    expect(within(history).getByRole("link")).toHaveAttribute("href", `${explorerBaseUrl}/tx/${tx}`);
    expect(screen.getByText("스탬프").previousSibling).toHaveTextContent("0");
  });

  it("preserves an archived LIVE title without exposing a dead detail link", async () => {
    const archivedContext = {
      sourceType: "live_reservation",
      sourceId: "99999999-9999-4999-8999-999999999998",
      live: { slug: "archived-live", title: "지난 KARA LIVE", linkable: false },
    };
    const activities = [{
      id: "77777777-7777-4777-8777-777777777778",
      type: "reservation",
      occurredAt: "2026-07-21T00:00:00.000Z",
      points: 1,
      stampId: stamps[1].id,
      context: archivedContext,
      display: { type: "라이브 예약" },
    }];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      passport: {
        ...passport,
        stamps: [{ ...stamps[1], context: archivedContext }],
        activities,
        progress: { currentScore: 15, currentLevel: "Silver", nextLevel: "Gold", nextThreshold: 50, remainingPoints: 35, percent: 30, maxed: false },
        nextBenefit: null,
      },
    })));
    render(<PassportDetailScreen id={passport.id} explorerBaseUrl={explorerBaseUrl} />);

    expect(await screen.findByText("지난 KARA LIVE")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "지난 KARA LIVE" })).not.toBeInTheDocument();
  });

  it("renders the authoritative owner, Level progress and next locked benefit", async () => {
    const detail = {
      ...passport,
      owner: { nickname: "눈부신팬" },
      stamps,
      activities: [],
      progress: {
        currentScore: 15,
        currentLevel: "Silver",
        nextLevel: "Gold",
        nextThreshold: 50,
        remainingPoints: 35,
        percent: 30,
        maxed: false,
      },
      nextBenefit: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        slug: "special-wallpaper",
        title: "스페셜 디지털 배경화면",
        state: "locked",
        eligibilityLabel: "Fan Score 50점 달성",
        minimumScore: 50,
        minimumLevel: "Gold",
        requiredStampType: null,
        requiredActivityType: null,
        missingConditions: [{ type: "score", current: 15, required: 50 }],
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ passport: detail })));
    render(<PassportDetailScreen id={passport.id} explorerBaseUrl={explorerBaseUrl} />);

    expect(await screen.findByText("눈부신팬")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "다음 등급: 골드" })).toHaveAttribute("value", "30");
    expect(screen.getByText("35 점 남음")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "다음 혜택: 스페셜 디지털 배경화면" })).toBeInTheDocument();
    expect(screen.getByText("팬 점수: 현재 15 / 필요 50")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /혜택 확인하기/ })).toHaveAttribute(
      "href",
      `/benefits/${detail.nextBenefit.id}?locale=ko`,
    );
  });

  it("links the masked Stamp transaction to the validated GIWA Sepolia Explorer URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ stamp: stampDetail }), { status: 200 })));
    render(<StampDetailScreen id={stampDetail.id} explorerBaseUrl={explorerBaseUrl} />);
    const summary = await screen.findByText("디지털 발급 정보");
    const disclosure = summary.closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    fireEvent.click(summary);
    const transactionLink = screen.getByRole("link", {
      name: `거래 기록 ${mint.txHash}, GIWA Sepolia Explorer에서 새 탭으로 열기`,
    });
    expect(transactionLink).toHaveTextContent("0xaaaaaa…aaaaaa");
    expect(transactionLink).not.toHaveTextContent(mint.txHash);
    expect(transactionLink).toHaveAttribute("href", `${explorerBaseUrl}/tx/${mint.txHash}`);
    expect(transactionLink).toHaveAttribute("target", "_blank");
    expect(transactionLink).toHaveAttribute("rel", "noreferrer");
    expect(screen.queryByText(/wallet/i)).not.toBeInTheDocument();
  });

  it("uses the same Explorer transaction-link contract on Passport details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      passport: {
        ...passport,
        stamps: [],
        activities: [],
        progress: { currentScore: 15, currentLevel: "Silver", nextLevel: "Gold", nextThreshold: 50, remainingPoints: 35, percent: 30, maxed: false },
        nextBenefit: null,
      },
    })));
    render(<PassportDetailScreen id={passport.id} explorerBaseUrl={`${explorerBaseUrl}/`} />);

    const summary = await screen.findByText("디지털 발급 정보");
    fireEvent.click(summary);
    expect(screen.getByRole("link", {
      name: `거래 기록 ${mint.txHash}, GIWA Sepolia Explorer에서 새 탭으로 열기`,
    })).toHaveAttribute("href", `${explorerBaseUrl}/tx/${mint.txHash}`);
  });

  it.each([
    {
      name: "an insecure Explorer URL",
      explorer: "http://sepolia-explorer.giwa.io",
      transactionHash: mint.txHash,
    },
    {
      name: "an invalid transaction hash",
      explorer: explorerBaseUrl,
      transactionHash: "0x1234",
    },
  ])("renders the transaction as text without an external link for $name", async ({ explorer, transactionHash }) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      stamp: { ...stampDetail, mint: { ...mint, txHash: transactionHash } },
    })));
    render(<StampDetailScreen id={stampDetail.id} explorerBaseUrl={explorer} />);

    fireEvent.click(await screen.findByText("디지털 발급 정보"));
    expect(screen.getByText(maskedHash(transactionHash))).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /GIWA Sepolia Explorer/ })).not.toBeInTheDocument();
  });

  it("renders no transaction link when the transaction hash is null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      stamp: { ...stampDetail, mint: { ...mint, txHash: null } },
    })));
    render(<StampDetailScreen id={stampDetail.id} explorerBaseUrl={explorerBaseUrl} />);

    fireEvent.click(await screen.findByText("디지털 발급 정보"));
    expect(screen.queryByText("거래 기록")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /GIWA Sepolia Explorer/ })).not.toBeInTheDocument();
  });

  it("provides an English transaction-link name with the full hash and new-tab purpose", async () => {
    locale = "en";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ stamp: stampDetail })));
    render(<StampDetailScreen id={stampDetail.id} explorerBaseUrl={explorerBaseUrl} />);

    fireEvent.click(await screen.findByText("Digital issuance details"));
    expect(screen.getByRole("link", {
      name: `Transaction ${mint.txHash}, open in GIWA Sepolia Explorer in a new tab`,
    })).toHaveTextContent("0xaaaaaa…aaaaaa");
  });

  it("keeps archived LIVE context in Stamp facts without a public link", async () => {
    const archivedStamp = {
      ...stampDetail,
      activity: {
        ...stampDetail.activity,
        type: "reservation",
        context: {
          sourceType: "live_reservation",
          sourceId: "99999999-9999-4999-8999-999999999998",
          live: { slug: "archived-live", title: "지난 KARA LIVE", linkable: false },
        },
        display: { type: "라이브 예약" },
      },
      type: "reservation",
      display: { ...stampDetail.display, type: "라이브 예약" },
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ stamp: archivedStamp })));
    render(<StampDetailScreen id={stampDetail.id} explorerBaseUrl={explorerBaseUrl} />);

    expect(await screen.findByText("지난 KARA LIVE")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "지난 KARA LIVE" })).not.toBeInTheDocument();
  });

  it("renders an intercepted Stamp in an accessible adaptive overlay and closes with history", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ stamp: stampDetail }), { status: 200 })));
    render(<StampDetailOverlay id={stampDetail.id} explorerBaseUrl={explorerBaseUrl} />);

    expect(await screen.findByRole("dialog", { name: "Stamp 상세" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("디지털 발급 정보"));
    expect(screen.getByRole("link", {
      name: `거래 기록 ${mint.txHash}, GIWA Sepolia Explorer에서 새 탭으로 열기`,
    })).toHaveAttribute("href", `${explorerBaseUrl}/tx/${mint.txHash}`);
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
    render(<StampDetailOverlay id={stampDetail.id} explorerBaseUrl={explorerBaseUrl} />);

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
    expect(await screen.findByRole("heading", { name: "아직 발급된 패스포트가 없어요." })).toBeInTheDocument();
  });
});
