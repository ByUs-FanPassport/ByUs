import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BenefitDetailScreen, BenefitsScreen } from "./benefit-screen";

const getAccessToken = vi.fn(async () => "token");
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true, getAccessToken }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

const benefit = { id:"819b52d9-62c3-450c-b3dc-78d84d2238c6",slug:"fan-call",title:"KARA 영상 메시지",summary:"함께한 기록을 위한 영상 메시지",eligibilityLabel:"Gold 이상",deliveryLabel:"수령 후 코드 제공",deliveryType:"unique_code",claimOpensAt:"2026-07-20T00:00:00.000Z",claimClosesAt:"2026-08-20T00:00:00.000Z",minimumScore:10,minimumLevel:"Gold",requiredStampType:null,requiredActivityType:null,state:"eligible" } as const;
const celebrities = { celebrities: [{ slug: "kara", name: "KARA" }] };

describe("benefit screens", () => {
  beforeEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => undefined) } }); });
  it("loads API celebrities and benefits, preserving locale and celebrity in detail routes", async () => {
    vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(new Response(JSON.stringify(celebrities))).mockResolvedValueOnce(new Response(JSON.stringify({ benefits:[benefit] })));
    render(<BenefitsScreen locale="ko" />);
    expect(await screen.findByRole("heading",{name:"KARA 영상 메시지"})).toBeInTheDocument();
    expect(screen.getByRole("link",{name:/혜택 자세히 보기/})).toHaveAttribute("href",expect.stringContaining("locale=ko&celebrity=kara"));
  });
  it("renders a useful empty state", async () => {
    vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(new Response(JSON.stringify(celebrities))).mockResolvedValueOnce(new Response(JSON.stringify({ benefits:[] })));
    render(<BenefitsScreen locale="ko" initialCelebrity="kara" />);
    expect(await screen.findByText("이 셀럽의 공개된 혜택이 아직 없어요.")).toBeInTheDocument();
  });
  it("claims once on rapid clicks and reveals the delivery secret only after success", async () => {
    const fetchMock=vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(new Response(JSON.stringify({benefit}))).mockResolvedValueOnce(new Response(JSON.stringify({claimId:"a1f86df9-f5e4-4ee1-b375-d18092b63e6a",benefitId:benefit.id,deliveryType:"unique_code",deliveryValue:"SECRET-42",claimedAt:"2026-07-21T00:00:00.000Z",replayed:false})));
    render(<BenefitDetailScreen benefitId={benefit.id} locale="ko" celebrity="kara" />);
    const button=await screen.findByRole("button",{name:/혜택 수령하기/}); expect(screen.queryByText("SECRET-42")).not.toBeInTheDocument(); fireEvent.click(button); fireEvent.click(button);
    expect(await screen.findByText("SECRET-42")).toBeInTheDocument(); expect(fetchMock).toHaveBeenCalledTimes(2);
    const claimCall=fetchMock.mock.calls[1]; expect(claimCall[0]).toContain("/claim"); expect(JSON.parse(String(claimCall[1]?.body))).toEqual({idempotencyKey:expect.any(String)});
  });
  it("uses a safe external link after an external URL claim", async () => {
    vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(new Response(JSON.stringify({benefit}))).mockResolvedValueOnce(new Response(JSON.stringify({claimId:"a1f86df9-f5e4-4ee1-b375-d18092b63e6a",benefitId:benefit.id,deliveryType:"external_url",deliveryValue:"https://example.com/redeem",claimedAt:"2026-07-21T00:00:00.000Z",replayed:false})));
    render(<BenefitDetailScreen benefitId={benefit.id} locale="en" />); fireEvent.click(await screen.findByRole("button",{name:/Claim benefit/}));
    const link=await screen.findByRole("link",{name:/Open benefit/}); expect(link).toHaveAttribute("target","_blank"); expect(link).toHaveAttribute("rel","noopener noreferrer");
  });
  it("offers retry on an API failure", async () => { vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(null,{status:503})); render(<BenefitDetailScreen benefitId={benefit.id} locale="ko" />); expect(await screen.findByRole("button",{name:"다시 불러오기"})).toBeInTheDocument(); });
});
