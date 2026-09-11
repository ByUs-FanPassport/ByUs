import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminDirectoryManager } from "./admin-directory-manager";

const { sessionState, authState, searchParamsState } = vi.hoisted(() => ({
  sessionState: { current: { status: "authorized", admin: { email: "owner@byus.test", role: "admin" } } as { status: string; admin?: { email: string; role: string } } },
  authState: { current: { user: { id: "privy:owner" }, getAccessToken: vi.fn(async () => "token") } },
  searchParamsState: { current: new URLSearchParams() },
}));

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => authState.current }));
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParamsState.current }));
vi.mock("./use-admin-session", () => ({ useAdminSession: () => sessionState.current }));
vi.mock("./operations-shell", () => ({ AdminOperationsShell: ({ children, adminRole }: { children: React.ReactNode; adminRole?: string }) => <main data-admin-role={adminRole}>{children}</main> }));
vi.mock("./admin-access-state", () => ({ AdminAccessState: ({ status }: { status: string }) => <p>access:{status}</p> }));
vi.mock("../ui/overlay/accessible-overlay", () => ({ AlertDialog: ({ children }: { children: React.ReactNode }) => <section role="alertdialog">{children}</section> }));

const actorId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const addedId = "33333333-3333-4333-8333-333333333333";
const createdAt = "2026-09-10T01:00:00.000000+00:00";
const updatedAt = "2026-09-11T10:00:00.123456+00:00";
const owner = { id: actorId, email: "owner@byus.test", role: "admin" as const, active: true, createdAt, updatedAt };
const operator = { id: otherId, email: "ops@byus.test", role: "operator" as const, active: true, createdAt, updatedAt };

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn(async () => body) } as unknown as Response;
}

describe("AdminDirectoryManager", () => {
  beforeEach(() => {
    sessionState.current = { status: "authorized", admin: { email: "owner@byus.test", role: "admin" } };
    authState.current = { user: { id: "privy:owner" }, getAccessToken: vi.fn(async () => "token") };
    searchParamsState.current = new URLSearchParams();
    vi.stubGlobal("fetch", vi.fn(async () => response({ items: [owner, operator], actorId })));
  });

  it("loads the private directory and prevents self-management in the UI", async () => {
    render(<AdminDirectoryManager />);

    expect(await screen.findByText("ops@byus.test")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/admin/administrators", expect.objectContaining({
      cache: "no-store",
      headers: { authorization: "Bearer token" },
    }));
    const ownerRow = screen.getByText("owner@byus.test").closest("tr")!;
    expect(within(ownerRow).getByRole("combobox", { name: "역할: owner@byus.test" })).toBeDisabled();
    expect(within(ownerRow).getByRole("button", { name: "역할 저장" })).toBeDisabled();
    expect(within(ownerRow).getByRole("button", { name: "접근 해제" })).toBeDisabled();
  });

  it("loads successfully when React replays effects in StrictMode", async () => {
    render(<StrictMode><AdminDirectoryManager /></StrictMode>);
    expect(await screen.findByText("ops@byus.test")).toBeInTheDocument();
    expect(screen.queryByLabelText("관리자 명단을 불러오는 중입니다.")).not.toBeInTheDocument();
  });

  it("adds an administrator with viewer as the default role", async () => {
    const added = { id: addedId, email: "new@byus.test", role: "viewer" as const, active: true, createdAt, updatedAt };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? response({ item: added }, 201)
      : response({ items: [owner, operator], actorId }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminDirectoryManager />);
    await screen.findByText("ops@byus.test");

    fireEvent.change(screen.getByRole("textbox", { name: "이메일" }), { target: { value: "new@byus.test" } });
    fireEvent.click(screen.getByRole("button", { name: "관리자 추가" }));

    expect(await screen.findByText("관리자를 추가했습니다.")).toBeInTheDocument();
    expect(screen.getByText("new@byus.test")).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ email: "new@byus.test", role: "viewer" });
  });

  it("confirms a role change and preserves the exact updatedAt token", async () => {
    const changed = { ...operator, role: "viewer" as const, updatedAt: "2026-09-11T10:01:00.654321+00:00" };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "PATCH"
      ? response({ item: changed })
      : response({ items: [owner, operator], actorId }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminDirectoryManager />);
    const roleSelect = await screen.findByRole("combobox", { name: "역할: ops@byus.test" });
    fireEvent.change(roleSelect, { target: { value: "viewer" } });
    fireEvent.click(screen.getAllByRole("button", { name: "역할 저장" }).find((button) => !button.hasAttribute("disabled"))!);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("ops@byus.test의 역할을 viewer로 변경합니다.");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "변경" }));

    expect(await screen.findByText("역할을 변경했습니다.")).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(JSON.parse(String(patch[1]?.body))).toEqual({ id: otherId, role: "viewer", active: true, expectedUpdatedAt: updatedAt });
  });

  it("revokes access without presenting it as account deletion", async () => {
    const revoked = { ...operator, active: false, updatedAt: "2026-09-11T10:02:00.000001+00:00" };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "PATCH"
      ? response({ item: revoked })
      : response({ items: [owner, operator], actorId }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminDirectoryManager />);
    await screen.findByText("ops@byus.test");
    const otherRow = screen.getByText("ops@byus.test").closest("tr")!;
    fireEvent.click(within(otherRow).getByRole("button", { name: "접근 해제" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("회원 계정과 변경 이력은 유지됩니다.");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "변경" }));

    expect(await screen.findByText("관리자 접근 권한을 해제했습니다.")).toBeInTheDocument();
    expect(screen.getByText("접근 해제", { selector: "span" })).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(JSON.parse(String(patch[1]?.body))).toEqual({ id: otherId, role: "operator", active: false, expectedUpdatedAt: updatedAt });
  });

  it("reactivates a previously revoked administrator", async () => {
    const inactive = { ...operator, active: false };
    const reactivated = { ...operator, active: true, updatedAt: "2026-09-11T10:03:00.000002+00:00" };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "PATCH"
      ? response({ item: reactivated })
      : response({ items: [owner, inactive], actorId }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminDirectoryManager />);
    await screen.findByText("ops@byus.test");
    const otherRow = screen.getByText("ops@byus.test").closest("tr")!;
    fireEvent.click(within(otherRow).getByRole("button", { name: "재활성화" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("관리자를 재활성화할까요?");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "변경" }));

    expect(await screen.findByText("관리자를 재활성화했습니다.")).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(JSON.parse(String(patch[1]?.body))).toEqual({ id: otherId, role: "operator", active: true, expectedUpdatedAt: updatedAt });
  });

  it("shows duplicate and stale-write errors with a refresh action", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return response({ error: { code: "ADMIN_DIRECTORY_DUPLICATE_EMAIL" } }, 409);
      if (init?.method === "PATCH") return response({ error: { code: "ADMIN_DIRECTORY_CONFLICT" } }, 409);
      return response({ items: [owner, operator], actorId });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminDirectoryManager />);
    await screen.findByText("ops@byus.test");
    fireEvent.change(screen.getByRole("textbox", { name: "이메일" }), { target: { value: "ops@byus.test" } });
    fireEvent.click(screen.getByRole("button", { name: "관리자 추가" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("이미 등록된 이메일입니다.");

    fireEvent.change(screen.getByRole("combobox", { name: "역할: ops@byus.test" }), { target: { value: "viewer" } });
    fireEvent.click(screen.getAllByRole("button", { name: "역할 저장" }).find((button) => !button.hasAttribute("disabled"))!);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "변경" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("목록을 새로고침한 뒤 다시 시도해 주세요.");
    expect(screen.getByRole("button", { name: "목록 새로고침" })).toBeInTheDocument();
  });

  it("hides the directory immediately when the server rejects access", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ error: { code: "FORBIDDEN" } }, 403)));
    render(<AdminDirectoryManager />);
    expect(await screen.findByText("access:denied")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "관리자 관리" })).not.toBeInTheDocument();
  });

  it("does not request the directory for a non-admin role", () => {
    sessionState.current = { status: "authorized", admin: { email: "ops@byus.test", role: "operator" } };
    render(<AdminDirectoryManager />);
    expect(screen.getByText("access:denied")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("supports English labels and filters by email", async () => {
    searchParamsState.current = new URLSearchParams("lang=en");
    render(<AdminDirectoryManager />);
    await screen.findByText("ops@byus.test");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search by email" }), { target: { value: "owner" } });
    expect(screen.getByText("owner@byus.test")).toBeInTheDocument();
    expect(screen.queryByText("ops@byus.test")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
  });

  it("removes the prior directory while a switched account is being verified", async () => {
    const view = render(<AdminDirectoryManager />);
    await screen.findByText("ops@byus.test");
    sessionState.current = { status: "loading" };
    authState.current = { ...authState.current, user: { id: "privy:next" } };
    view.rerender(<AdminDirectoryManager />);
    expect(screen.getByText("access:loading")).toBeInTheDocument();
    expect(screen.queryByText("ops@byus.test")).not.toBeInTheDocument();
  });
});
