import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FanState } from "./fan-state";

describe("FanState", () => {
  it("announces loading without presenting a false heading", () => {
    render(<FanState kind="loading" title="Passport를 불러오는 중이에요." />);
    const state = screen.getByRole("status");
    expect(state).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("announces an actionable error assertively", () => {
    render(
      <FanState
        kind="error"
        title="혜택을 불러오지 못했어요."
        actions={<button type="button">다시 시도</button>}
      />,
    );
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});
