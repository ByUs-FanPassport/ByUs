import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CelebrityFanPage } from "./celebrity-fan-page";
import { findPublishedCelebrity } from "./public-celebrity-fixtures";

describe("published celebrity fan page", () => {
  it("renders the published LIVE and intent-preserving Passport action", () => {
    const kara = findPublishedCelebrity("kara");
    expect(kara).toBeDefined();
    render(<CelebrityFanPage celebrity={kara!} />);
    expect(screen.getByRole("heading", { name: "KARA" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /LIVE 자세히 보기/ })).toHaveAttribute("href", "/live/kara-nualeaf");
    expect(screen.getByRole("link", { name: /Fan Passport 발급받기/ })).toHaveAttribute("href", expect.stringContaining("intent=passport"));
    expect(screen.getByAltText("모든 Stamp 칸이 비어 있는 펼쳐진 Fan Passport")).toBeInTheDocument();
  });

  it("renders an honest no-LIVE state instead of inventing an event", () => {
    const changha = findPublishedCelebrity("changha");
    expect(changha).toBeDefined();
    render(<CelebrityFanPage celebrity={changha!} />);
    expect(screen.getByRole("heading", { name: "예정된 LIVE가 아직 없어요." })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /LIVE 자세히 보기/ })).not.toBeInTheDocument();
  });

  it("does not resolve unpublished or unknown slugs", () => {
    expect(findPublishedCelebrity("unknown")).toBeUndefined();
    expect(findPublishedCelebrity("draft-kara")).toBeUndefined();
  });
});
