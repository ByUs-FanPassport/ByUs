import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizedCertificationManager } from "./certification-manager";

const auth = vi.hoisted(() => ({ getAccessToken: vi.fn(async () => "token"), email: "operator@byus.test", role: "operator", userId: "actor-1", locale: "ko" }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ getAccessToken: auth.getAccessToken, user: { id: auth.userId } }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(`lang=${auth.locale}`) }));
vi.mock("./use-admin-session", () => ({ useAdminSession: () => ({ status: "authorized", admin: { role: auth.role, email: auth.email } }) }));
vi.mock("./operations-shell", () => ({ AdminOperationsShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
const mission = {
  id: "mission-1", celebrityId: "creator-1", celebritySlug: "star", immutableKey: "mission-key", revision: 1, status: "draft",
  category: "support", titleKo: "응원 인증", titleEn: "Support", descriptionKo: "설명", descriptionEn: "Description", instructionsKo: "안내", instructionsEn: "Instructions",
  opensAt: "2026-09-10T00:00:00.000Z", closesAt: "2026-10-11T00:00:00.000Z", reward: { scorePoints: 10, ticketAmount: 1 },
};
const submission = {
  id: "submission-1", missionId: "mission-1", missionTitle: "멤버십 인증", celebritySlug: "star", appUserId: "user-1", applicantName: "팬 하나", creatorNameKo: "크리에이터",
  status: "pending", attemptNumber: 1, note: "가입 화면입니다", revision: 1, submittedAt: "2026-09-10T00:30:00.000Z",
  reward: { scorePoints: 1, ticketAmount: 0, stampCount: 1 }, membershipPlatform: "youtube", uploads: [{ id: "proof-1", width: 400, height: 600 }],
};
const creator = { id: "creator-1", slug: "star", localizations: { ko: { name: "크리에이터" }, en: { name: "Creator" } } };
function setup(overrides: { get?: (url: string) => Promise<Response> | Response; post?: (url: string, body: Record<string, unknown>) => Promise<Response> | Response } = {}) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") return overrides.post ? overrides.post(url, JSON.parse(String(init.body))) : Response.json({ mission });
    if (url.includes("/proofs/")) return new Response("image", { headers: { "content-type": "image/webp" } });
    if (url === "/api/admin/celebrities") return Response.json({ items: [creator] });
    if (overrides.get) return overrides.get(url);
    return url.includes("certification-missions") ? Response.json({ missions: [mission] }) : Response.json({ submissions: [submission] });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
async function settings() {
  await screen.findByRole("button", { name: "승인" }).catch(() => undefined);
  fireEvent.click(screen.getByRole("tab", { name: "미션 설정" }));
  return screen.findByRole("button", { name: /응원 인증/ });
}
async function readyProof() {
  fireEvent.load(await screen.findByAltText("인증 이미지 1"));
  await waitFor(() => expect(screen.getByRole("button", { name: "승인" })).toBeEnabled());
}
function confirmApproval() {
  fireEvent.click(screen.getByRole("button", { name: "승인" }));
  fireEvent.click(screen.getByRole("button", { name: "승인 확정" }));
}
function postCalls(fetcher: ReturnType<typeof setup>) { return fetcher.mock.calls.filter(([, init]) => init?.method === "POST"); }

beforeEach(() => {
  auth.getAccessToken.mockReset(); auth.getAccessToken.mockResolvedValue("token"); auth.role = "operator"; auth.email = "operator@byus.test"; auth.userId = "actor-1"; auth.locale = "ko";
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:proof-1"), revokeObjectURL: vi.fn() }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

describe("certification review workspace integration", () => {
  it("opens reviews first with evidence/context and keeps mission editing in settings", async () => {
    setup(); render(<AuthorizedCertificationManager />);
    expect(await screen.findByAltText("인증 이미지 1")).toBeVisible();
    expect(screen.queryByLabelText("인증 유형")).not.toBeInTheDocument();
    expect(screen.getByText("다음 결제일 또는 유효기간")).toBeVisible();
    expect(screen.getByText("가입 화면입니다")).toBeVisible();
    expect(screen.getByRole("button", { name: "승인" })).toBeDisabled();
    fireEvent.click(await settings());
    expect(await screen.findByRole("option", { name: /크리에이터 · @star/ })).toBeInTheDocument();
    expect(screen.getByLabelText("제목 (한국어)")).toHaveValue("응원 인증");
    expect(screen.queryByText("Celebrity UUID")).not.toBeInTheDocument();
    expect(screen.queryByText("descriptionKo")).not.toBeInTheDocument();
  });

  it("guards mission commands before token resolution and retains latest revision after refresh failure", async () => {
    let revision = 1; let failGet = false;
    const fetcher = setup({ get: url => failGet ? new Response(null, { status: 500 }) : url.includes("certification-missions") ? Response.json({ missions: [{ ...mission, revision }] }) : Response.json({ submissions: [] }), post: () => { revision = 2; failGet = true; return Response.json({ mission: { ...mission, revision } }); } });
    render(<AuthorizedCertificationManager />);
    await screen.findByText("표시할 제출이 없습니다");
    fireEvent.click(screen.getByRole("tab", { name: "미션 설정" }));
    fireEvent.click(await screen.findByRole("button", { name: /응원 인증/ }));
    let resolve!: (token: string) => void;
    auth.getAccessToken.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const activate = screen.getByRole("button", { name: "활성화" });
    fireEvent.click(activate); fireEvent.click(activate);
    expect(activate).toBeDisabled(); expect(postCalls(fetcher)).toHaveLength(0);
    await act(async () => resolve("token"));
    expect(await screen.findByRole("alert")).toHaveTextContent("변경은 처리됐지만");
    expect(activate).toBeDisabled();
    failGet = false; fireEvent.click(screen.getByRole("button", { name: "최신 상태 불러오기" }));
    await waitFor(() => expect(activate).toBeEnabled());
    expect(postCalls(fetcher)).toHaveLength(1);
    fireEvent.click(activate);
    await waitFor(() => expect(postCalls(fetcher)).toHaveLength(2));
    expect(JSON.parse(String(postCalls(fetcher)[1][1]?.body))).toMatchObject({ expectedRevision: 2 });
  });

  it("locks uncertain reviews until refresh and reuses the idempotency key for the same decision", async () => {
    const fetcher = setup({ post: () => { throw new TypeError("response lost"); } });
    render(<AuthorizedCertificationManager />); await readyProof();
    let resolve!: (token: string) => void;
    auth.getAccessToken.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    confirmApproval();
    expect(screen.getByRole("button", { name: "승인" })).toBeDisabled();
    expect(postCalls(fetcher)).toHaveLength(0);
    await act(async () => resolve("token"));
    expect(await screen.findByRole("alert")).toHaveTextContent("심사 결과를 확인하지 못했습니다");
    expect(screen.getByRole("button", { name: "보완 요청" })).toBeDisabled();
    expect(postCalls(fetcher)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "최신 상태 불러오기" }));
    await readyProof(); confirmApproval();
    await waitFor(() => expect(postCalls(fetcher)).toHaveLength(2));
    const bodies = postCalls(fetcher).map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies[1].idem).toBe(bodies[0].idem);
  });

  it("queries approved history and exposes no decision controls", async () => {
    const fetcher = setup({ get: url => url.includes("certification-missions") ? Response.json({ missions: [mission] }) : Response.json({ submissions: [{ ...submission, status: url.endsWith("approved") ? "approved" : "pending", reviewedAt: "2026-09-10T01:00:00Z" }] }) });
    render(<AuthorizedCertificationManager />); await readyProof();
    fireEvent.click(screen.getByRole("button", { name: "승인 완료" }));
    await screen.findByText("심사 내역");
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("status=approved"))).toBe(true);
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "보완 요청" })).not.toBeInTheDocument();
    expect(postCalls(fetcher)).toHaveLength(0);
  });

  it("searches submissions without losing distinction between empty and error states", async () => {
    setup(); render(<AuthorizedCertificationManager />);
    await screen.findByAltText("인증 이미지 1");
    fireEvent.change(screen.getByRole("textbox", { name: "제출 검색" }), { target: { value: "not-found" } });
    expect(screen.getByText("검색 결과가 없습니다")).toBeVisible();
    expect(screen.queryByText("표시할 제출이 없습니다")).not.toBeInTheDocument();
  });

  it("keeps viewer history and images available while all mutations remain disabled", async () => {
    auth.role = "viewer"; setup(); render(<AuthorizedCertificationManager />);
    fireEvent.load(await screen.findByAltText("인증 이미지 1"));
    expect(screen.getByRole("button", { name: "승인" })).toBeDisabled();
    expect(screen.getByText("조회 권한으로 접속 중입니다.")).toBeVisible();
  });

  it("clears evidence immediately when the authorized account changes", async () => {
    setup(); const rendered = render(<AuthorizedCertificationManager />);
    await readyProof();
    auth.email = "another@byus.test"; auth.userId = "actor-2";
    auth.getAccessToken.mockImplementation(() => new Promise(() => {}));
    rendered.rerender(<AuthorizedCertificationManager />);
    expect(screen.queryByAltText("인증 이미지 1")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:proof-1");
  });

  it("does not send an old review after an account switch while its token is pending", async () => {
    const fetcher = setup(); const rendered = render(<AuthorizedCertificationManager />);
    await readyProof();
    let resolve!: (token: string) => void;
    auth.getAccessToken.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    confirmApproval();
    auth.email = "new@byus.test"; auth.userId = "actor-2";
    rendered.rerender(<AuthorizedCertificationManager />);
    await act(async () => resolve("new-account-token"));
    expect(postCalls(fetcher)).toHaveLength(0);
  });

  it("saves a membership preset with a creator selection and preserves its id after failed reconciliation", async () => {
    let saved: Record<string, unknown> | null = null;
    let failGet = false;
    const membershipMission = { ...mission, id: "new-membership", titleKo: "YouTube 유료 멤버십 인증", membershipPlatform: "youtube" };
    const fetcher = setup({ get: url => failGet ? new Response(null, { status: 500 }) : url.includes("certification-missions") ? Response.json({ missions: saved ? [membershipMission] : [] }) : Response.json({ submissions: [] }), post: (_url, body) => { saved = body; failGet = true; return Response.json({ id: membershipMission.id }); } });
    render(<AuthorizedCertificationManager />);
    await screen.findByText("표시할 제출이 없습니다");
    fireEvent.click(screen.getByRole("tab", { name: "미션 설정" }));
    await screen.findByRole("option", { name: /크리에이터 · @star/ });
    fireEvent.change(screen.getByLabelText("크리에이터"), { target: { value: "creator-1" } });
    fireEvent.change(screen.getByLabelText("인증 유형"), { target: { value: "youtube" } });
    expect(screen.getByLabelText("팬 점수")).toHaveValue(1);
    expect(screen.getByLabelText("응모권 수량")).toHaveValue(0);
    fireEvent.change(screen.getByLabelText("시작 일시"), { target: { value: "2026-09-10T00:00" } });
    fireEvent.change(screen.getByLabelText("종료 일시"), { target: { value: "2026-10-10T00:00" } });
    fireEvent.submit(screen.getByRole("button", { name: "초안 저장" }).closest("form")!);
    await screen.findByRole("alert");
    expect(saved).toMatchObject({ command: "save", membershipPlatform: "youtube", scorePoints: 1, ticketAmount: 0, celebrityId: "creator-1" });
    failGet = false;
    fireEvent.click(screen.getByRole("button", { name: "최신 상태 불러오기" }));
    const activate = await screen.findByRole("button", { name: "활성화" });
    await waitFor(() => expect(activate).toBeEnabled());
    fireEvent.click(activate);
    await waitFor(() => expect(postCalls(fetcher)).toHaveLength(2));
    expect(saved).toMatchObject({ command: "activate", id: "new-membership", expectedRevision: 1 });
  });
});
