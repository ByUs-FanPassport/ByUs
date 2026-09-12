import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreatorInstagramPage } from "./connection-page";
import type { CreatorInstagramAccount } from "../domain/connection";
const push = vi.fn();
const getAccessToken = vi.fn();
let authenticated = true;
let owner = "owner-a";
let query = "";
const fetchMock = vi.fn();
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated, user: authenticated ? { id: owner } : null, getAccessToken }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams(query) }));
vi.mock("next/image", () => ({ default: ({ priority: _p, unoptimized: _u, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean; unoptimized?: boolean }) => <img {...props} alt={props.alt ?? ""} /> }));
const account: CreatorInstagramAccount = { celebrityId: "11111111-1111-4111-8111-111111111111", generation: "22222222-2222-4222-8222-222222222222", slug: "elina", name: "엘리나", username: "elina_4_22", avatarUrl: "/images/home-entry/elina.jpg", liveEnabled: true, needsReconnect: false, mediaStatus: "connected" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { authenticated = true; owner = "owner-a"; query = ""; push.mockReset(); getAccessToken.mockReset().mockResolvedValue("test-bearer"); fetchMock.mockReset().mockResolvedValue(response({ connections: [] })); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Creator Instagram connection", () => {
  it("requires ByUs login before making any Instagram request and preserves the return path", () => {
    authenticated = false;
    render(<CreatorInstagramPage locale="ko" />);
    fireEvent.click(screen.getByRole("button", { name: "Instagram 연결하기" }));
    expect(fetchMock).not.toHaveBeenCalled();
    const url = new URL(push.mock.calls[0][0], "https://byus.kr");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("returnTo")).toBe("/connect/instagram?locale=ko&resume=start");
  });
  it("preserves pending confirmation when login has expired", () => {
    authenticated = false; query = "step=confirm";
    render(<CreatorInstagramPage locale="ko" />);
    fireEvent.click(screen.getByRole("button", { name: "Instagram 연결하기" }));
    expect(new URL(push.mock.calls[0][0], "https://byus.kr").searchParams.get("returnTo")).toContain("step=confirm");
  });
  it("waits for server confirmation before changing the LIVE switch and submits identity generation", async () => {
    fetchMock.mockResolvedValueOnce(response({ connections: [account] }));
    let finish: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<CreatorInstagramPage locale="ko" />);
    const toggle = await screen.findByRole("switch", { name: "LIVE 자동 표시" });
    fireEvent.click(toggle);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(toggle).toHaveAttribute("aria-checked", "true"); expect(toggle).toBeDisabled();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ celebrityId: account.celebrityId, generation: account.generation, liveEnabled: false });
    await act(async () => finish(response({ account: { ...account, liveEnabled: false } })));
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("link", { name: "내 팬페이지 보기" })).toHaveAttribute("href", "/c/elina?locale=ko");
  });
  it("keeps prior preference on save failure and reports an actionable error", async () => {
    fetchMock.mockResolvedValueOnce(response({ connections: [account] })).mockResolvedValueOnce(response({ error: { code: "STALE" } }, 409));
    render(<CreatorInstagramPage locale="ko" />);
    fireEvent.click(await screen.findByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent("새로고침");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });
  it("requires explicit disconnect confirmation and preserves remote revocation uncertainty", async () => {
    fetchMock.mockResolvedValueOnce(response({ connections: [account] })).mockResolvedValueOnce(response({ disconnected: true, remoteRevocation: "unconfirmed" }));
    render(<CreatorInstagramPage locale="ko" />);
    fireEvent.click(await screen.findByRole("button", { name: "Instagram 연결 해제" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("해제할까요?");
    fireEvent.click(screen.getByRole("button", { name: "Instagram 연결 해제" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Instagram의 앱 및 웹사이트 설정");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
  it("returns from permissions to pending confirmation without granting connected UI", async () => {
    query = "step=confirm";
    fetchMock.mockResolvedValueOnce(response({ account }));
    render(<CreatorInstagramPage locale="ko" />);
    await screen.findByRole("button", { name: "이 계정 연결하기" });
    fireEvent.click(screen.getByRole("button", { name: "이용하는 정보와 권한" }));
    fireEvent.click(screen.getAllByRole("button", { name: "돌아가기" })[0]);
    expect(screen.getByRole("button", { name: "이 계정 연결하기" })).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
  it("discards an in-flight response on a ByUs account switch", async () => {
    let finish: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(response({ connections: [] }));
    const view = render(<CreatorInstagramPage locale="ko" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    owner = "owner-b";
    view.rerender(<CreatorInstagramPage locale="ko" />);
    await act(async () => finish(response({ connections: [account] })));
    expect(screen.queryByText("@elina_4_22")).not.toBeInTheDocument();
  });
  it("does not promise a fan management dashboard and explains photos/reels in both languages", async () => {
    authenticated = false;
    render(<CreatorInstagramPage locale="en" />);
    expect(screen.getByText("Fans can discover your recent photos and reels.")).toBeInTheDocument();
    expect(screen.queryByText(/Start managing fans/i)).not.toBeInTheDocument();
  });
  it("ignores an old owner's delayed OAuth start response after switching accounts", async () => {
    let finish: (r: Response) => void = () => {};
    fetchMock.mockResolvedValueOnce(response({ connections: [] }))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(response({ connections: [account] }));
    const view = render(<CreatorInstagramPage locale="ko" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Instagram 연결하기" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Instagram 연결하기" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    owner = "owner-b";
    view.rerender(<CreatorInstagramPage locale="ko" />);
    await screen.findByRole("switch");
    await act(async () => finish(response({ authorizationUrl: "https://www.instagram.com/oauth/authorize?state=old" })));
    expect(screen.getByRole("switch")).toBeInTheDocument();
    expect(screen.getByText("@elina_4_22")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
