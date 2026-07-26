import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FanAction } from "./fan-action";

describe("FanAction", () => {
  it("renders a locale-preserving link with the shared neutral contract", () => {
    render(<FanAction href="/live?locale=ko">LIVE 둘러보기</FanAction>);
    expect(screen.getByRole("link", { name: "LIVE 둘러보기" })).toHaveAttribute(
      "href",
      "/live?locale=ko",
    );
  });

  it("renders a disabled busy button without firing the action", () => {
    const onClick = vi.fn();
    render(
      <FanAction disabled ariaBusy onClick={onClick} variant="primary">
        처리 중
      </FanAction>,
    );
    const button = screen.getByRole("button", { name: "처리 중" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-fan-action-emphasis", "primary");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("centers icon slots and associates complex helper text", () => {
    render(
      <FanAction
        href="/c/katseye/verify"
        variant="primary"
        leadingIcon={<span>ticket</span>}
        trailingIcon={<span>arrow</span>}
        helperText="예약하려면 KATSEYE Fan Passport가 필요해요."
      >
        팬 인증하기
      </FanAction>,
    );

    const action = screen.getByRole("link", { name: "팬 인증하기" });
    const helper = screen.getByText("예약하려면 KATSEYE Fan Passport가 필요해요.");
    expect(action).toHaveAttribute("aria-describedby", helper.id);
    expect(action).toHaveAttribute("data-has-leading", "true");
    expect(action).toHaveAttribute("data-has-trailing", "true");
  });

  it("renders an external action with a safe new-window contract", () => {
    render(
      <FanAction href="https://youtube.com/watch?v=1" external variant="primary">
        LIVE 시청하기
      </FanAction>,
    );

    expect(screen.getByRole("link", { name: "LIVE 시청하기" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    expect(screen.getByRole("link", { name: "LIVE 시청하기" })).toHaveAttribute(
      "target",
      "_blank",
    );
  });

  it("renders the shared Passport context action as a link", () => {
    render(
      <FanAction href="/c/katseye/verify" variant="passport">
        <span>Fan Passport 발급받기</span>
        <span aria-hidden="true">→</span>
      </FanAction>,
    );

    expect(
      screen.getByRole("link", { name: "Fan Passport 발급받기" }),
    ).toHaveAttribute("href", "/c/katseye/verify");
  });
});
