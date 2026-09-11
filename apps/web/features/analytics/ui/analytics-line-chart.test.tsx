import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnalyticsLineChart } from "./analytics-line-chart";

describe("AnalyticsLineChart", () => {
  it("labels the metric, axis summary, points, and accessible table alternative", () => {
    render(<AnalyticsLineChart label="신규 가입" points={[{ label: "09-01", value: 2 }, { label: "09-02", value: 5 }]} />);
    expect(screen.getByRole("img", { name: /신규 가입, 최대 5/ })).toBeInTheDocument();
    expect(screen.getByText("수치로 보기")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "신규 가입" })).toBeInTheDocument();
  });

  it("keeps empty and zero data distinct", () => {
    const { rerender } = render(<AnalyticsLineChart label="출석" points={[]} />);
    expect(screen.getByText("기간 데이터가 없습니다")).toBeInTheDocument();
    rerender(<AnalyticsLineChart label="출석" points={[{ label: "09-01", value: 0 }]} />);
    expect(screen.getByText("출석: 0")).toBeInTheDocument();
    expect(screen.queryByText("기간 데이터가 없습니다")).not.toBeInTheDocument();
  });

  it("uses distinct integer ticks for low-count metrics", () => {
    const { container } = render(<AnalyticsLineChart label="신규 가입" points={[{ label: "09-01", value: 1 }]} />);
    const ticks = [...container.querySelectorAll("text")].slice(0, 5).map((node) => node.textContent);
    expect(ticks).toEqual(["4", "3", "2", "1", "0"]);
  });
});
