import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextPassportBenefit } from "../../passport/domain/passport-detail";
import type { PassportCreator } from "../domain/my-progress";
import { MyBenefitProgress } from "./my-benefit-progress";

const { owner } = vi.hoisted(() => ({ owner: { id: "owner-a" } }));
const getAccessToken = vi.fn(async () => "test-token");
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true, user: owner, getAccessToken }) }));
afterEach(() => { owner.id = "owner-a"; });
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const creators: PassportCreator[] = ids.map((id, index) => ({
  celebrity: { slug: index ? "katseye" : "kara", name: index ? "KATSEYE" : "KARA", image: "/test.jpg" },
  relationship: "passport", passport: { id, tier: "Silver", score: 8, remainingToNextTier: 7 }, firstReaction: null, ticketBalance: 0,
}));
const benefit: NextPassportBenefit = {
  id: "33333333-3333-4333-8333-333333333333", slug: "fan-note", title: "팬 웰컴 노트", state: "locked",
  allocationMode: "direct_claim", applicationStatus: null, eligibilityLabel: "팬 점수 15점과 LIVE 출석", minimumScore: 15, minimumLevel: "Silver",
  requiredStampType: "attendance", requiredActivityType: "survey",
  missingConditions: [{ type: "score", current: 8, required: 15 }, { type: "level", current: "Bronze", required: "Silver" }, { type: "stamp", required: "attendance" }, { type: "activity", required: "survey" }, { type: "opens_at", at: "2027-01-01T00:00:00Z" }],
};
function payload(index: number, nextBenefit: NextPassportBenefit | null = benefit, points = 8) {
  return { passport: { id: ids[index], celebrity: creators[index].celebrity, score: { points, level: "Silver" }, nextBenefit } };
}

describe("MY next benefit", () => {
  it("shows a compact creator-specific empty benefit without hiding an available benefit's conditions", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes(ids[1]) ? payload(1) : payload(0, null))));
    const view = render(<MyBenefitProgress creator={creators[0]} locale="ko" compact/>);
    expect(await screen.findByText("현재 KARA의 다음 혜택이 없어요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "혜택 보기" })).toHaveAttribute("href", "/benefits?locale=ko&celebrity=kara");
    view.rerender(<MyBenefitProgress creator={creators[1]} locale="ko" compact/>);
    expect(await screen.findByRole("heading", { name: benefit.title })).toBeInTheDocument();
    expect(screen.queryByText("현재 KARA의 다음 혜택이 없어요.")).not.toBeInTheDocument();
    expect(screen.getByText("7점 더 필요해요.")).toBeInTheDocument();
    expect(screen.getByText("후기 참여 완료 필요")).toBeInTheDocument();
  });
  it("fetches only the controlled favorite and follows a shared selection change", async () => {
    const fetcher = vi.fn(async (url: string) => Response.json(url.includes(ids[1]) ? payload(1, { ...benefit, title: "다른 최애의 혜택", state: "eligible", missingConditions: [] }, 20) : payload(0, null)));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<MyBenefitProgress creator={creators[0]} locale="ko"/>);
    expect(await screen.findByText("현재 이 최애의 다음 혜택이 없어요.")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    view.rerender(<MyBenefitProgress creator={creators[1]} locale="ko"/>);
    expect(await screen.findByRole("heading", { name: "다른 최애의 혜택" })).toBeInTheDocument();
    expect(screen.getByText("조건 충족")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "100");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("renders score progress separately from every other unmet condition", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload(0))));
    render(<MyBenefitProgress creator={creators[0]} locale="ko"/>);
    expect(await screen.findByRole("progressbar", { name: "팬 점수 조건 달성률" })).toHaveAttribute("value", "53");
    expect(screen.getByText("7점 더 필요해요.")).toBeInTheDocument();
    expect(screen.getByText("실버 등급 필요")).toBeInTheDocument();
    expect(screen.getByText("라이브 출석 스탬프 필요")).toBeInTheDocument();
    expect(screen.getByText("후기 참여 완료 필요")).toBeInTheDocument();
    expect(screen.getByText(/신청·수령 시작:/)).toHaveTextContent("KST");
  });
  it.each([
    [null, "Conditions met · Applications open"], ["submitted", "Applied · Awaiting selection"],
    ["selected", "Selected"], ["not_selected", "Not selected"],
  ] as const)("distinguishes selection status %s without promising receipt", async (status, text) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload(0, { ...benefit, allocationMode: "application_selection", applicationStatus: status, state: "eligible", minimumScore: 0, missingConditions: [] }))));
    render(<MyBenefitProgress creator={creators[0]} locale="en"/>);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByText("Benefits are provided based on the selection result after you apply.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View benefit" })).toHaveAttribute("href", `/benefits/${benefit.id}?locale=en`);
  });
  it("isolates a delayed old selection and supports retry after a local failure", async () => {
    let resolveOld!: (response: Response) => void;
    let fail = true;
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes(ids[0]) ? new Promise<Response>(resolve => { resolveOld = resolve; }) : Promise.resolve(fail ? new Response("unavailable", { status: 503 }) : Response.json(payload(1, { ...benefit, title: "새 최애 혜택" })))));
    const view = render(<MyBenefitProgress creator={creators[0]} locale="ko"/>);
    await waitFor(() => expect(resolveOld).toBeDefined());
    view.rerender(<MyBenefitProgress creator={creators[1]} locale="ko"/>);
    expect(await screen.findByText("다음 혜택을 불러오지 못했어요.")).toBeInTheDocument();
    await act(async () => resolveOld(Response.json(payload(0))));
    expect(screen.queryByText("팬 웰컴 노트")).not.toBeInTheDocument();
    fail = false;
    screen.getByRole("button", { name: "다시 시도" }).click();
    expect(await screen.findByRole("heading", { name: "새 최애 혜택" })).toBeInTheDocument();
  });
  it("drops the previous owner's and language's content while replacement loads", async () => {
    let pending!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(async () => Response.json(payload(0))).mockImplementation(() => new Promise<Response>(resolve => { pending = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<MyBenefitProgress creator={creators[0]} locale="ko"/>);
    await screen.findByRole("heading", { name: benefit.title });
    owner.id = "owner-b";
    view.rerender(<MyBenefitProgress creator={creators[0]} locale="en"/>);
    expect(screen.queryByRole("heading", { name: benefit.title })).not.toBeInTheDocument();
    expect(screen.getByText("Loading your next benefit.")).toBeInTheDocument();
    await waitFor(() => expect(pending).toBeDefined());
    await act(async () => pending(Response.json(payload(0, null))));
    expect(await screen.findByText("No next benefit for this favorite right now.")).toBeInTheDocument();
  });
});
