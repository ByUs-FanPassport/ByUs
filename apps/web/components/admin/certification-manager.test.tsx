import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizedCertificationManager } from "./certification-manager";

const getAccessToken = vi.fn(async () => "token");
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ getAccessToken }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("./use-admin-session", () => ({
  useAdminSession: () => ({ status: "authorized", admin: { role: "operator" } }),
}));
vi.mock("./operations-shell", () => ({ AdminOperationsShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const mission = {
  id: "mission-1", celebrityId: "celebrity-1", celebritySlug: "star", immutableKey: "mission-key",
  revision: 1, status: "draft", category: "support", titleKo: "응원 인증", titleEn: "Support",
  descriptionKo: "설명", descriptionEn: "Description", instructionsKo: "안내", instructionsEn: "Instructions",
  opensAt: "2026-09-10T00:00:00.000Z", closesAt: "2026-09-11T00:00:00.000Z",
  reward: { scorePoints: 10, ticketAmount: 1 },
};
const submission = {
  id: "submission-1", missionId: "mission-1", missionTitle: "응원 인증", celebritySlug: "star",
  appUserId: "user-1", status: "pending", attemptNumber: 1, note: null, revision: 1,
  submittedAt: "2026-09-10T00:30:00.000Z", reward: { scorePoints: 10, ticketAmount: 1 }, uploads: [],
};
const membershipMission = {
  ...mission,
  id: "membership-mission",
  immutableKey: "membership-youtube",
  titleKo: "YouTube 유료 멤버십 인증",
  titleEn: "YouTube paid membership verification",
  reward: { scorePoints: 1, ticketAmount: 0, stampCount: 1 as const },
  membershipPlatform: "youtube" as const,
};
const membershipSubmission = {
  ...submission,
  id: "membership-submission",
  missionId: membershipMission.id,
  missionTitle: membershipMission.titleKo,
  reward: membershipMission.reward,
  membershipPlatform: "youtube" as const,
};

describe("certification manager mutations", () => {
  beforeEach(() => {
    getAccessToken.mockReset();
    getAccessToken.mockResolvedValue("token");
  });

  it("guards before a delayed token, blocks conflicting edits through refresh, and recovers after failure", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") return new Response(null, { status: 500 });
      if (url.includes("certification-missions")) return Response.json({ missions: [mission] });
      return Response.json({ submissions: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthorizedCertificationManager />);
    fireEvent.click(await screen.findByRole("button", { name: /응원 인증/ }));

    let resolveToken!: (token: string) => void;
    getAccessToken.mockImplementation(() => new Promise((resolve) => { resolveToken = resolve; }));
    const activate = screen.getByRole("button", { name: /활성화/ });
    fireEvent.click(activate);
    fireEvent.click(activate);

    expect(activate).toBeDisabled();
    expect(screen.getByRole("button", { name: /새 미션/ })).toBeDisabled();
    expect(screen.getByDisplayValue("응원 인증")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("처리 중입니다");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);

    resolveToken("token");
    expect(await screen.findByRole("alert")).toHaveTextContent("처리하지 못했습니다");
    await waitFor(() => expect(activate).toBeEnabled());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("stays pending through the follow-up GET and reports refresh failure instead of success", async () => {
    let resolveRefresh!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ missions: [mission] }))
      .mockResolvedValueOnce(Response.json({ submissions: [] }))
      .mockResolvedValueOnce(Response.json({ mission }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }))
      .mockResolvedValueOnce(Response.json({ submissions: [] }))
      .mockResolvedValueOnce(Response.json({ missions: [{ ...mission, revision: 2 }] }))
      .mockResolvedValueOnce(Response.json({ submissions: [] }))
      .mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthorizedCertificationManager />);
    fireEvent.click(await screen.findByRole("button", { name: /응원 인증/ }));
    const activate = screen.getByRole("button", { name: /활성화/ });
    fireEvent.click(activate);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(activate).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("처리 중입니다");
    resolveRefresh(new Response(null, { status: 500 }));

    expect(await screen.findByRole("alert")).toHaveTextContent("변경은 처리됐지만 최신 상태를 불러오지 못했습니다");
    expect(screen.queryByText("저장했습니다.")).not.toBeInTheDocument();
    expect(activate).toBeDisabled();
    const refresh = screen.getByRole("button", { name: /최신 상태 불러오기/ });
    expect(refresh).toBeEnabled();
    const postsBeforeRecovery = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;
    fireEvent.click(refresh);
    await waitFor(() => expect(activate).toBeEnabled());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(postsBeforeRecovery);
    fireEvent.click(activate);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(postsBeforeRecovery + 1));
    const lastPost = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").at(-1);
    expect(JSON.parse(String(lastPost?.[1]?.body))).toMatchObject({ expectedRevision: 2 });
  });

  it("applies the same pre-token duplicate guard to review mutations", async () => {
    let postCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        postCount += 1;
        if (postCount <= 2) throw new TypeError("network failed");
        return new Response(null, { status: 500 });
      }
      return String(input).includes("certification-missions")
        ? Response.json({ missions: [mission] })
        : Response.json({ submissions: [submission] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthorizedCertificationManager />);
    const approve = await screen.findByRole("button", { name: /승인/ });

    let resolveToken!: (token: string) => void;
    getAccessToken.mockImplementation(() => new Promise((resolve) => { resolveToken = resolve; }));
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(approve).toBeDisabled();
    expect(screen.getByRole("button", { name: /새 미션/ })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);

    resolveToken("token");
    expect(await screen.findByRole("alert")).toHaveTextContent("검토 결과를 반영하지 못했습니다");
    await waitFor(() => expect(approve).toBeEnabled());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    getAccessToken.mockResolvedValue("token");
    fireEvent.click(approve);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2));
    await screen.findByRole("alert");
    const firstTwoBodies = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(firstTwoBodies[1].idem).toBe(firstTwoBodies[0].idem);

    fireEvent.change(screen.getByLabelText("반려 사유"), { target: { value: "증빙이 불충분합니다" } });
    fireEvent.click(screen.getByRole("button", { name: /반려/ }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(3));
    const thirdBody = JSON.parse(String(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")[2][1]?.body));
    expect(thirdBody.idem).not.toBe(firstTwoBodies[0].idem);
    expect(thirdBody.decision).toBe("reject");
  });

  it("retains a newly created mission id for GET-only recovery", async () => {
    let resolveRefresh!: (response: Response) => void;
    const created = { ...mission, id: "created-mission", revision: 1 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ missions: [] }))
      .mockResolvedValueOnce(Response.json({ submissions: [] }))
      .mockResolvedValueOnce(Response.json({ id: created.id }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }))
      .mockResolvedValueOnce(Response.json({ submissions: [] }))
      .mockResolvedValueOnce(Response.json({ missions: [created] }))
      .mockResolvedValueOnce(Response.json({ submissions: [] }))
      .mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthorizedCertificationManager />);
    await screen.findByText("검토할 제출이 없습니다.");
    fireEvent.change(screen.getByLabelText("Open"), { target: { value: "2026-09-10T00:00" } });
    fireEvent.change(screen.getByLabelText("Close"), { target: { value: "2026-09-11T00:00" } });
    fireEvent.submit(screen.getByRole("button", { name: /초안 저장/ }).closest("form")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    resolveRefresh(new Response(null, { status: 500 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("변경은 처리됐지만 최신 상태를 불러오지 못했습니다");
    fireEvent.click(screen.getByRole("button", { name: /최신 상태 불러오기/ }));
    const activate = await screen.findByRole("button", { name: /활성화/ });
    expect(screen.getByDisplayValue("응원 인증")).toBeEnabled();
    fireEvent.click(activate);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2));
    const lastPost = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").at(-1);
    expect(JSON.parse(String(lastPost?.[1]?.body))).toMatchObject({ id: created.id, expectedRevision: 1 });
  });

  it("applies membership presets and includes the selected platform in a new mission save", async () => {
    let savedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        savedBody = JSON.parse(String(init.body));
        return Response.json({ id: membershipMission.id });
      }
      if (url.includes("certification-missions")) {
        return Response.json({ missions: savedBody ? [membershipMission] : [] });
      }
      return Response.json({ submissions: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthorizedCertificationManager />);
    await screen.findByText("검토할 제출이 없습니다.");

    fireEvent.change(screen.getByLabelText("인증 유형"), { target: { value: "youtube" } });
    expect(screen.getByDisplayValue("YouTube 유료 멤버십 인증")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/YouTube에서 가입한 멤버십의 정보 화면/)).toBeInTheDocument();
    expect(screen.getByLabelText("Score")).toHaveValue(1);
    expect(screen.getByLabelText("Tickets")).toHaveValue(0);
    fireEvent.change(screen.getByLabelText("Open"), { target: { value: "2026-09-10T00:00" } });
    fireEvent.change(screen.getByLabelText("Close"), { target: { value: "2026-09-11T00:00" } });
    fireEvent.submit(screen.getByRole("button", { name: /초안 저장/ }).closest("form")!);

    await waitFor(() => expect(savedBody).toMatchObject({
      command: "save",
      membershipPlatform: "youtube",
      scorePoints: 1,
      ticketAmount: 0,
    }));
    expect(await screen.findByRole("button", { name: /YouTube 유료 멤버십 인증/ })).toHaveTextContent("YouTube");
    expect(screen.getByLabelText("인증 유형")).toBeDisabled();
  });

  it("keeps generic saves backward compatible and gives membership reviews proof-request language", async () => {
    let genericBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        genericBody = JSON.parse(String(init.body));
        return Response.json({ id: "generic-created" });
      }
      return url.includes("certification-missions")
        ? Response.json({ missions: [] })
        : Response.json({ submissions: [membershipSubmission] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthorizedCertificationManager />);

    expect(await screen.findByText("보완 요청 사유")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "보완 요청" })).toBeDisabled();
    expect(screen.getByText("1 Membership Stamp")).toBeInTheDocument();
    expect(screen.queryByText(/\+0 ticket/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Open"), { target: { value: "2026-09-10T00:00" } });
    fireEvent.change(screen.getByLabelText("Close"), { target: { value: "2026-09-11T00:00" } });
    fireEvent.submit(screen.getByRole("button", { name: /초안 저장/ }).closest("form")!);

    await waitFor(() => expect(genericBody).not.toBeNull());
    expect(genericBody).not.toHaveProperty("membershipPlatform");
  });
});
