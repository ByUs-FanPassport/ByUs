import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LiveEventScreen } from "./live-event-screen";

const getAccessToken = vi.fn(async () => "access-token");
let authenticated = true;

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated, getAccessToken }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/live/kara-nualeaf",
  useSearchParams: () => new URLSearchParams("locale=ko"),
}));

const reservation = {
  id: "a1f86df9-f5e4-4ee1-b375-d18092b63e6a",
  createdAt: "2026-07-21T02:00:00.000Z",
  stamp: {
    id: "af425d21-e8aa-4a7e-b20f-57b019b94b37",
    businessStatus: "issued",
    mintStatus: "queued",
  },
};

const attendanceResult = {
  attendance: {
    id: "22222222-2222-4222-8222-222222222222",
    liveEventId: "819b52d9-62c3-450c-b3dc-78d84d2238c6",
    attendedAt: "2026-07-24T12:10:00.000Z",
    scorePoints: 3,
    stamp: {
      id: "44444444-4444-4444-8444-444444444444",
      businessStatus: "issued",
      mintStatus: "queued",
    },
  },
};

function payload(primaryAction = "reserve", withReservation = false) {
  return {
    live: {
      id: "819b52d9-62c3-450c-b3dc-78d84d2238c6",
      slug: "kara-nualeaf",
      effectiveStatus: "scheduled",
      startsAt: "2026-07-24T11:00:00.000Z",
      endsAt: "2026-07-24T12:00:00.000Z",
      reservationOpensAt: "2026-07-20T00:00:00.000Z",
      reservationClosesAt: "2026-07-24T11:00:00.000Z",
      title: "KARA × NUALEAF LIVE",
      description: "KARA와 함께하는 특별한 LIVE를 준비했어요.",
      productContext: "Official Photocard 응모 가능",
      heroImage: { url: "/images/live/kara-hero-group.jpg", alt: "KARA 멤버 다섯 명" },
      celebrity: { slug: "kara", name: "KARA", image: "/images/guest-home/kara-card.jpg" },
      brand: { slug: "nualeaf", name: "NUALEAF", logo: "/images/brand.png", websiteUrl: "https://example.com" },
      watch: { available: false, url: "https://youtube.com/live/abc123" },
    },
    viewer: { authenticated, passport: "active", reservation: withReservation ? reservation : null },
    primaryAction,
  };
}

describe("LiveEventScreen", () => {
  beforeEach(() => {
    authenticated = true;
    vi.restoreAllMocks();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); });
  });

  it("renders the localized live details and the only spectrum reservation action", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(payload()), { status: 200 }));
    const { container } = render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    expect(await screen.findByRole("heading", { name: "KARA × NUALEAF LIVE" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /라이브 예약하기/ })).toBeInTheDocument();
    expect(container.querySelectorAll('[class*="spectrumAction"]')).toHaveLength(1);
    expect(screen.getAllByText("Official Photocard 응모 가능")).toHaveLength(2);
  });

  it("restores unauthenticated reservation intent through login returnTo", async () => {
    authenticated = false;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(payload("sign_in_to_reserve")), { status: 200 }));
    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    const link = await screen.findByRole("link", { name: /로그인하고 예약하기/ });
    expect(link.getAttribute("href")).toContain("intent=reserve");
    expect(link.getAttribute("href")).toContain(encodeURIComponent("/live/kara-nualeaf?locale=ko"));
  });

  it("QA-RSVP-001 sends a fan without a Passport to verification without posting a reservation", async () => {
    const missingPassport = payload("verify_fan");
    missingPassport.viewer.passport = "missing";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(missingPassport), { status: 200 }),
    );

    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);

    expect(await screen.findByRole("link", { name: /팬 인증하고 예약하기/ }))
      .toHaveAttribute("href", "/c/kara/verify");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("posts one idempotent reservation, refreshes the projection, and opens FAN-014", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(payload()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ reservation }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload("reserved", true)), { status: 200 }));
    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    fireEvent.click(await screen.findByRole("button", { name: /라이브 예약하기/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "예약이 완료되었습니다" })).toBeInTheDocument();
    expect(screen.getByText("Reservation Stamp 적립 완료")).toBeInTheDocument();
    const request = fetchMock.mock.calls[1];
    expect(request[0]).toBe("/api/live-events/819b52d9-62c3-450c-b3dc-78d84d2238c6/reservation");
    expect(request[1]).toEqual(expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "content-type": "application/json" }),
      body: expect.any(String),
    }));
    expect(JSON.parse(String(request[1]?.body))).toEqual({ idempotencyKey: expect.any(String) });
  });

  it("shows reserved state and Calendar as a secondary action without cancellation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(payload("reserved", true)), { status: 200 }));
    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    expect(await screen.findByRole("button", { name: /예약 완료/ })).toBeDisabled();
    expect(screen.getByRole("link", { name: /Google Calendar에 추가/ })).toHaveAttribute("target", "_blank");
    expect(screen.queryByText(/취소하기/)).not.toBeInTheDocument();
  });

  it("opens YouTube safely and stores the exact fan-code return route", async () => {
    const watchPayload = payload("watch_live", true);
    watchPayload.live.effectiveStatus = "live";
    watchPayload.live.watch = { available: true, url: "https://youtube.com/live/abc123" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(watchPayload), { status: 200 }));
    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    const watch = await screen.findByRole("link", { name: /YouTube LIVE 입장/ });
    expect(watch).toHaveAttribute("target", "_blank");
    expect(watch).toHaveAttribute("rel", "noopener noreferrer");
    fireEvent.click(watch);
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem("byus:live-return") ?? "{}").route).toBe("/live/kara-nualeaf?locale=ko#fan-code"));
  });

  it("posts the normalized Fan Code with an idempotency header and shows Attendance Stamp +3", async () => {
    const livePayload = payload("watch_live");
    livePayload.live.effectiveStatus = "live";
    livePayload.live.watch = { available: true, url: "https://youtube.com/live/abc123" };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(livePayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(attendanceResult), { status: 200 }));

    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    const input = await screen.findByRole("textbox", { name: "Fan Code 입력" });
    fireEvent.change(input, { target: { value: " kara 2026 " } });
    fireEvent.click(screen.getByRole("button", { name: "출석 인증하기" }));

    expect(await screen.findByRole("heading", { name: "LIVE 출석을 남겼어요" })).toBeInTheDocument();
    expect(screen.getByText("Attendance Stamp와 Fan Score +3이 기록되었습니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /설문 참여/ })).toHaveAttribute("href", "/live/kara-nualeaf/survey?locale=ko");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/live-events/kara-nualeaf/attendance");
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "content-type": "application/json", "idempotency-key": expect.any(String) }),
      body: JSON.stringify({ code: "KARA2026" }),
    }));
    expect(screen.queryByRole("textbox", { name: "Fan Code 입력" })).not.toBeInTheDocument();
  });

  it("supports retroactive attendance without a reservation and clears an invalid code", async () => {
    const endedPayload = payload("live_ended", false);
    endedPayload.live.effectiveStatus = "ended";
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(endedPayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "ATTENDANCE_CODE_INVALID" } }), { status: 422 }));

    render(<LiveEventScreen slug="kara-nualeaf" locale="en" />);
    const input = await screen.findByRole("textbox", { name: "Enter Fan Code" });
    fireEvent.change(input, { target: { value: "NOPE" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify attendance" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That Fan Code isn’t valid");
    expect(input).toHaveValue("");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("QA-ATT-003 records walk-in attendance after the LIVE without creating a reservation", async () => {
    const endedPayload = payload("live_ended", false);
    endedPayload.live.effectiveStatus = "ended";
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(endedPayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(attendanceResult), { status: 200 }));

    render(<LiveEventScreen slug="kara-nualeaf" locale="en" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Enter Fan Code" }), {
      target: { value: "KARA2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify attendance" }));

    expect(await screen.findByRole("heading", { name: "Your LIVE attendance is recorded" })).toBeInTheDocument();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/live-events/kara-nualeaf/attendance");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/reservation"))).toBe(false);
  });

  it("QA-ATT-005 blocks attendance without a Passport and links to fan verification", async () => {
    const missingPassport = payload("verify_fan", false);
    missingPassport.live.effectiveStatus = "ended";
    missingPassport.viewer.passport = "missing";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(missingPassport), { status: 200 }),
    );

    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);

    expect(await screen.findByText("Fan Passport 발급 후 참여할 수 있어요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fan Passport 발급하기" }))
      .toHaveAttribute("href", "/c/kara/verify");
    expect(screen.queryByRole("textbox", { name: "Fan Code 입력" })).not.toBeInTheDocument();
  });

  it("QA-ATT-006 keeps Fan Code attendance available after the LIVE has ended", async () => {
    const endedPayload = payload("live_ended", false);
    endedPayload.live.effectiveStatus = "ended";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(endedPayload), { status: 200 }),
    );

    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);

    expect(await screen.findByRole("textbox", { name: "Fan Code 입력" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "출석 인증하기" })).toBeInTheDocument();
  });

  it("shows a rate-limit countdown and disables further attempts", async () => {
    const livePayload = payload("watch_live");
    livePayload.live.effectiveStatus = "live";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(livePayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "ATTENDANCE_RATE_LIMITED" } }), { status: 429, headers: { "retry-after": "60" } }));

    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    const input = await screen.findByRole("textbox", { name: "Fan Code 입력" });
    fireEvent.change(input, { target: { value: "KARA2026" } });
    fireEvent.click(screen.getByRole("button", { name: "출석 인증하기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/1:00 후 다시 시도/);
    expect(input).toBeDisabled();
  });

  it("reuses the idempotency key for a safe network retry without persisting the Fan Code", async () => {
    const livePayload = payload("watch_live");
    livePayload.live.effectiveStatus = "live";
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(livePayload), { status: 200 }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify(attendanceResult), { status: 200 }));

    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    const input = await screen.findByRole("textbox", { name: "Fan Code 입력" });
    fireEvent.change(input, { target: { value: "KARA2026" } });
    fireEvent.click(screen.getByRole("button", { name: "출석 인증하기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("지금은 출석을 확인할 수 없어요");
    expect(input).toHaveValue("KARA2026");

    fireEvent.click(screen.getByRole("button", { name: "출석 인증하기" }));
    expect(await screen.findByText("이미 완료한 출석 기록을 안전하게 확인했어요.")).toBeInTheDocument();
    expect((fetchMock.mock.calls[1][1]?.headers as Record<string, string>)["idempotency-key"])
      .toBe((fetchMock.mock.calls[2][1]?.headers as Record<string, string>)["idempotency-key"]);
    expect(sessionStorage.getItem("KARA2026")).toBeNull();
  });
});
