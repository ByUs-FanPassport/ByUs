import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CelebrityManager } from "./celebrity-manager";

vi.mock("./use-admin-session", () => ({ useAdminSession: () => ({ status: "unauthenticated" }) }));

describe("CelebrityManager", () => {
  it("shows the server-provided deployment environment", () => {
    render(<CelebrityManager access="integration-pending" environment="Production" />);

    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(screen.queryByText("Development")).not.toBeInTheDocument();
  });

  it("keeps all content actions disabled until the authenticated CMS API exists", () => {
    render(<CelebrityManager access="integration-pending" />);

    expect(screen.getByRole("status")).toHaveTextContent("관리자 서버 연결 전");
    expect(screen.getByRole("button", { name: "새 셀럽 등록" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "초안 저장" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "발행하기" })).toBeDisabled();
  });

  it("uses semantic fields and explains the KO/EN publication requirement", () => {
    render(<CelebrityManager access="integration-pending" />);

    const form = screen.getByRole("form", { name: "셀럽 콘텐츠 편집" });
    expect(within(form).getByLabelText("셀럽 이름 (한국어)")).toBeRequired();
    expect(within(form).getByLabelText("Celebrity name (English)")).toBeRequired();
    expect(within(form).getByLabelText("프로필 이미지")).toBeDisabled();
    expect(screen.getByText("한국어와 영어 콘텐츠, 프로필 이미지가 모두 있어야 발행할 수 있습니다.")).toBeInTheDocument();
  });

  it("does not render celebrity records when access has not been authorized", () => {
    render(<CelebrityManager access="unauthenticated" />);

    expect(screen.getByRole("heading", { name: "관리자 로그인이 필요합니다" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "셀럽 콘텐츠 편집" })).not.toBeInTheDocument();
  });
});
