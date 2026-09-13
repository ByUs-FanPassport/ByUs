import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ByUsSessionProvider, useByUsSession } from "./byus-session-provider";

const mocks = vi.hoisted(() => ({
  auth: { ready: true, authenticated: false, user: null as { id: string } | null, getAccessToken: vi.fn() },
  refreshUser: vi.fn(),
  createWallet: vi.fn(),
  replace: vi.fn(),
  markReady: vi.fn(),
  resetAvatar: vi.fn(),
  result: vi.fn(),
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => mocks.auth,
  useUser: () => ({ refreshUser: mocks.refreshUser }),
  useCreateWallet: () => ({ createWallet: mocks.createWallet }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("./avatar-session-bridge", () => ({
  useAvatarSessionReady: () => mocks.markReady,
  useAvatarSessionReset: () => mocks.resetAvatar,
}));
vi.mock("../features/analytics/client/signup-funnel-tracker", () => ({
  signupFunnelTracker: {
    resumeLogin: () => ({ nonce: "safe", provider: "unknown", trigger: "session_restore" }),
    result: (...args: unknown[]) => mocks.result(...args),
    forgetLoginAttempt: vi.fn(),
  },
}));

const wallet = { type: "wallet", chainType: "ethereum", connectorType: "embedded", walletClientType: "privy" };
const context = { returnTo: "/live/kara-nualeaf", locale: "ko" as const, intent: "reserve", entity: null, authIntent: null };

function Monitor() {
  const session = useByUsSession();
  return <output data-testid="session">{JSON.stringify({ ready: session.ready, pending: session.pending, ownerId: session.ownerId, generation: session.generation, error: session.error })}</output>;
}

function Starter({ owner = "fan-a", onStart }: { owner?: string; onStart?: () => void }) {
  const session = useByUsSession();
  return <button onClick={() => { void session.beginTransition({ ownerId: owner, ...context }); onStart?.(); }}>start {owner}</button>;
}

function Retry() {
  const session = useByUsSession();
  return <button onClick={() => void session.retryTransition()}>retry</button>;
}

const captureBegin = vi.fn();
function CaptureBegin() {
  const beginTransition = useByUsSession().beginTransition;
  useEffect(() => { captureBegin(beginTransition); }, [beginTransition]);
  return null;
}

function tree(children?: React.ReactNode) {
  return <ByUsSessionProvider><Monitor />{children}</ByUsSessionProvider>;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/login");
  mocks.auth = { ready: true, authenticated: false, user: null, getAccessToken: vi.fn(async () => "token") };
  mocks.refreshUser.mockReset().mockResolvedValue({ id: "fan-a", linkedAccounts: [wallet] });
  mocks.createWallet.mockReset().mockResolvedValue(wallet);
  mocks.replace.mockReset().mockImplementation((path: string) => window.history.replaceState({}, "", path));
  mocks.markReady.mockReset();
  mocks.resetAvatar.mockReset();
  mocks.result.mockReset();
  captureBegin.mockReset();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ profile: { completed: true } }));
  vi.mocked(globalThis.fetch).mockClear();
});

describe("root-owned ByUs session transition", () => {
  it("continues after the source login component unmounts", async () => {
    let finishRefresh!: (value: { id: string; linkedAccounts: typeof wallet[] }) => void;
    mocks.refreshUser.mockImplementation(() => new Promise((resolve) => { finishRefresh = resolve; }));
    function Harness() {
      const [showSource, setShowSource] = useState(true);
      return tree(showSource ? <Starter onStart={() => setShowSource(false)} /> : <div>destination</div>);
    }
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "start fan-a" }));
    expect(screen.getByText("destination")).toBeInTheDocument();
    expect(screen.getByTestId("session")).toHaveTextContent('"pending":true');
    mocks.auth = { ...mocks.auth, authenticated: true, user: { id: "fan-a" } };
    view.rerender(<Harness />);
    await act(async () => finishRefresh({ id: "fan-a", linkedAccounts: [wallet] }));
    await waitFor(() => expect(mocks.markReady).toHaveBeenCalledWith("fan-a"));
    expect(screen.getByTestId("session")).toHaveTextContent('"ready":true');
  });

  it("cancels ownership when the root provider itself unmounts", async () => {
    let finishRefresh!: (value: { id: string; linkedAccounts: typeof wallet[] }) => void;
    mocks.refreshUser.mockImplementation(() => new Promise((resolve) => { finishRefresh = resolve; }));
    const view = render(tree(<Starter />));
    fireEvent.click(screen.getByRole("button", { name: "start fan-a" }));
    view.unmount();
    await act(async () => finishRefresh({ id: "fan-a", linkedAccounts: [wallet] }));
    expect(mocks.auth.getAccessToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.markReady).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("rejects a stale callback owner already contradicted by the SDK", async () => {
    mocks.auth = { ...mocks.auth, authenticated: true, user: { id: "fan-b" } };
    render(tree(<Starter owner="fan-a" />));
    fireEvent.click(screen.getByRole("button", { name: "start fan-a" }));
    expect(mocks.refreshUser).not.toHaveBeenCalled();
    expect(screen.getByTestId("session")).toHaveTextContent('"ownerId":null');
  });

  it("rejects an old callback closure after the SDK has switched owners", async () => {
    const view = render(tree(<CaptureBegin />));
    const oldBegin = captureBegin.mock.calls.at(-1)![0] as ReturnType<typeof useByUsSession>["beginTransition"];
    mocks.auth = { ...mocks.auth, authenticated: true, user: { id: "fan-b" } };
    view.rerender(tree(<CaptureBegin />));
    await act(async () => {});
    await act(async () => { await oldBegin({ ownerId: "fan-a", ...context }); });
    expect(mocks.refreshUser).not.toHaveBeenCalled();
    expect(screen.getByTestId("session")).toHaveTextContent('"ownerId":null');
  });

  it("does not let an old A callback cancel B's active transition", async () => {
    let finishB!: (value: { id: string; linkedAccounts: typeof wallet[] }) => void;
    mocks.refreshUser.mockImplementation(() => new Promise((resolve) => { finishB = resolve; }));
    const view = render(tree(<><CaptureBegin /><Starter owner="fan-b" /></>));
    const oldBegin = captureBegin.mock.calls.at(-1)![0] as ReturnType<typeof useByUsSession>["beginTransition"];
    mocks.auth = { ...mocks.auth, authenticated: true, user: { id: "fan-b" } };
    view.rerender(tree(<><CaptureBegin /><Starter owner="fan-b" /></>));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "start fan-b" }));
    await oldBegin({ ownerId: "fan-a", ...context });
    expect(screen.getByTestId("session")).toHaveTextContent('"ownerId":"fan-b"');
    expect(screen.getByTestId("session")).toHaveTextContent('"pending":true');
    await act(async () => finishB({ id: "fan-b", linkedAccounts: [wallet] }));
    await waitFor(() => expect(mocks.markReady).toHaveBeenCalledWith("fan-b"));
  });

  it("invalidates A immediately on an SDK switch and ignores A's late result while B can start", async () => {
    let finishA!: (value: { id: string; linkedAccounts: typeof wallet[] }) => void;
    mocks.refreshUser.mockImplementationOnce(() => new Promise((resolve) => { finishA = resolve; }))
      .mockResolvedValueOnce({ id: "fan-b", linkedAccounts: [wallet] });
    const view = render(tree(<><Starter owner="fan-a" /><Starter owner="fan-b" /></>));
    fireEvent.click(screen.getByRole("button", { name: "start fan-a" }));
    mocks.auth = { ...mocks.auth, authenticated: true, user: { id: "fan-b" } };
    view.rerender(tree(<><Starter owner="fan-a" /><Starter owner="fan-b" /></>));
    await waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent('"ownerId":null'));
    fireEvent.click(screen.getByRole("button", { name: "start fan-b" }));
    await waitFor(() => expect(mocks.markReady).toHaveBeenCalledWith("fan-b"));
    await act(async () => finishA({ id: "fan-a", linkedAccounts: [wallet] }));
    expect(mocks.markReady).not.toHaveBeenCalledWith("fan-a");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("invalidates a pending owner on logout and ignores late SDK work", async () => {
    mocks.auth = { ...mocks.auth, authenticated: true, user: { id: "fan-a" } };
    let finish!: (value: { id: string; linkedAccounts: typeof wallet[] }) => void;
    mocks.refreshUser.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(tree(<Starter />));
    fireEvent.click(screen.getByRole("button", { name: "start fan-a" }));
    mocks.auth = { ...mocks.auth, authenticated: false, user: null };
    view.rerender(tree(<Starter />));
    await waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent('"ownerId":null'));
    await act(async () => finish({ id: "fan-a", linkedAccounts: [wallet] }));
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.markReady).not.toHaveBeenCalled();
  });

  it("keeps errors unready, returns to login, and retries with the current owner", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("private upstream detail"))
      .mockResolvedValueOnce(Response.json({ profile: { completed: true } }));
    render(tree(<><Starter /><Retry /></>));
    fireEvent.click(screen.getByRole("button", { name: "start fan-a" }));
    await waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent('"error":"SESSION_SYNCHRONIZATION_FAILED"'));
    expect(screen.getByTestId("session")).toHaveTextContent('"ready":false');
    expect(mocks.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?/));
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    await waitFor(() => expect(mocks.markReady).toHaveBeenCalledWith("fan-a"));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("routes incomplete verification onboarding only while still at the provisional destination", async () => {
    let finish!: (value: { id: string; linkedAccounts: typeof wallet[] }) => void;
    mocks.refreshUser.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.mocked(fetch).mockResolvedValue(Response.json({ profile: { completed: false } }));
    const verification = { ...context, returnTo: "/c/kara/verify?locale=ko", intent: "passport", entity: "kara" };
    function VerificationStarter() {
      const session = useByUsSession();
      return <button onClick={() => { void session.beginTransition({ ownerId: "fan-a", ...verification }); mocks.replace(verification.returnTo); }}>verify</button>;
    }
    render(tree(<VerificationStarter />));
    fireEvent.click(screen.getByRole("button", { name: "verify" }));
    await act(async () => finish({ id: "fan-a", linkedAccounts: [wallet] }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/onboarding\/profile\?/)));
  });

  it("does not send a user back after they leave during a delayed successful transition", async () => {
    let finish!: (value: { id: string; linkedAccounts: typeof wallet[] }) => void;
    mocks.refreshUser.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.mocked(fetch).mockResolvedValue(Response.json({ profile: { completed: false } }));
    const verification = { ...context, returnTo: "/c/kara/verify?locale=ko", intent: "passport", entity: "kara" };
    function VerificationStarter() {
      const session = useByUsSession();
      return <button onClick={() => { void session.beginTransition({ ownerId: "fan-a", ...verification }); mocks.replace(verification.returnTo); }}>verify</button>;
    }
    render(tree(<VerificationStarter />));
    fireEvent.click(screen.getByRole("button", { name: "verify" }));
    window.history.replaceState({}, "", "/guide?locale=ko");
    mocks.replace.mockClear();
    await act(async () => finish({ id: "fan-a", linkedAccounts: [wallet] }));
    await waitFor(() => expect(mocks.markReady).toHaveBeenCalledWith("fan-a"));
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
