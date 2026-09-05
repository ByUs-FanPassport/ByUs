import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FanHeading, FanSectionHeader } from "./fan-heading";

describe("shared fan headings", () => {
  it("keeps semantic level and ID independent of visual role", () => {
    render(<FanHeading as="h1" id="my-title" variant="personal-page">MY</FanHeading>);
    expect(screen.getByRole("heading", { level: 1, name: "MY" })).toHaveAttribute("id", "my-title");
    expect(screen.getByRole("heading")).toHaveAttribute("data-fan-heading", "personal-page");
  });
  it.each(["standard", "editorial", "personal"] as const)("renders the %s title, description and accessible action", (variant) => {
    render(<FanSectionHeader variant={variant} id="upcoming" title="다가오는 LIVE" description="미리 예약하세요" accessory={<a href="/live">전체 보기</a>} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute("id", "upcoming");
    expect(screen.getByText("미리 예약하세요")).toBeVisible();
    expect(screen.getByRole("link", { name: "전체 보기" })).toHaveAttribute("href", "/live");
  });
  it("does not create empty description or action placeholders", () => {
    const { container } = render(<FanSectionHeader title="혜택" />);
    expect(container.querySelector("p")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
