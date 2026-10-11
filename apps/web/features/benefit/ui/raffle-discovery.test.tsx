import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "@/i18n/locales";
import { raffleDiscoveryCopy } from "@/i18n/catalogs/features__benefit__ui__raffle-discovery";
import { ElinaGuideCard } from "@/components/home-entry-cards/home-entry-cards";
import { raffleSchema, type RaffleList } from "../domain/raffle";
import { RaffleResultsNotice } from "./raffle-results-notice";

const raffle: RaffleList["raffles"][number] = {
  id: "11111111-1111-4111-8111-111111111111", benefitId: "22222222-2222-4222-8222-222222222222",
  title: "한정판 스태츄", summary: "엘리나와 함께하는 선물", imageUrl: null, winnerQuantity: 1,
  status: "closed", entryOpensAt: null, entryClosesAt: "2026-10-08T00:00:00Z",
  fulfillmentMethod: "physical_shipping", perFanTicketLimit: null,
};

describe("raffle result discovery", () => {
  it.each(APP_LOCALES)("keeps the banner and notice result destinations localized in %s", locale => {
    const { container } = render(<>
      <ElinaGuideCard locale={locale} elina={undefined} hero raffles={[{ ...raffle, resultsPublishedAt: "2026-10-09T00:00:00Z" }]} />
      <RaffleResultsNotice locale={locale} />
    </>);
    expect(screen.getAllByRole("link", { name: raffleDiscoveryCopy[locale].action })).toHaveLength(2);
    for (const link of container.querySelectorAll("a")) expect(link).toHaveAttribute("href", `/my/raffles?locale=${locale}`);
    expect(container).toHaveTextContent(raffleDiscoveryCopy[locale].title);
  });

  it.each([undefined, null])("does not turn a closed raffle into an announced result (%s)", resultsPublishedAt => {
    render(<ElinaGuideCard locale="ko" elina={undefined} hero raffles={[{ ...raffle, resultsPublishedAt }]} />);
    expect(screen.getByRole("heading", { name: "응모가 끝났어요" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "응모 내역 확인" })).toHaveAttribute("href", "/my/raffles?locale=ko");
    expect(screen.queryByText("래플 결과가 발표됐어요")).not.toBeInTheDocument();
    expect(screen.queryByText("이벤트 응모하기")).not.toBeInTheDocument();
  });

  it("retains entry actions while a raffle is open", () => {
    render(<ElinaGuideCard locale="ko" elina={undefined} hero raffles={[{ ...raffle, status: "open" }]} />);
    expect(screen.getByRole("link", { name: "엘리나와 함께 뱅크시 전시 보러 가요" })).toHaveAttribute("href", "/c/elina/raffles?locale=ko");
    expect(screen.getByText("이벤트 응모하기")).toBeInTheDocument();
  });

  it("keeps cancellation out of result announcements", () => {
    render(<ElinaGuideCard locale="ko" elina={undefined} hero raffles={[{ ...raffle, status: "cancelled", resultsPublishedAt: "2026-10-09T00:00:00Z" }]} />);
    expect(screen.queryByText("래플 결과가 발표됐어요")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "래플이 취소됐어요" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "응모 내역 확인" })).toHaveAttribute("href", "/my/raffles?locale=ko");
    expect(screen.queryByText("이벤트 응모하기")).not.toBeInTheDocument();
  });

  it("accepts old catalogs but validates announcement timestamps without projecting private fields", () => {
    expect(raffleSchema.parse(raffle).resultsPublishedAt).toBeUndefined();
    expect(raffleSchema.parse({ ...raffle, resultsPublishedAt: null }).resultsPublishedAt).toBeNull();
    const result = raffleSchema.parse({ ...raffle, resultsPublishedAt: "2026-10-09T00:00:00Z", winnerId: raffle.id });
    expect(result.resultsPublishedAt).toBe("2026-10-09T00:00:00Z");
    expect(result).not.toHaveProperty("winnerId");
    expect(raffleSchema.safeParse({ ...raffle, resultsPublishedAt: "not-a-date" }).success).toBe(false);
  });
});
