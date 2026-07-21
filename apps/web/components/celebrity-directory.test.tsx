import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CelebrityDirectory } from "./celebrity-directory";
import { publishedCelebrityFixtures } from "./public-celebrity-fixtures";

describe("published celebrity directory", () => {
  it("renders only the immutable published fixture repository", () => {
    render(<CelebrityDirectory celebrities={publishedCelebrityFixtures} />);
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "KARA 팬페이지 보기" })).toHaveAttribute("href", "/c/kara");
    expect(screen.getByText("다음 LIVE 준비 중")).toBeInTheDocument();
    expect(Object.isFrozen(publishedCelebrityFixtures)).toBe(true);
    expect(publishedCelebrityFixtures.every(Object.isFrozen)).toBe(true);
  });

  it("teaches the user what happens next when no published rows exist", () => {
    render(<CelebrityDirectory celebrities={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("지금 공개된 셀럽이 없어요.");
    expect(screen.getByRole("link", { name: "오늘의 LIVE로 돌아가기" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });
});
