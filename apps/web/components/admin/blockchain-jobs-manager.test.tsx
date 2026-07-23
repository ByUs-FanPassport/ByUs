import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlockchainJobsManager } from "./blockchain-jobs-manager";

const replace = vi.fn();
let query = "";
let role = "operator";
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/blockchain-jobs", useRouter: () => ({ replace }), useSearchParams: () => new URLSearchParams(query) }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ getAccessToken: vi.fn().mockResolvedValue("token") }) }));
vi.mock("./use-admin-session", () => ({ useAdminSession: () => ({ status: "authorized", admin: { email: "ops@byus.test", role } }) }));

const failedJob = { id: "11111111-1111-4111-8111-111111111111", entityType: "passport", entityId: "22222222-2222-4222-8222-222222222222", status: "FAILED", attempts: 2, maxAttempts: 5, nextAttemptAt: "2026-07-21T00:00:00Z", createdAt: "2026-07-20T00:00:00Z", updatedAt: "2026-07-21T00:00:00Z", completedAt: null, transactionReference: null, chainState: "not_submitted", errorCode: "RPC_UNAVAILABLE", errorSummary: "Provider request could not be completed.", manuallyRetryable: true, attemptHistory: [{ attemptNumber: 2, event: "failed", fromStatus: "PROCESSING", toStatus: "FAILED", errorCode: "RPC_UNAVAILABLE", createdAt: "2026-07-21T00:00:00Z", correlationId: null }] };

describe("ADM-011 blockchain jobs", () => {
  beforeEach(() => { query = ""; role = "operator"; replace.mockReset(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs: [failedJob] }) })); });
  it("renders a redacted job detail, safe transaction state, and retry confirmation", async () => {
    render(<BlockchainJobsManager />);
    await screen.findByText("FAILED");
    fireEvent.click(screen.getByRole("button", { name: /작업 상세/ }));
    expect(screen.getByText("Provider request could not be completed.")).toBeInTheDocument();
    expect(screen.getByText("아직 제출된 트랜잭션이 없습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "재시도 요청" }));
    expect(screen.getByRole("alertdialog", { name: "이 작업을 재시도할까요?" })).toBeInTheDocument();
  });
  it("keeps viewer retry visibly disabled", async () => {
    role = "viewer";
    render(<BlockchainJobsManager />);
    await screen.findByText("FAILED");
    fireEvent.click(screen.getByRole("button", { name: /작업 상세/ }));
    expect(screen.getByRole("button", { name: "재시도 요청" })).toBeDisabled();
    expect(screen.getByText("Viewer 역할은 조회만 가능합니다.")).toBeInTheDocument();
  });
  it("retains language while resetting filters", async () => {
    query = "lang=en&status=FAILED";
    render(<BlockchainJobsManager />);
    await screen.findByText("FAILED");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/blockchain-jobs?lang=en"));
  });
  it("keeps the visible filter controls synchronized with URL state after navigation", async () => {
    const rendered = render(<BlockchainJobsManager />);
    await screen.findByText("FAILED");
    expect(screen.getByRole("combobox", { name: "상태" })).toHaveValue("");
    query = "status=FAILED&jobId=11111111-1111-4111-8111-111111111111";
    rendered.rerender(<BlockchainJobsManager />);
    expect(screen.getByRole("combobox", { name: "상태" })).toHaveValue("FAILED");
    expect(screen.getByRole("textbox", { name: "작업 ID" })).toHaveValue(
      "11111111-1111-4111-8111-111111111111",
    );
  });
});
