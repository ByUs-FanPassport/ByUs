import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FanScoreProgress } from "./fan-score-progress";

const passport = { id: "passport-one", tier: "Bronze", score: 2, remainingToNextTier: 13 } as const;

describe("fan score details", () => {
  it("keeps the current score in an on-demand tooltip with the next tier threshold", () => {
    render(<FanScoreProgress passport={passport} locale="ko" />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    const progress = screen.getByRole("progressbar", { name: "팬 등급 진행도" });
    expect(progress).toHaveAttribute("value", "2");
    expect(progress).toHaveAttribute("max", "15");
    expect(progress).toHaveAttribute("aria-valuetext", "현재 점수 / 실버 기준: 2 / 15점");
    fireEvent.click(screen.getByRole("button", { name: "팬 점수 자세히 보기" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("현재 점수 / 실버 기준");
    expect(screen.getByRole("tooltip")).toHaveTextContent("2 / 15점");
  });

  it("toggles on tap and dismisses on outside press or Escape", () => {
    render(<FanScoreProgress passport={passport} locale="ko" />);
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows details on keyboard focus and dismisses when focus leaves", () => {
    render(<FanScoreProgress passport={passport} locale="en" />);
    const trigger = screen.getByRole("button", { name: "View Fan Score details" });
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Current score / Silver target");
    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not invent a maximum score after Diamond", () => {
    render(<FanScoreProgress passport={{ ...passport, tier: "Diamond", score: 250, remainingToNextTier: 0 }} locale="ko" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("최고 등급 달성250점");
    expect(screen.getByRole("tooltip")).not.toHaveTextContent("/");
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "1");
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "1");
  });

  it("uses the server stage segment while retaining the next major-tier goal in details", () => {
    render(<FanScoreProgress passport={{
      ...passport,
      tier: "Gold",
      score: 80,
      remainingToNextTier: 40,
      stageProgress: {
        policyVersion: 2,
        current: { key: "gold-2", tier: "Gold", subdivision: 2, rank: 5, minimumScore: 70 },
        next: { key: "gold-3", tier: "Gold", subdivision: 3, rank: 6, minimumScore: 95 },
        remaining: 15,
        progressPercent: 40,
      },
    }} locale="ko" />);
    const progress = screen.getByRole("progressbar", { name: "팬 등급 진행도" });
    expect(progress).toHaveAttribute("value", "40");
    expect(progress).toHaveAttribute("max", "100");
    expect(progress).toHaveAttribute("aria-valuetext", "골드 3까지: 15점 남음. 현재 점수: 80점. 플래티넘까지 40점");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("골드 3까지15점 남음");
    expect(screen.getByRole("tooltip")).toHaveTextContent("현재 점수80점");
    expect(screen.getByRole("tooltip")).toHaveTextContent("등급 목표플래티넘까지 40점");
  });

  it("omits a duplicate tier goal when the nearest stage is the next tier", () => {
    render(<FanScoreProgress passport={{
      ...passport,
      tier: "Platinum",
      score: 215,
      remainingToNextTier: 35,
      stageProgress: {
        policyVersion: 2,
        current: { key: "platinum-4", tier: "Platinum", subdivision: 4, rank: 10, minimumScore: 215 },
        next: { key: "diamond-1", tier: "Diamond", subdivision: 1, rank: 11, minimumScore: 250 },
        remaining: 35,
        progressPercent: 0,
      },
    }} locale="ko" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("다이아몬드까지35점 남음");
    expect(screen.getByRole("tooltip")).toHaveTextContent("현재 점수215점");
    expect(screen.queryByText("등급 목표")).not.toBeInTheDocument();
  });
});
