import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LiveEventScreen, formatReservationDateTime, formatReservationDeadline } from "./live-event-screen";
import { createAuthIntent, persistAuthIntent } from "@/components/auth-intent";

const getAccessToken = vi.fn(async () => "access-token");
let authenticated = true;
const push = vi.fn();
let query = "locale=ko";

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated, getAccessToken }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/live/kara-nualeaf",
  useSearchParams: () => new URLSearchParams(query),
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
const reservationCompletion = {
  passportId: "33333333-3333-4333-8333-333333333333",
  earnedStamp: {
    id: reservation.stamp.id,
    type: "reservation",
    issuedAt: reservation.createdAt,
    businessStatus: "issued",
    mintStatus: "queued",
  },
  scoreDelta: 1,
  updatedScore: 5,
  updatedLevel: "Silver",
  leveledUp: true,
};

const attendanceResult = {
  attendance: {
    id: "22222222-2222-4222-8222-222222222222",
    liveEventId: "819b52d9-62c3-450c-b3dc-78d84d2238c6",
    passportId: "33333333-3333-4333-8333-333333333333",
    attendedAt: "2026-07-24T12:10:00.000Z",
    scorePoints: 3,
    stamp: {
      id: "44444444-4444-4444-8444-444444444444",
      businessStatus: "issued",
      mintStatus: "queued",
    },
  },
  completion: {
    passportId: "33333333-3333-4333-8333-333333333333",
    earnedStamp: {
      id: "44444444-4444-4444-8444-444444444444",
      type: "attendance",
      issuedAt: "2026-07-24T12:10:00.000Z",
      businessStatus: "issued",
      mintStatus: "queued",
    },
    scoreDelta: 3,
    updatedScore: 8,
    updatedLevel: "Silver",
    leveledUp: false,
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
      celebrity: {
        slug: "kara",
        name: "KARA",
        image: "/images/guest-home/kara-card.jpg",
        fanCount: 12_800_000,
      },
      brand: { slug: "nualeaf", name: "NUALEAF", logo: "/images/brand.png", websiteUrl: "https://example.com" },
      watch: { available: false, provider: "youtube", url: "https://youtube.com/live/abc123" },
    },
    viewer: { authenticated, passport: "active", reservation: withReservation ? reservation : null },
    primaryAction,
  };
}

describe("LiveEventScreen", () => {
  it.each(["locked", "eligible", "claimed"] as const)("preserves the collectible %s state in the compact reward card", async (state) => {
    const response = payload();
    const collectible = {
      eligible: state === "eligible",
      claimWindow: { from: "2026-09-18T12:30:00Z", until: "2026-09-20T12:30:00Z" },
      claim: state === "claimed" ? {
        id: "11111111-1111-4111-8111-111111111111",
        liveEventId: response.live.id,
        journeyCompletionId: "22222222-2222-4222-8222-222222222222",
        businessStatus: "claimed",
        claimedAt: "2026-09-18T13:00:00Z",
        mint: { status: "queued", txHash: null, tokenId: null },
      } : null,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ...response, viewer: { ...response.viewer, collectible } }), { status: 200 }));
    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    const card = await screen.findByRole("region", { name: "Digital Collectible" });
    const action = within(card).queryByRole("button", { name: "Collectible 받기" });
    if (state === "eligible") expect(action).toBeEnabled();
    else expect(action).not.toBeInTheDocument();
    if (state === "locked") expect(within(card).getByText("Journey 완료와 LIVE 종료 후 받을 수 있어요.")).toBeVisible();
    if (state === "claimed") expect(within(card).getByLabelText("Claim 완료")).toBeVisible();
  });
  it.each([false, true, null])("keeps mission availability truthful: %s", async (available) => {
    const response = payload();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ...response, live: { ...response.live, missionsAvailable: available } }), { status: 200 }));
    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    await screen.findByRole("heading", { name: "KARA × NUALEAF LIVE" });
    if (available === false) {
      expect(screen.getByRole("button", { name: "LIVE 미션 보기" })).toBeDisabled();
      expect(screen.getByText("현재 참여 가능한 미션이 없어요.")).toBeVisible();
      expect(screen.queryByRole("link", { name: "LIVE 미션 보기" })).not.toBeInTheDocument();
    } else {
      expect(screen.getByRole("link", { name: "LIVE 미션 보기" })).toHaveAttribute("href", "/live/kara-nualeaf/missions?locale=ko");
      expect(screen.queryByText("현재 참여 가능한 미션이 없어요.")).not.toBeInTheDocument();
      if (available === null) expect(screen.getByText("미션 목록에서 참여 가능 여부를 확인해 주세요.")).toBeVisible();
    }
  });
  beforeEach(() => {
    authenticated = true;
    query = "locale=ko";
    push.mockReset();
    sessionStorage.clear();
    vi.restoreAllMocks();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); });
  });

  it("renders the localized live details and the only spectrum reservation action", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(payload()), { status: 200 }));
    const { container } = render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    expect(await screen.findByRole("heading", { name: "KARA × NUALEAF LIVE" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "LIVE 예약하기" }))
      .toHaveAttribute("data-fan-action-emphasis", "primary");
    expect(screen.getByRole("button", { name: "LIVE 예약하기" })
      .closest("[data-live-primary-action-slot]")).not.toBeNull();
    expect(container.querySelectorAll('[data-fan-action-emphasis="primary"]')).toHaveLength(1);
    expect(screen.getAllByText("Official Photocard 응모 가능")).toHaveLength(1);
    expect(screen.getByText("LIVE에 참여하고, 최애와 함께한 순간을 기록과 혜택으로 남겨보세요.")).toBeInTheDocument();
    expect(screen.getByText("12.8M Fans")).toBeInTheDocument();
    const schedule = screen.getByLabelText("LIVE 예약 정보");
    expect(within(schedule).getByText("기준 시간 KST (GMT+9)")).toBeInTheDocument();
    expect(within(schedule).getByText("예약 마감")).toBeInTheDocument();
    const disclosure = within(schedule).getByText("예약 전체 기간").closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(disclosure?.querySelector('time[datetime="2026-07-20T00:00:00.000Z"]')).not.toBeNull();
    expect(within(schedule).getByRole("link", { name:"LIVE 미션 보기" })).toHaveAttribute("href", "/live/kara-nualeaf/missions?locale=ko");
    expect(within(schedule).getAllByText(/GMT\+9/)).toHaveLength(1);
    expect(within(schedule).queryByText("NUALEAF", { selector: "p" })).not.toBeInTheDocument();
  });

  it("renders a poster-first landscape Preview with an accessible playback control", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    const basePayload = payload();
    const withPreview = {
      ...basePayload,
      live: {
        ...basePayload.live,
        preview: {
          kind: "artist_teaser",
          durationMs: 4_000,
          landscape: {
            videoUrl: "https://assets.example/kara-landscape.mp4",
            posterUrl: "https://assets.example/kara-landscape.webp",
          },
        },
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(withPreview), { status: 200 }),
    );

    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    const video = await screen.findByTestId("active-preview-video");
    expect(video).toHaveAttribute(
      "poster",
      "https://assets.example/kara-landscape.webp",
    );
    expect(
      screen.getByRole("button", { name: "Preview 일시정지" }),
    ).toBeInTheDocument();
  });

  it("keeps LIVE current across desktop and mobile navigation and preserves locale switching", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload()), { status: 200 }),
    );
    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);

    await screen.findByRole("heading", { name: "KARA × NUALEAF LIVE" });
    const primary = screen.getByRole("navigation", { name: "주요 메뉴" });
    const bottom = screen.getByRole("navigation", { name: "모바일 주요 메뉴" });
    expect(within(primary).getByRole("link", { name: "LIVE" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(bottom).getByRole("link", { name: "LIVE" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "언어 선택, 현재 한국어" })).toHaveAttribute(
      "href",
      "/live/kara-nualeaf?locale=en",
    );
  });

  it("restores unauthenticated reservation intent through login returnTo", async () => {
    authenticated = false;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(payload("sign_in_to_reserve")), { status: 200 }));
    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    const link = await screen.findByRole("link", { name: "로그인하기" });
    expect(link.getAttribute("href")).toContain("intent=reserve");
    expect(link.getAttribute("href")).toContain(encodeURIComponent("/live/kara-nualeaf?locale=ko"));
    expect(link).toHaveAccessibleDescription("LIVE를 예약하려면 먼저 로그인해 주세요.");
    expect(link.closest("[data-live-primary-action-slot]")).not.toBeNull();
  });

  it("keeps a guest Fan Code outside the intent payload and resumes through an exact stored action", async () => {
    authenticated = false;
    const livePayload = payload("watch_live");
    livePayload.live.effectiveStatus = "live";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(livePayload), { status: 200 }));

    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Fan Code 입력" }), { target: { value: " kara 2026 " } });
    fireEvent.click(screen.getByRole("button", { name: "로그인하고 출석 인증하기" }));

    expect(sessionStorage.getItem("byus:fan-code-draft:kara-nualeaf")).toBe("KARA2026");
    const stored = [...Array(sessionStorage.length)].map((_, index) => sessionStorage.key(index)).find((key) => key?.startsWith("byus:auth-intent:v1:"));
    expect(stored).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem(stored!)!)).toMatchObject({
      actionType: "SUBMIT_FAN_CODE",
      targetType: "live_event",
      targetId: "kara-nualeaf",
      draftPayload: { draftRef: "byus:fan-code-draft:kara-nualeaf" },
    });
    expect(JSON.stringify(JSON.parse(sessionStorage.getItem(stored!)!))).not.toContain("KARA2026");
    expect(push).toHaveBeenCalledWith(expect.stringContaining("authIntent="));
  });

  it("restores and submits the guest Fan Code once after authentication", async () => {
    const draftRef = "byus:fan-code-draft:kara-nualeaf";
    sessionStorage.setItem(draftRef, "KARA2026");
    const intent = createAuthIntent({
      sourcePath: "/live/kara-nualeaf",
      sourceQuery: "?locale=ko",
      returnAnchor: "#fan-code",
      actionType: "SUBMIT_FAN_CODE",
      targetType: "live_event",
      targetId: "kara-nualeaf",
      draftPayload: { draftRef },
    });
    persistAuthIntent(sessionStorage, intent);
    query = `locale=ko&authIntent=${intent.id}`;
    const livePayload = payload("watch_live");
    livePayload.live.effectiveStatus = "live";
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(livePayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(attendanceResult), { status: 200 }));

    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);

    expect(await screen.findByRole("heading", { name: "LIVE 출석을 남겼어요" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/attendance"))).toHaveLength(1);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ code: "KARA2026" });
    expect(sessionStorage.getItem(draftRef)).toBeNull();
    expect(sessionStorage.getItem(`byus:auth-intent:v1:${intent.id}`)).toBeNull();
  });

  it("QA-RSVP-001 sends a fan without a Passport to verification without posting a reservation", async () => {
    const missingPassport = payload("verify_fan");
    missingPassport.viewer.passport = "missing";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(missingPassport), { status: 200 }),
    );

    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);

    expect(await screen.findByRole("link", { name: "팬 인증하기" }))
      .toHaveAttribute("href", "/c/kara/verify?locale=ko");
    expect(screen.getByRole("link", { name: "팬 인증하기" }))
      .toHaveAccessibleDescription("예약하려면 KARA Fan Passport가 필요해요.");
    expect(screen.getByRole("link", { name: "팬 인증하기" })
      .closest("[data-live-primary-action-slot]")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("posts one idempotent reservation, refreshes the projection, and opens FAN-014", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(payload()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ reservation, completion: reservationCompletion }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload("reserved", true)), { status: 200 }));
    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    fireEvent.click(await screen.findByRole("button", { name: "LIVE 예약하기" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "예약이 완료되었습니다" })).toBeInTheDocument();
    expect(screen.getByText("라이브 예약 Stamp")).toBeInTheDocument();
    expect(screen.getByText("총점").parentElement).toHaveTextContent("5");
    expect(screen.getByText("상승 · 실버")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Passport에서 확인하기" })).toHaveAttribute(
      "href",
      "/passports/33333333-3333-4333-8333-333333333333?locale=ko",
    );
    const request = fetchMock.mock.calls[1];
    expect(request[0]).toBe("/api/live-events/819b52d9-62c3-450c-b3dc-78d84d2238c6/reservation");
    expect(request[1]).toEqual(expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "content-type": "application/json" }),
      body: expect.any(String),
    }));
    expect(JSON.parse(String(request[1]?.body))).toEqual({ idempotencyKey: expect.any(String) });
  });

  it("automatically resumes one matching reservation action after login", async () => {
    const intent = createAuthIntent({ sourcePath: "/live/kara-nualeaf", sourceQuery: "?locale=ko", actionType: "RESERVE_LIVE", targetType: "live_event", targetId: "kara-nualeaf" });
    persistAuthIntent(sessionStorage, intent);
    query = `locale=ko&authIntent=${intent.id}`;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(payload()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ reservation, completion: reservationCompletion }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload("reserved", true)), { status: 200 }));

    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/reservation"))).toHaveLength(1);
    await waitFor(() => expect(sessionStorage.getItem(`byus:auth-intent:v1:${intent.id}`)).toBeNull());
  });

  it("shows reserved state and Calendar as a secondary action without cancellation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(payload("reserved", true)), { status: 200 }));
    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    expect(await screen.findByRole("status")).toHaveTextContent("예약 완료");
    expect(screen.queryByRole("button", { name: /예약 완료/ })).not.toBeInTheDocument();
    expect(document.querySelector("[data-live-primary-action-slot]")).toBeNull();
    expect(screen.getByRole("link", { name: /Google Calendar에 추가/ })).toHaveAttribute("target", "_blank");
    expect(screen.queryByText(/취소하기/)).not.toBeInTheDocument();
  });

  it("opens an external LIVE safely and stores the exact fan-code return route", async () => {
    const watchPayload = payload("watch_live", true);
    watchPayload.live.effectiveStatus = "live";
    watchPayload.live.watch = { available: true, provider: "instagram", url: "https://www.instagram.com/example/live/" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(watchPayload), { status: 200 }));
    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    const watch = await screen.findByRole("link", {
      name: "LIVE 보러가기: KARA × NUALEAF LIVE, 새 창",
    });
    expect(watch).toHaveAttribute("target", "_blank");
    expect(watch).toHaveAttribute("rel", "noopener noreferrer");
    expect(watch).toHaveAccessibleName(
      "LIVE 보러가기: KARA × NUALEAF LIVE, 새 창",
    );
    expect(watch).toHaveAccessibleDescription("외부 LIVE가 새 창에서 열려요.");
    expect(watch.closest("[data-live-primary-action-slot]")).not.toBeNull();
    fireEvent.click(watch);
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem("byus:live-return") ?? "{}").route).toBe("/live/kara-nualeaf?locale=ko#fan-code"));
  });

  it("connects the skip link and gives secondary external actions contextual names", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload("reserved", true)), { status: 200 }),
    );
    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);

    await screen.findByRole("heading", { name: "KARA × NUALEAF LIVE" });
    expect(screen.getByRole("link", { name: "본문으로 바로가기" })).toHaveAttribute(
      "href",
      "#live-detail-main",
    );
    expect(document.querySelector("main")).toHaveAttribute("id", "live-detail-main");
    expect(
      screen.getByRole("link", {
        name: "Google Calendar에 추가: KARA × NUALEAF LIVE, 새 창",
      }),
    ).toHaveAttribute("target", "_blank");
  });

  it("posts the normalized Fan Code with an idempotency header and shows Attendance Stamp +3", async () => {
    const livePayload = payload("watch_live");
    livePayload.live.effectiveStatus = "live";
    livePayload.live.watch = { available: true, provider: "youtube", url: "https://youtube.com/live/abc123" };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(livePayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(attendanceResult), { status: 200 }));

    render(<LiveEventScreen slug="kara-nualeaf" locale="ko" />);
    const input = await screen.findByRole("textbox", { name: "Fan Code 입력" });
    fireEvent.change(input, { target: { value: " kara 2026 " } });
    fireEvent.click(screen.getByRole("button", { name: "출석 인증하기" }));

    expect(await screen.findByRole("heading", { name: "LIVE 출석을 남겼어요" })).toBeInTheDocument();
    expect(screen.getByText("Attendance Stamp, Fan Score +3, 응모권 2장이 기록되었습니다.")).toBeInTheDocument();
    expect(screen.getByText("총점").parentElement).toHaveTextContent("8");
    expect(screen.getByText("실버")).toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "Fan Passport 발급받기" }))
      .toHaveAttribute("href", "/c/kara/verify?locale=ko");
    expect(screen.queryByRole("textbox", { name: "Fan Code 입력" })).not.toBeInTheDocument();
  });

  it("uses the shared English Passport action copy for the attendance gate", async () => {
    const missingPassport = payload("verify_fan", false);
    missingPassport.live.effectiveStatus = "ended";
    missingPassport.viewer.passport = "missing";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(missingPassport), { status: 200 }),
    );

    render(<LiveEventScreen slug="kara-nualeaf" locale="en" />);

    expect(await screen.findByText("Create a Fan Passport before joining.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get Fan Passport" }))
      .toHaveAttribute("href", "/c/kara/verify?locale=en");
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

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/1:00 후 다시 시도/));
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


it("formats booking details in KST with the actual year across midnight", () => {
  expect(formatReservationDateTime("2026-12-31T15:30:00.000Z", "ko")).toContain("2027년 1월 1일");
  expect(formatReservationDateTime("2026-12-31T15:30:00.000Z", "ko")).toContain("00:30");
  expect(formatReservationDateTime("2026-12-31T15:30:00.000Z", "en")).toContain("2027");
});

it("shortens only same-KST-day deadlines and keeps other dates explicit", () => {
  expect(formatReservationDeadline("2026-09-18T11:20:00Z", "2026-09-18T11:30:00Z", "ko")).toBe("당일 20:20");
  expect(formatReservationDeadline("2026-09-18T11:20:00Z", "2026-09-18T11:30:00Z", "en")).toBe("Same day 8:20 PM");
  expect(formatReservationDeadline("2026-12-31T14:50:00Z", "2026-12-31T15:30:00Z", "ko")).toContain("2026년 12월 31일");
  expect(formatReservationDeadline("2026-12-31T23:50:00Z", "2027-01-01T00:30:00Z", "ko")).toBe("당일 08:50");
});
