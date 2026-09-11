import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CertificationReviewWorkspace,
  type CertificationReviewSubmission,
  type ProofLoader,
  type ReviewStatus,
} from "./certification-review-workspace";

const baseSubmission: CertificationReviewSubmission = {
  id: "submission-a",
  missionId: "mission-a",
  missionTitle: "유튜브 유료 멤버십",
  missionTitleEn: "YouTube paid membership",
  celebritySlug: "creator-a",
  creatorNameKo: "크리에이터 A",
  creatorNameEn: "Creator A",
  appUserId: "user-a-12345678",
  applicantName: "팬 A",
  status: "pending",
  attemptNumber: 1,
  note: "가입 화면입니다.",
  revision: 1,
  submittedAt: "2026-09-11T01:00:00.000Z",
  instructionsKo: "계정과 결제일을 보여 주세요.",
  instructionsEn: "Show the account and billing date.",
  reward: { scorePoints: 1, ticketAmount: 0, stampCount: 1 },
  membershipPlatform: "youtube",
  uploads: [{ id: "proof-a-1", width: 400, height: 600 }],
};

function submission(overrides: Partial<CertificationReviewSubmission> = {}): CertificationReviewSubmission {
  return { ...baseSubmission, ...overrides };
}

function setup({
  submissions = [baseSubmission],
  status = "pending",
  loadProof = vi.fn(async (_submissionId: string, uploadId: string) => new Blob([uploadId], { type: "image/webp" })),
  onReview = vi.fn(async () => undefined),
}: {
  submissions?: CertificationReviewSubmission[];
  status?: ReviewStatus;
  loadProof?: ProofLoader;
  onReview?: (item: CertificationReviewSubmission, decision: "approve" | "reject", reason?: string) => Promise<void>;
} = {}) {
  const rendered = render(
    <CertificationReviewWorkspace
      submissions={submissions}
      locale="ko"
      status={status}
      busy={false}
      canWrite
      loadProof={loadProof}
      onReview={onReview}
    />,
  );
  return { ...rendered, loadProof, onReview };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  let sequence = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:proof-${++sequence}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CertificationReviewWorkspace", () => {
  it("blocks approval without an image while allowing a reasoned request for more proof", async () => {
    const onReview = vi.fn(async () => undefined);
    const loadProof = vi.fn<ProofLoader>();
    setup({ submissions: [submission({ uploads: [] })], loadProof, onReview });

    expect(await screen.findByText("첨부된 이미지가 없습니다")).toBeVisible();
    expect(loadProof).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "승인" })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("다시 제출할 내용을 구체적으로 알려 주세요."), {
      target: { value: "결제일이 보이는 이미지를 첨부해 주세요." },
    });
    const reject = screen.getByRole("button", { name: "보완 요청" });
    expect(reject).toBeEnabled();
    fireEvent.click(reject);
    await waitFor(() => expect(onReview).toHaveBeenCalledWith(
      expect.objectContaining({ id: "submission-a" }),
      "reject",
      "결제일이 보이는 이미지를 첨부해 주세요.",
    ));
  });

  it("requires a real load event for every proof and blocks approval after any image error", async () => {
    setup({ submissions: [submission({ uploads: [
      { id: "proof-a-1", width: 400, height: 600 },
      { id: "proof-a-2", width: 400, height: 600 },
    ] })] });

    const main = await screen.findByAltText("인증 이미지 1");
    const secondThumbnail = screen.getByAltText("인증 이미지 2 미리보기");
    const approve = screen.getByRole("button", { name: "승인" });
    expect(approve).toBeDisabled();

    fireEvent.load(main);
    expect(approve).toBeDisabled();
    fireEvent.load(secondThumbnail);
    await waitFor(() => expect(approve).toBeEnabled());

    fireEvent.error(secondThumbnail);
    expect(await screen.findByRole("alert")).toHaveTextContent("이미지를 불러오지 못했습니다");
    expect(approve).toBeDisabled();
  });

  it("retries the complete proof load after a loader failure", async () => {
    const loadProof = vi.fn<ProofLoader>()
      .mockRejectedValueOnce(new Error("temporary proof failure"))
      .mockResolvedValueOnce(new Blob(["proof"], { type: "image/webp" }));
    setup({ loadProof });

    expect(await screen.findByRole("alert")).toHaveTextContent("이미지를 불러오지 못했습니다");
    fireEvent.click(screen.getByRole("button", { name: "이미지 다시 불러오기" }));

    const proof = await screen.findByAltText("인증 이미지 1");
    expect(loadProof).toHaveBeenCalledTimes(2);
    fireEvent.load(proof);
    await waitFor(() => expect(screen.getByRole("button", { name: "승인" })).toBeEnabled());
  });

  it("clears previous evidence, aborts superseded loads, and revokes their object URLs", async () => {
    const delayedB = deferred<Blob>();
    const delayedOldC = deferred<Blob>();
    const proofA = new Blob(["a"], { type: "image/webp" });
    const proofC = new Blob(["c"], { type: "image/webp" });
    const loadProof = vi.fn<ProofLoader>((submissionId, _uploadId, _signal) => {
      if (submissionId === "submission-a") return Promise.resolve(proofA);
      if (submissionId === "submission-b") return delayedB.promise;
      if (submissionId === "submission-c") return delayedOldC.promise;
      throw new Error("unexpected submission");
    });
    const submissions = [
      baseSubmission,
      submission({ id: "submission-b", appUserId: "user-b", applicantName: "팬 B", uploads: [{ id: "proof-b-1", width: 400, height: 600 }] }),
      submission({ id: "submission-c", appUserId: "user-c", applicantName: "팬 C", uploads: [{ id: "proof-c-1", width: 400, height: 600 }] }),
    ];
    setup({ submissions, loadProof });

    expect(await screen.findByAltText("인증 이미지 1")).toHaveAttribute("src", "blob:proof-1");
    fireEvent.click(screen.getByRole("button", { name: /팬 B/ }));
    expect(screen.queryByAltText("인증 이미지 1")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("이미지를 불러오는 중입니다");
    expect(loadProof.mock.calls[0][2].aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:proof-1");

    fireEvent.click(screen.getByRole("button", { name: /팬 C/ }));
    const bSignal = loadProof.mock.calls.find(([id]) => id === "submission-b")?.[2];
    expect(bSignal?.aborted).toBe(true);
    await act(async () => { delayedB.resolve(new Blob(["b"], { type: "image/webp" })); await delayedB.promise; });
    expect(screen.queryByText("팬 B", { selector: "h2" })).not.toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    await act(async () => { delayedOldC.resolve(proofC); await delayedOldC.promise; });
    expect(await screen.findByAltText("인증 이미지 1")).toHaveAttribute("src", "blob:proof-2");
  });

  it("opens the enlarged viewer and supports next, previous, and close controls", async () => {
    setup({ submissions: [submission({ uploads: [
      { id: "proof-a-1", width: 400, height: 600 },
      { id: "proof-a-2", width: 500, height: 700 },
    ] })] });

    await screen.findByAltText("인증 이미지 1");
    fireEvent.click(screen.getByRole("button", { name: "확대 보기" }));
    const dialog = screen.getByRole("dialog", { name: "인증 이미지 확대" });
    expect(dialog).toHaveAttribute("open");
    expect(within(dialog).getByAltText("확대한 인증 이미지 1")).toHaveAttribute("src", "blob:proof-1");
    expect(within(dialog).getByRole("button", { name: "이전 이미지" })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "다음 이미지" }));
    expect(within(dialog).getByAltText("확대한 인증 이미지 2")).toHaveAttribute("src", "blob:proof-2");
    expect(within(dialog).getByRole("button", { name: "다음 이미지" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "이전 이미지" }));
    expect(within(dialog).getByAltText("확대한 인증 이미지 1")).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "확대 닫기" }));
    expect(dialog).not.toHaveAttribute("open");
  });

  it.each([
    ["approved" as const, "승인 완료", null],
    ["rejected" as const, "보완 요청", "다음 결제일이 보이도록 다시 제출해 주세요."],
  ])("keeps %s submissions read-only", async (status, label, rejectionReason) => {
    const onReview = vi.fn(async () => undefined);
    setup({
      status,
      submissions: [submission({ status, reviewedAt: "2026-09-11T02:00:00.000Z", rejectionReason })],
      onReview,
    });

    expect(await screen.findByText("심사 내역")).toBeVisible();
    expect(screen.getByText(label)).toBeVisible();
    if (rejectionReason) expect(screen.getByText(rejectionReason)).toBeVisible();
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "보완 요청" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("다시 제출할 내용을 구체적으로 알려 주세요.")).not.toBeInTheDocument();
    expect(onReview).not.toHaveBeenCalled();
  });
});
