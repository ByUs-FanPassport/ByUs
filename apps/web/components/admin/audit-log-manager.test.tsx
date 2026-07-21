import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditLogManager } from "./audit-log-manager";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/audit", useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ getAccessToken: vi.fn().mockResolvedValue("token") }) }));
vi.mock("./use-admin-session", () => ({ useAdminSession: () => ({ status: "authorized", admin: { email: "ops@byus.test", role: "viewer" } }) }));

const item = { id: "91", actor: { type: "admin", id: "11111111-1111-4111-8111-111111111111", role: "operator" }, action: "live.override.created", entity: { type: "live_event", id: "kara-live" }, result: "success", summary: { before: { status: "scheduled" }, after: { status: "live" }, token: "[REDACTED]" }, correlationId: "22222222-2222-4222-8222-222222222222", createdAt: "2026-07-21T00:00:00Z" };

describe("ADM-012 audit log", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [item], nextCursor: "next" }) })));
  it("states immutability and renders redacted before/after detail", async () => {
    render(<AuditLogManager />);
    expect(await screen.findByText("감사 로그는 추가만 가능하며 수정하거나 삭제할 수 없습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /로그 상세/ }));
    expect(screen.getByRole("heading", { name: "변경 전" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "변경 후" })).toBeInTheDocument();
    expect(screen.getByText(/\[REDACTED\]/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /삭제|수정/ })).not.toBeInTheDocument();
  });
});

