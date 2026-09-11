import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PickupRosterExport, RaffleWinnerOperations } from "./raffle-operations-panel";

const getAccessToken = vi.hoisted(() => vi.fn(async () => "admin-token"));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ getAccessToken }) }));

const winnerId = "11111111-1111-4111-8111-111111111111";
const fetchMock = vi.fn<typeof fetch>();

function winner(overrides: Record<string, unknown> = {}) {
  return {
    winnerId,
    method: "on_site_pickup",
    status: "pickup_available",
    revision: 3,
    recipientDeadlineAt: "2099-09-18T00:00:00+09:00",
    claimDisposition: "active",
    recipient: { name: "김팬", phone: "010-****-5678" },
    ...overrides,
  };
}

function renderWinner(locale: "ko" | "en" = "ko") {
  const onSaved = vi.fn(async () => undefined);
  render(<RaffleWinnerOperations winnerId={winnerId} title="VIP 관람권" status="pickup_available" canWrite published onSaved={onSaved} locale={locale} />);
  return onSaved;
}

describe("RaffleWinnerOperations", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    getAccessToken.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("does not mutate pickup completion before both venue verification and confirmation", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(winner()));
    renderWinner();
    fireEvent.click(screen.getByRole("button", { name: "수령 정보 조회" }));
    const complete = await screen.findByRole("button", { name: "수령 완료" });
    fireEvent.change(screen.getByLabelText("처리 사유"), { target: { value: "현장 본인 확인을 완료했습니다" } });
    expect(complete).toBeDisabled();
    fireEvent.click(complete);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("checkbox", { name: /성명과 휴대폰 뒤 4자리/ }));
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(complete);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("posts the audit purpose and csv format when exporting a roster", async () => {
    fetchMock.mockResolvedValueOnce(new Response("경품,성명", { status: 200 }));
    const createObjectURL = vi.fn(() => "blob:roster"), revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<PickupRosterExport campaignId="campaign-a" canWrite locale="ko" />);
    fireEvent.change(screen.getByLabelText("이용 목적"), { target: { value: " 현장 수령자 본인 대조 목적 " } });
    fireEvent.click(screen.getByRole("button", { name: "명단 CSV 다운로드" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({ purpose: "현장 수령자 본인 대조 목적", format: "csv" });
    expect(createObjectURL).toHaveBeenCalled();
  });

  it("hides operational controls for an unclaimed winner", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(winner({ status: "information_required", claimDisposition: "unclaimed", recipient: null })));
    renderWinner();
    fireEvent.click(screen.getByRole("button", { name: "수령 정보 조회" }));
    expect(await screen.findByText("VIP 관람권 · 미수령 종결")).toBeInTheDocument();
    expect(screen.queryByLabelText("처리 사유")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "미수령으로 종결" })).not.toBeInTheDocument();
  });

  it("clears previously revealed personal information when a later read fails", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(winner({ recipient: { name: "김팬", phone: "010-1234-5678" } })))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    renderWinner();
    fireEvent.click(screen.getByRole("button", { name: "개인정보 보기 · 조회 기록" }));
    expect(await screen.findByText("010-1234-5678")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "수령 정보 조회" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("처리하지 못했습니다");
    expect(screen.queryByText("010-1234-5678")).not.toBeInTheDocument();
  });

  it("renders English labels and derives the real next fulfillment transition", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(winner({ method: "physical_shipping", status: "shipping_in_transit" })));
    renderWinner("en");
    fireEvent.click(screen.getByRole("button", { name: "View recipient details" }));
    expect(await screen.findByText("VIP 관람권 · In transit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delivered Set" })).toBeInTheDocument();
    expect(screen.queryByText(/shipping_delivered|shipping_failed|preparing/)).not.toBeInTheDocument();
  });
});
