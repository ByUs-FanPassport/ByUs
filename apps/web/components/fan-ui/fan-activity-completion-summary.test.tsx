import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FanActivityCompletionSummary } from "./fan-activity-completion-summary";

describe("FanActivityCompletionSummary", () => {
  it("shows the earned Stamp, server-provided growth values, and next actions", () => {
    render(
      <FanActivityCompletionSummary
        locale="ko"
        stampType="attendance"
        title="LIVE 출석을 남겼어요"
        description="출석 기록이 Passport에 반영되었습니다."
        scoreDelta={3}
        updatedScore={5}
        updatedLevel="실버"
        leveledUp
        passportHref="/passports/passport-id?locale=ko"
        primaryAction={<a href="/live/live-id/survey?locale=ko">설문 참여하기</a>}
      />,
    );

    expect(screen.getByRole("img", { name: "라이브 출석 Stamp" })).toBeInTheDocument();
    const rewards = screen.getByText("Fan Score").closest("dl");
    expect(rewards).toHaveTextContent("Fan Score+3");
    expect(rewards).toHaveTextContent("총점5");
    expect(rewards).toHaveTextContent("레벨상승 · 실버");
    expect(screen.getAllByText("+3")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Passport에서 확인하기" })).toHaveAttribute(
      "href",
      "/passports/passport-id?locale=ko",
    );
  });

  it("uses the requested page heading level without changing embedded defaults", () => {
    const { rerender } = render(
      <FanActivityCompletionSummary
        locale="ko"
        stampType="survey"
        title="설문 참여 완료"
        description="Passport에 반영됐어요."
        scoreDelta={2}
        headingLevel={1}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "설문 참여 완료" }),
    ).toBeInTheDocument();

    rerender(
      <FanActivityCompletionSummary
        locale="ko"
        stampType="attendance"
        title="출석 완료"
        description="Passport에 반영됐어요."
        scoreDelta={3}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "출석 완료" }),
    ).toBeInTheDocument();

    rerender(
      <FanActivityCompletionSummary
        locale="en"
        stampType="knowledge"
        title="Verification complete"
        description="Added to your Passport."
        scoreDelta={1}
        headingLevel={3}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 3, name: "Verification complete" }),
    ).toBeInTheDocument();
  });
});
