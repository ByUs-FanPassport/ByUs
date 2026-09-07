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

function detail(id: string, status: "pending" | "rejected", attemptNumber: number) {
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
    reviewedAt: status === "rejected" ? "2026-09-08T01:00:00.000Z" : null,
    reward: { scorePoints: 2, ticketAmount: 1 },
    uploads: [{ id: uploadId, contentType: "image/webp", width: 800, height: 600 }],
  };
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
});
