import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AdminPagination, useAdminPagination } from "./admin-pagination";

function List({ count, query = "" }: { count: number; query?: string }) {
  const pagination = useAdminPagination(Array.from({ length: count }, (_, i) => i), query);
  return <><p>{pagination.items.join(",")}</p><AdminPagination {...pagination} locale="ko" /></>;
}
it("clamps a deleted last page and does not jump back when the list grows", () => {
  const view = render(<List count={41} />);
  fireEvent.click(screen.getByRole("button", { name: "마지막 페이지" }));
  expect(screen.getByText("40")).toBeInTheDocument();
  view.rerender(<List count={40} />);
  expect(screen.getByRole("button", { name: "2페이지" })).toHaveAttribute("aria-current", "page");
  view.rerender(<List count={41} />);
  expect(screen.getByRole("button", { name: "2페이지" })).toHaveAttribute("aria-current", "page");
  view.rerender(<List count={41} query="new" />);
  expect(screen.getByRole("button", { name: "첫 페이지" })).toBeDisabled();
});
it("handles empty and exact-size result sets without phantom pages", () => {
  const view = render(<List count={0} />);
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  view.rerender(<List count={20} />);
  expect(screen.getByText("전체 20건 중 1–20건")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "다음 페이지" })).not.toBeInTheDocument();
});
