import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AdminLiveSubmissions } from "./live-submission-manager";

vi.mock("./use-admin-session", () => ({ useAdminSession: () => ({ status: "authorized", admin: { email: "admin@example.test", role: "admin" } }) }));
vi.mock("@/features/fanpage/ui/use-fanpage-resource", () => ({ useFanpageResource: (url: string) => url.endsWith("/replay")
  ? { state: { status: "ready", data: { liveEventId: "10000000-0000-4000-8000-000000000001", replayProvider: null, replayUrl: null, replayPublished: false, replayRevision: 1 } }, retry: vi.fn() }
  : { state: { status: "ready", data: { settings: { accepting: false, closesAt: null, visibility: "public", revision: 1 }, items: [], nextCursor: null } }, retry: vi.fn() } }));
vi.mock("@/features/schedules/ui/participation-ui", () => ({ useParticipationAction: () => ({ busy: false, error: "", setError: vi.fn(), run: vi.fn() }), ActionFeedback: () => null, ParticipationState: () => null }));

it("requires and explains the deadline only while LIVE submissions are accepting", async () => {
  render(<AdminLiveSubmissions liveEventId="10000000-0000-4000-8000-000000000001" locale="ko" />);
  const deadline = screen.getByLabelText(/접수 마감/);
  expect(deadline).not.toBeRequired();
  fireEvent.click(screen.getByRole("checkbox", { name: "접수 중" }));
  expect(deadline).toBeRequired();
  fireEvent.click(screen.getAllByRole("button", { name: "저장" })[0]);
  await waitFor(() => expect(deadline).toHaveAttribute("aria-invalid", "true"));
  expect(screen.getByText("접수를 켜려면 마감 시간을 입력해 주세요.")).toBeInTheDocument();
});
