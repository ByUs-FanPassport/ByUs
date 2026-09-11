import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  ready: true,
  authenticated: true,
  user: { id: "did:privy:fan-one" },
  login: vi.fn(),
  getAccessToken: vi.fn(async () => "token"),
}));

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => auth }));

import { CertificationDetailScreen } from "./certification-detail-screen";

const missionId = "22222222-2222-4222-8222-222222222222";
const rejectedId = "33333333-3333-4333-8333-333333333333";
const pendingId = "44444444-4444-4444-8444-444444444444";
const uploadId = "55555555-5555-4555-8555-555555555555";
const approvedId = "77777777-7777-4777-8777-777777777777";
const karaPassportId = "88888888-8888-4888-8888-888888888888";

const history = [
  {
    id: pendingId,
    kind: "manual",
    missionId,
    title: "콘서트 인증",
    status: "pending",
    attemptNumber: 2,
    rejectionReason: null,
    submittedAt: "2026-09-08T02:00:00.000Z",
    reviewedAt: null,
    actionHref: `/c/kara/certifications/${missionId}?locale=ko`,
  },
  {
    id: rejectedId,
    kind: "manual",
    missionId,
    title: "콘서트 인증",
    status: "rejected",
    attemptNumber: 1,
    rejectionReason: "날짜가 보이게 다시 촬영해 주세요.",
    submittedAt: "2026-09-08T00:00:00.000Z",
    reviewedAt: "2026-09-08T01:00:00.000Z",
    actionHref: `/c/kara/certifications/${missionId}?locale=ko`,
  },
] as const;

function detail(id: string, status: "pending" | "approved" | "rejected", attemptNumber: number) {
  return {
    id,
    missionId,
    title: "콘서트 인증",
    status,
    attemptNumber,
    note: attemptNumber === 1 ? "첫 제출 설명" : "두 번째 제출 설명",
    rejectionReason: status === "rejected" ? "날짜가 보이게 다시 촬영해 주세요." : null,
    revision: attemptNumber,
    submittedAt: `2026-09-08T0${attemptNumber - 1}:00:00.000Z`,
    reviewedAt: status === "pending" ? null : "2026-09-08T01:00:00.000Z",
    reward: { scorePoints: 2, ticketAmount: 1 },
    uploads: [{ id: uploadId, contentType: "image/webp", width: 800, height: 600 }],
  };
}

const approvedHistory = [{
  id: approvedId,
  kind: "manual",
  missionId,
  title: "콘서트 인증",
  status: "approved",
  attemptNumber: 1,
  rejectionReason: null,
  submittedAt: "2026-09-08T00:00:00.000Z",
  reviewedAt: "2026-09-08T01:00:00.000Z",
  actionHref: `/c/kara/certifications/${missionId}?locale=ko`,
}] as const;

function passport(id: string, slug: string) {
  return {
    id,
    owner: { nickname: null },
    celebrity: { slug, name: slug.toUpperCase(), image: { url: `/${slug}.jpg`, alt: slug.toUpperCase(), position: "center" } },
    businessStatus: "issued",
    mint: { status: "queued", txHash: null, tokenId: null },
    issuedAt: "2026-09-08T01:00:00.000Z",
    score: { points: 2, level: "Bronze" },
    stampSummary: { knowledge: 1, reservation: 0, attendance: 0, survey: 0, total: 1 },
    display: { level: "브론즈", mintStatus: "발급 대기" },
  };
}

function approvedFetch(passports: unknown[] | Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith(`/api/certifications/${missionId}?`)) return new Response(null, { status: 404 });
    if (url.startsWith("/api/passports?")) return passports instanceof Response ? passports : Response.json({ passports });
    if (url.includes("/api/me/")) return Response.json({ certifications: approvedHistory });
    if (url.includes(`/proofs/${uploadId}`)) return new Response(new Blob(["proof"], { type: "image/webp" }));
    if (url.includes(`/api/certification-submissions/${approvedId}`)) return Response.json({ submission: detail(approvedId, "approved", 1) });
    throw new Error(`Unexpected request: ${url}`);
  });
}

describe("CertificationDetailScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    auth.ready = true;
    auth.authenticated = true;
    auth.user = { id: "did:privy:fan-one" };
    auth.getAccessToken.mockResolvedValue("token");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:proof");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  it("loads the selected historical submission and its protected proof even when the public mission is gone", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith(`/api/certifications/${missionId}?`)) return new Response(null, { status: 404 });
      if (url.includes("/api/me/")) return Response.json({ certifications: history });
      if (url.includes(`/proofs/${uploadId}`)) return new Response(new Blob(["proof"], { type: "image/webp" }));
      if (url.includes(`/api/certification-submissions/${rejectedId}`)) return Response.json({ submission: detail(rejectedId, "rejected", 1) });
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<CertificationDetailScreen id={missionId} slug="kara" locale="ko" selectedSubmissionId={rejectedId} />);

    expect(await screen.findByText("첫 제출 설명")).toBeInTheDocument();
    expect(screen.getByText("날짜가 보이게 다시 촬영해 주세요.")).toBeInTheDocument();
    expect(screen.getByAltText("제출 이미지 1")).toHaveAttribute("src", "blob:proof");
    expect(screen.getByText("이후 제출 내역이 있어요")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "자료를 보완해 다시 제출해 주세요" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/certification-submissions/${rejectedId}/proofs/${uploadId}`,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("/api/passports?"))).toBe(false);
  });

  it("remounts for a new owner and ignores the previous owner's late response", async () => {
    let releaseFirst!: (value: Response) => void;
    const firstHistory = new Promise<Response>((resolve) => { releaseFirst = resolve; });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith(`/api/certifications/${missionId}?`)) return new Response(null, { status: 404 });
      if (url.includes("/api/me/") && auth.user.id === "did:privy:fan-one") return firstHistory;
      if (url.includes("/api/me/")) return Response.json({ certifications: history });
      if (url.includes(`/proofs/${uploadId}`)) return new Response(new Blob(["proof"], { type: "image/webp" }));
      if (url.includes(`/api/certification-submissions/${pendingId}`)) return Response.json({ submission: detail(pendingId, "pending", 2) });
      throw new Error(`Unexpected request: ${url}`);
    });

    const view = render(<CertificationDetailScreen id={missionId} slug="kara" locale="ko" />);
    auth.user = { id: "did:privy:fan-two" };
    view.rerender(<CertificationDetailScreen id={missionId} slug="kara" locale="ko" />);

    expect(await screen.findByText("두 번째 제출 설명")).toBeInTheDocument();
    releaseFirst(Response.json({ certifications: [history[1]] }));
    await waitFor(() => expect(screen.queryByText("첫 제출 설명")).not.toBeInTheDocument());
  });

  it("starts only one submission while the first click is in flight", async () => {
    let releaseUpload!: (value: Response) => void;
    const uploadResponse = new Promise<Response>((resolve) => { releaseUpload = resolve; });
    const uploadCalls: string[] = [];
    vi.spyOn(crypto, "randomUUID").mockReturnValue("66666666-6666-4666-8666-666666666666");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith(`/api/certifications/${missionId}?`)) {
        return Response.json({ certification: {
          id: missionId,
          kind: "manual",
          celebrity: { slug: "kara", name: "KARA" },
          category: "공연",
          title: "콘서트 인증",
          description: "현장 사진을 제출하세요.",
          instructions: "티켓과 현장을 함께 찍어 주세요.",
          status: "available",
          opensAt: "2026-09-08T00:00:00+09:00",
          closesAt: "2026-09-09T00:00:00+09:00",
          reward: { scorePoints: 2, ticketAmount: 1 },
        } });
      }
      if (url.includes("/api/me/")) return Response.json({ certifications: [] });
      if (url.endsWith(`/api/certifications/${missionId}/uploads`)) {
        uploadCalls.push(String(init?.method));
        return uploadResponse;
      }
      if (url === "/api/certification-submissions" && init?.method === "POST") {
        return Response.json({ submission: { id: pendingId, status: "pending", revision: 1 } }, { status: 201 });
      }
      if (url.includes(`/api/certification-submissions/${pendingId}`) && !url.includes("/proofs/")) {
        return Response.json({ submission: detail(pendingId, "pending", 2) });
      }
      if (url.includes(`/proofs/${uploadId}`)) return new Response(new Blob(["proof"], { type: "image/webp" }));
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<CertificationDetailScreen id={missionId} slug="kara" locale="ko" />);
    const picker = await screen.findByLabelText("이미지 선택 (최대 3장, 장당 3MB)");
    fireEvent.change(picker, { target: { files: [new File(["proof"], "proof.webp", { type: "image/webp" })] } });
    const submit = screen.getByRole("button", { name: "인증 자료 제출하기" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(uploadCalls).toHaveLength(1));
    releaseUpload(Response.json({ uploadId }));
    expect(await screen.findByText("인증 자료를 제출했어요.")).toBeInTheDocument();
    expect(uploadCalls).toHaveLength(1);
  });

  it("opens the matching issued Passport after manual approval when exactly one is owned", async () => {
    approvedFetch([passport(karaPassportId, "kara")]);
    render(<CertificationDetailScreen id={missionId} slug="kara" locale="ko" />);

    expect(await screen.findByRole("heading", { name: "인증이 승인됐어요" })).toBeInTheDocument();
    expect(await screen.findByText("발급된 내 패스포트를 다시 열어볼 수 있어요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "내 패스포트 보기" })).toHaveAttribute("href", `/passports/${karaPassportId}?locale=ko`);
  });

  it("keeps manual approval distinct from issuance when no Passport is owned", async () => {
    approvedFetch([]);
    render(<CertificationDetailScreen id={missionId} slug="kara" locale="ko" />);

    expect(await screen.findByText("이번 인증 승인과 패스포트 발급은 별개예요. 팬 인증에서 발급 과정을 확인하세요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "팬 인증 확인하기" })).toHaveAttribute("href", "/c/kara?tab=certifications&locale=ko#celebrity-content");
  });

  it("chooses the current creator Passport from multiple owned Passports", async () => {
    approvedFetch([
      passport("99999999-9999-4999-8999-999999999999", "elina"),
      passport(karaPassportId, "kara"),
    ]);
    render(<CertificationDetailScreen id={missionId} slug="kara" locale="ko" />);

    expect(await screen.findByRole("link", { name: "내 패스포트 보기" })).toHaveAttribute("href", `/passports/${karaPassportId}?locale=ko`);
  });

  it("uses a safe MY destination when Passport ownership cannot be confirmed", async () => {
    approvedFetch(new Response(null, { status: 503 }));
    render(<CertificationDetailScreen id={missionId} slug="kara" locale="ko" />);

    expect(await screen.findByText("패스포트 보유 여부를 확인하지 못했어요. MY에서 내 활동을 확인하세요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "MY로 이동" })).toHaveAttribute("href", "/my?locale=ko");
    expect(screen.queryByRole("link", { name: "내 패스포트 보기" })).not.toBeInTheDocument();
  });

  it("describes Passport ownership as loading before the owner read settles", async () => {
    let releasePassports!: (response: Response) => void;
    const passportResponse = new Promise<Response>((resolve) => { releasePassports = resolve; });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith(`/api/certifications/${missionId}?`)) return new Response(null, { status: 404 });
      if (url.startsWith("/api/passports?")) return passportResponse;
      if (url.includes("/api/me/")) return Response.json({ certifications: approvedHistory });
      if (url.includes(`/proofs/${uploadId}`)) return new Response(new Blob(["proof"], { type: "image/webp" }));
      if (url.includes(`/api/certification-submissions/${approvedId}`)) return Response.json({ submission: detail(approvedId, "approved", 1) });
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<CertificationDetailScreen id={missionId} slug="kara" locale="ko" />);

    expect(await screen.findByText("패스포트 보유 여부를 확인하는 중이에요. MY에서 내 활동을 먼저 확인할 수 있어요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "MY로 이동" })).toHaveAttribute("href", "/my?locale=ko");
    releasePassports(Response.json({ passports: [passport(karaPassportId, "kara")] }));
    expect(await screen.findByRole("link", { name: "내 패스포트 보기" })).toHaveAttribute("href", `/passports/${karaPassportId}?locale=ko`);
  });

  it("explains paid membership proof and uses the membership resubmission language", async () => {
    const membershipHistory = [{
      ...history[1],
      title: "YouTube 유료 멤버십 인증",
      membershipPlatform: "youtube",
    }];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith(`/api/certifications/${missionId}?`)) return Response.json({ certification: {
        id: missionId,
        kind: "manual",
        celebrity: { slug: "kara", name: "KARA" },
        category: "유료 멤버십",
        title: "YouTube 유료 멤버십 인증",
        description: "현재 유료 멤버십을 인증해 주세요.",
        instructions: "필수 정보가 한 화면에 없다면 여러 이미지를 제출해 주세요.",
        status: "available",
        opensAt: "2026-09-08T00:00:00+09:00",
        closesAt: "2026-09-30T00:00:00+09:00",
        reward: { scorePoints: 1, ticketAmount: 0, stampCount: 1 },
        membershipPlatform: "youtube",
        creatorAccountUrl: "https://www.youtube.com/@kara",
      } });
      if (url.includes("/api/me/")) return Response.json({ certifications: membershipHistory });
      if (url.includes(`/proofs/${uploadId}`)) return new Response(new Blob(["proof"], { type: "image/webp" }));
      if (url.includes(`/api/certification-submissions/${rejectedId}`)) return Response.json({ submission: {
        ...detail(rejectedId, "rejected", 1),
        title: "YouTube 유료 멤버십 인증",
        reward: { scorePoints: 1, ticketAmount: 0, stampCount: 1 },
        membershipPlatform: "youtube",
      } });
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<CertificationDetailScreen id={missionId} slug="kara" locale="ko" />);

    expect(await screen.findByText("YouTube 유료 멤버십 회원만 참여할 수 있어요")).toBeInTheDocument();
    expect(screen.getByText("일반 팔로우나 무료 채널 구독은 인증 대상이 아니에요.")).toBeInTheDocument();
    expect(screen.getByText("현재 유료 멤버십 상태")).toBeInTheDocument();
    expect(screen.getByText("다음 결제일 또는 유효기간")).toBeInTheDocument();
    expect(screen.getByText(/멤버십 시작일이나 가입 기간은 선택 사항/)).toBeInTheDocument();
    expect(screen.getByText(/최초 승인 시 한 번만 보상/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "크리에이터 계정 확인" })).toHaveAttribute("href", "https://www.youtube.com/@kara");
    expect(screen.getByText("멤버십 Stamp 1개")).toBeInTheDocument();
    expect(screen.queryByText("응모권")).not.toBeInTheDocument();
    expect(screen.getByText("보완 필요")).toBeInTheDocument();
    expect(screen.getByText("보완 요청 사유")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "보완 자료 제출하기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "보완 자료 제출하기" })).toBeDisabled();
  });
});
