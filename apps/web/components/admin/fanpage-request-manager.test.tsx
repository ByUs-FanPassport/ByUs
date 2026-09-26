import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AuthorizedFanpageRequestManager } from "./fanpage-request-manager";

const request = { id: "10000000-0000-4000-8000-000000000001", name: "KARA", officialSocialUrl: "https://instagram.com/kara", note: "", locale: "ko", status: "pending", revision: 1, reviewReason: null, reviewedAt: null, artist: null, createdAt: "2026-09-01T00:00:00Z" };
const mocks = vi.hoisted(() => ({ retry: vi.fn(), action: { busy: false, error: "", run: vi.fn() } }));
vi.mock("./participation-controls", () => ({
  ParticipationAdmin: ({ children }: { children: (role: string) => ReactNode }) => children("admin"),
  useAdminPage: () => ({ state: { status: "ready", data: [request], nextCursor: null, moreLoading: false, moreError: false }, retry: mocks.retry, loadMore: vi.fn() }),
  useParticipationCreators: () => ({ state: { status: "ready", data: [{ id: "20000000-0000-4000-8000-000000000002", slug: "kara", status: "published", nameKo: "카라", nameEn: "KARA" }] } }),
  CreatorSelect: ({ required }: { required?: boolean }) => <label>팬페이지<select name="celebrityId" required={required}><option value="">—</option><option value="20000000-0000-4000-8000-000000000002">카라</option></select></label>,
  AdminListState: () => null,
  styles: {},
}));
vi.mock("@/features/schedules/ui/participation-ui", () => ({ useParticipationAction: () => mocks.action, ActionFeedback: ({ error }: { error: string }) => error ? <p>{error}</p> : null, ParticipationState: () => null }));
beforeEach(() => { mocks.retry.mockReset(); mocks.action.error = ""; });

it("switches required review fields with the selected fanpage decision", () => {
  render(<AuthorizedFanpageRequestManager />);
  const creator = screen.getByRole("combobox", { name: "팬페이지" }), reason = screen.getByRole("textbox", { name: "사유" });
  expect(creator).toBeRequired(); expect(reason).not.toBeRequired();
  fireEvent.change(screen.getByRole("combobox", { name: "검토 결과" }), { target: { value: "reject" } });
  expect(creator).not.toBeRequired(); expect(reason).toBeRequired();
});
it("offers a latest-state reload after a revision conflict", () => {
  mocks.action.error = "FAN_WEB_REVISION_CONFLICT";
  render(<AuthorizedFanpageRequestManager />);
  fireEvent.click(screen.getByRole("button", { name: "최신 상태 다시 불러오기" }));
  expect(mocks.retry).toHaveBeenCalledOnce();
});
