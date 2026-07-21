import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAnalytics, AdminOverview } from "./operations-dashboard";

const getAccessToken = vi.fn(async () => "admin-token");
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ getAccessToken }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/dashboard",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("./use-admin-session", () => ({
  useAdminSession: () => ({
    status: "authorized",
    admin: { email: "ops@byus.test", role: "operator" },
  }),
}));

const metric = (value: number, source: string) => ({
  state: "available",
  value,
  reason: null,
  source,
});
const unavailable = (reason: string) => ({
  state: "unavailable",
  value: null,
  reason,
  source: null,
});

describe("Admin operations surfaces", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getAccessToken.mockClear();
  });

  it("shows only warnings proven by operations API data", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobs: [{ status: "FAILED" }, { status: "COMPLETED" }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ id: "1" }] }), { status: 200 }),
      );
    render(<AdminOverview />);
    expect(
      await screen.findByText("실패 또는 재시도 중인 작업이 있습니다."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("최근 감사 기록을 조회할 수 있습니다."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/전환율/)).not.toBeInTheDocument();
  });

  it("preserves scope inputs when switching locale and creator/brand tabs", () => {
    const { rerender } = render(<AdminAnalytics />);
    const scope = screen.getByLabelText("셀럽 ID");
    fireEvent.change(scope, {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    rerender(<AdminAnalytics locale="en" />);
    expect(screen.getByLabelText("Celebrity ID")).toHaveValue(
      "11111111-1111-4111-8111-111111111111",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Brand" }));
    expect(screen.getByLabelText("Brand ID")).toHaveValue(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("renders measured zero separately from unavailable and shows canonical source and denominator", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          window: {
            from: "2026-06-01T00:00:00.000Z",
            to: "2026-07-01T00:00:00.000Z",
            semantics: "[from,to)",
            asOf: "2026-07-21T08:00:00.000Z",
          },
          funnel: {
            reservationUsers: metric(0, "live_reservations"),
            reservationCount: metric(0, "live_reservations"),
            attendanceCount: metric(0, "live_attendances"),
            attendanceRate: {
              state: "not_applicable",
              value: null,
              reason: "NO_RESERVATIONS_IN_WINDOW",
              source: "live_attendances/live_reservations",
            },
            surveyResponseCount: metric(0, "live_survey_responses(submitted)"),
            surveyCompletionRate: {
              state: "not_applicable",
              value: null,
              reason: "NO_ATTENDANCES_IN_WINDOW",
              source: "live_survey_responses/live_attendances",
            },
            surveyAggregates: {
              state: "suppressed",
              value: null,
              reason: "SMALL_COHORT_LT_5",
              source: "live_survey_answers(common questions only)",
            },
            manualCommerce: unavailable(
              "MANUAL_COMMERCE_SOURCE_NOT_IMPLEMENTED",
            ),
          },
        }),
        { status: 200 },
      ),
    );
    render(<AdminAnalytics initialView="brand" />);
    fireEvent.change(screen.getByLabelText("브랜드 ID"), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    fireEvent.click(screen.getByRole("button", { name: "분석 조회" }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "브랜드 참여 퍼널" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("heading", { name: "예약 참여" }).parentElement
        ?.parentElement,
    ).toHaveTextContent("0");
    expect(
      screen.getByRole("heading", { name: "출석 참여" }).parentElement
        ?.parentElement,
    ).toHaveTextContent("0");
    expect(screen.getByText("출처: live_reservations")).toBeInTheDocument();
    expect(screen.getByText(/표본 보호/)).toBeInTheDocument();
    expect(document.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-07-21T08:00:00.000Z",
    );
  });

  it("does not call analytics until the UUID and interval are valid", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<AdminAnalytics />);
    fireEvent.click(screen.getByRole("button", { name: "분석 조회" }));
    expect(screen.getByRole("alert")).toHaveTextContent("올바른 UUID");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("invalidates an in-flight creator response when the view changes", async () => {
    let resolveFetch!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    render(<AdminAnalytics />);
    fireEvent.change(screen.getByLabelText("셀럽 ID"), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    fireEvent.click(screen.getByRole("button", { name: "분석 조회" }));
    fireEvent.click(screen.getByRole("tab", { name: "브랜드" }));
    resolveFetch(
      new Response(
        JSON.stringify({
          window: {
            from: "2026-06-01T00:00:00.000Z",
            to: "2026-07-01T00:00:00.000Z",
            semantics: "[from,to)",
            asOf: "2026-07-21T08:00:00.000Z",
          },
          metrics: {},
        }),
        { status: 200 },
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByText("조회 조건을 입력하면 집계 결과가 표시됩니다."),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("heading", { name: "브랜드 참여 퍼널" }),
    ).not.toBeInTheDocument();
  });

  it("associates validation feedback with every invalid scope field", () => {
    render(<AdminAnalytics />);
    fireEvent.change(screen.getByLabelText("라이브 ID (선택)"), {
      target: { value: "not-a-uuid" },
    });
    fireEvent.change(screen.getByLabelText("종료"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "분석 조회" }));
    expect(screen.getByLabelText("셀럽 ID")).toHaveAttribute(
      "aria-describedby",
      "analytics-scope-error",
    );
    expect(screen.getByLabelText("라이브 ID (선택)")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("시작")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("종료")).toHaveAttribute(
      "aria-describedby",
      "analytics-scope-error",
    );
  });

  it("implements roving tab focus and arrow-key switching", () => {
    render(<AdminAnalytics />);
    const creator = screen.getByRole("tab", { name: "크리에이터" });
    const brand = screen.getByRole("tab", { name: "브랜드" });
    expect(creator).toHaveAttribute("tabindex", "0");
    expect(brand).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(creator, { key: "ArrowRight" });
    expect(brand).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "analytics-tab-brand",
    );
  });
});
