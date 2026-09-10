import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FanStageProgress } from "../domain/fan-stage";
import { FanStageTooltip } from "./fan-stage-tooltip";

const withinTierStage = {
  policyVersion: 2,
  current: { key: "gold-1", tier: "Gold", subdivision: 1, rank: 4, minimumScore: 50 },
  next: { key: "gold-2", tier: "Gold", subdivision: 2, rank: 5, minimumScore: 70 },
  remaining: 8,
  progressPercent: 60,
} satisfies FanStageProgress;

const nextTierStage = {
  policyVersion: 2,
  current: { key: "silver-2", tier: "Silver", subdivision: 2, rank: 3, minimumScore: 30 },
  next: { key: "gold-1", tier: "Gold", subdivision: 1, rank: 4, minimumScore: 50 },
  remaining: 12,
  progressPercent: 40,
} satisfies FanStageProgress;

const maxStage = {
  policyVersion: 2,
  current: { key: "diamond-1", tier: "Diamond", subdivision: 1, rank: 11, minimumScore: 250 },
  next: null,
  remaining: 0,
  progressPercent: 100,
} satisfies FanStageProgress;

describe("FanStageTooltip", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens and pins on click, then closes when clicked again", () => {
    render(<FanStageTooltip celebrityName="KARA" tier="Gold" points={62} stageProgress={withinTierStage} remainingToNextTier={58} locale="ko" />);
    const trigger = screen.getByRole("button", { name: /KARA · 골드 1/ });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("골드 2까지 8점");
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps a hover-open tooltip readable while the pointer moves into its portal", () => {
    vi.useFakeTimers();
    render(<FanStageTooltip celebrityName="KARA" tier="Gold" points={62} stageProgress={withinTierStage} locale="en" />);
    const trigger = screen.getByRole("button", { name: /KARA · Gold 1/ });

    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.parentElement).toBe(document.body);
    fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
    fireEvent.pointerEnter(tooltip, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(100); });
    expect(tooltip).toBeInTheDocument();

    fireEvent.pointerLeave(tooltip, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens on keyboard focus and closes with Escape or blur", () => {
    render(<><FanStageTooltip celebrityName="KARA" tier="Silver" points={38} stageProgress={nextTierStage} locale="ko" /><button type="button">다음</button></>);
    const trigger = screen.getByRole("button", { name: /KARA · 실버 2/ });

    act(() => { trigger.focus(); });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    act(() => { trigger.focus(); });
    fireEvent.blur(trigger, { relatedTarget: screen.getByRole("button", { name: "다음" }) });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("dismisses a pinned tooltip on an outside pointer press", () => {
    render(<FanStageTooltip celebrityName="KARA" tier="Silver" points={38} stageProgress={nextTierStage} locale="ko" />);
    const trigger = screen.getByRole("button", { name: /KARA · 실버 2/ });

    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("dismisses when a responsive resize hides its trigger", () => {
    render(<FanStageTooltip celebrityName="KARA" tier="Silver" points={38} stageProgress={nextTierStage} locale="ko" />);
    const trigger = screen.getByRole("button", { name: /KARA · 실버 2/ });
    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    const rects = vi.spyOn(trigger, "getClientRects").mockReturnValue([] as unknown as DOMRectList);
    fireEvent.resize(window);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    rects.mockRestore();
  });

  it("shows a reached state at the maximum stage without inventing a next goal", () => {
    render(<FanStageTooltip celebrityName="KARA" tier="Diamond" points={300} stageProgress={maxStage} remainingToNextTier={0} locale="ko" />);
    fireEvent.click(screen.getByRole("button", { name: /최고 단계 도달/ }));
    const tooltip = screen.getByRole("tooltip");

    expect(tooltip).toHaveTextContent("최고 단계에 도달했어요");
    expect(tooltip).not.toHaveTextContent("다음 단계");
    expect(tooltip).not.toHaveTextContent("등급 목표");
  });

  it("uses only the authoritative tier and points when stage data is absent", () => {
    const { container } = render(<FanStageTooltip celebrityName="KARA" tier="Silver" points={15} remainingToNextTier={35} locale="ko" />);
    fireEvent.click(screen.getByRole("button", { name: "KARA · 실버. 현재 15점" }));
    const tooltip = screen.getByRole("tooltip");

    expect(tooltip).toHaveTextContent("KARA·실버");
    expect(tooltip).toHaveTextContent("현재 점수15점");
    expect(tooltip).not.toHaveTextContent("다음 단계");
    expect(tooltip).not.toHaveTextContent("등급 목표");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("does not repeat a major-tier goal when the next stage is that tier", () => {
    render(<FanStageTooltip celebrityName="KARA" tier="Silver" points={38} stageProgress={nextTierStage} remainingToNextTier={12} locale="ko" variant="inline" />);
    fireEvent.click(screen.getByRole("button", { name: /골드 1까지 12점/ }));
    const tooltip = screen.getByRole("tooltip");

    expect(tooltip).toHaveTextContent("골드 1까지 12점");
    expect(tooltip).not.toHaveTextContent("등급 목표");
    expect(screen.getAllByText("골드 1까지 12점")).toHaveLength(1);
  });
});
