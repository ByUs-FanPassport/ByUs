import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FAN_ACTIVITY_UPDATED } from "@/components/fan-ui/fan-activity-updates";
import { DailyCheckin } from "./daily-checkin";

const privy = vi.hoisted(() => ({
  ready: true,
  authenticated: true,
  user: { id: "owner-a" } as { id: string } | undefined,
  getAccessToken: vi.fn<() => Promise<string | null>>().mockResolvedValue("token"),
}));

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => privy }));

const mint = { status: "queued", txHash: null, tokenId: null } as const;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

describe("DailyCheckin", () => {
  afterEach(() => {
    privy.ready = true;
    privy.authenticated = true;
    privy.user = { id: "owner-a" };
    privy.getAccessToken.mockReset().mockResolvedValue("token");
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("trusts the resource KST date and reports earned dates to the calendar", async () => {
    const onCheckedDatesChange = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => response({
      today: "2026-09-14",
      stamps: [{
        id: "11111111-1111-4111-8111-111111111111",
        kind: "daily_checkin",
        celebritySlug: "kara",
        issuedAt: "2026-09-13T15:30:00.000Z",
        mint,
      }],
    })));

    render(<DailyCheckin creator="kara" locale="ko" month="2026-09" onCheckedDatesChange={onCheckedDatesChange} />);

    expect(await screen.findByRole("button", { name: "오늘 출석 완료" })).toBeDisabled();
    await waitFor(() => expect(onCheckedDatesChange).toHaveBeenLastCalledWith(["2026-09-14"]));
    expect(screen.getByText("이번 달 1일 출석")).toBeInTheDocument();
  });

  it("locks repeated clicks and refreshes owned views only after a successful POST", async () => {
    let resolvePost!: (value: Response) => void;
    const post = new Promise<Response>((resolve) => { resolvePost = resolve; });
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? post
      : Promise.resolve(response({ today: "2026-09-14", stamps: [] })));
    vi.stubGlobal("fetch", fetcher);
    const updated = vi.fn();
    window.addEventListener(FAN_ACTIVITY_UPDATED, updated);
    render(<DailyCheckin creator="kara" locale="ko" month="2026-09" onCheckedDatesChange={vi.fn()} />);
    const action = await screen.findByRole("button", { name: "오늘 출석하기" });

    fireEvent.click(action);
    fireEvent.click(action);
    await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1));
    expect(updated).not.toHaveBeenCalled();

    resolvePost(response({ awarded: true }));
    expect(await screen.findByText("오늘의 출석 스탬프를 받았어요.")).toBeInTheDocument();
    await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
    expect(updated.mock.calls[0]?.[0]).toMatchObject({ detail: { ownerId: "owner-a", resources: ["community"] } });
    window.removeEventListener(FAN_ACTIVITY_UPDATED, updated);
  });

  it("does not announce or mark a failed check-in as earned", async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(init?.method === "POST"
      ? response({ error: { code: "COMMUNITY_STAMP_UNAVAILABLE" } }, 503)
      : response({ today: "2026-09-14", stamps: [] })));
    vi.stubGlobal("fetch", fetcher);
    const updated = vi.fn();
    const onCheckedDatesChange = vi.fn();
    window.addEventListener(FAN_ACTIVITY_UPDATED, updated);
    render(<DailyCheckin creator="kara" locale="ko" month="2026-09" onCheckedDatesChange={onCheckedDatesChange} />);

    fireEvent.click(await screen.findByRole("button", { name: "오늘 출석하기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("출석하지 못했어요");
    expect(updated).not.toHaveBeenCalled();
    expect(onCheckedDatesChange).not.toHaveBeenCalledWith(expect.arrayContaining(["2026-09-14"]));
    expect(screen.getByRole("button", { name: "오늘 출석하기" })).toBeEnabled();
    window.removeEventListener(FAN_ACTIVITY_UPDATED, updated);
  });

  it("waits for an authenticated owner key before reading or mutating", () => {
    privy.user = undefined;
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    render(<DailyCheckin creator="kara" locale="en" month="2026-09" onCheckedDatesChange={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("Checking your attendance");
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
