import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GuestHome } from "./guest-home";

describe("canonical 03 guest home", () => {
  it("keeps the approved service actions and exact Passport label in both responsive placements", () => {
    render(<GuestHome />);

    expect(screen.getAllByRole("link", { name: "Google로 계속하기" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Fan Passport 발급받기/ })).toHaveLength(2);
    expect(screen.queryByText("로그인하고 내 Passport 확인하기")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /라이브 예약하기/ })).toHaveAttribute("href", expect.stringContaining("intent=reserve"));
  });

  it("renders social services as icon-only controls beside each artist name", () => {
    render(<GuestHome />);

    const karaCard = screen.getByRole("heading", { name: "KARA", level: 3 }).closest("article");
    expect(karaCard).not.toBeNull();
    const card = within(karaCard!);
    expect(card.getByRole("link", { name: "KARA YouTube 계정 연결" })).toHaveAttribute("data-social-icon-only", "true");
    expect(card.getByRole("link", { name: "KARA TikTok 계정 연결" })).toHaveAttribute("data-social-icon-only", "true");
    expect(card.getByRole("link", { name: "KARA Instagram 계정 연결" })).toHaveAttribute("data-social-icon-only", "true");
    expect(card.queryByText("YouTube")).not.toBeInTheDocument();
    expect(card.queryByText("TikTok")).not.toBeInTheDocument();
    expect(card.queryByText("Instagram")).not.toBeInTheDocument();
  });

  it("lets desktop users collapse and restore the context panel without removing mobile actions", () => {
    render(<GuestHome />);

    const toggle = screen.getByRole("button", { name: "로그인 및 Passport 영역 접기" });
    fireEvent.click(toggle);
    expect(screen.queryByRole("complementary", { name: "로그인 전 팬 활동" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그인 및 Passport 영역 펼치기" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("region", { name: "로그인 및 Fan Passport 시작" })).toBeInTheDocument();
  });
});
