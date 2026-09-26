import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ScheduleSuggestionForm } from "./schedule-suggestion-form";

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true, user: { id: "owner" }, getAccessToken: vi.fn(async () => "token"), login: vi.fn() }) }));
vi.mock("@/components/byus-session-provider", () => ({ useByUsSession: () => ({ ready: true, generation: 0 }) }));

it("links schedule validation to the first invalid field and preserves input", async () => {
  const { container } = render(<ScheduleSuggestionForm celebritySlug="kara" locale="ko" />);
  for (const [name, value] of Object.entries({ title: "공연", startsAt: "2026-10-02T12:00", endsAt: "2026-10-01T12:00", timeZone: "Asia/Seoul", sourceUrl: "http://example.test/source" })) {
    fireEvent.change(container.querySelector(`[name="${name}"]`)!, { target: { value } });
  }
  fireEvent.click(screen.getByRole("button", { name: "제출" }));
  const end = screen.getByLabelText(/종료/);
  await waitFor(() => expect(end).toHaveFocus());
  expect(end).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByText("종료는 시작보다 나중이어야 해요.")).toBeInTheDocument();
  expect(screen.getByLabelText(/공식 원문 URL/)).toHaveValue("http://example.test/source");
});
