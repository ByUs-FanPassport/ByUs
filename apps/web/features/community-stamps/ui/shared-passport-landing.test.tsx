import "@testing-library/jest-dom/vitest";
import { StrictMode, type ImgHTMLAttributes } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ ready: true, authenticated: true, user: { id: "visitor-a" } as { id: string } | undefined, getAccessToken: vi.fn<() => Promise<string | null>>().mockResolvedValue("token") }));
const action = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => auth }));
vi.mock("./use-community-stamps", () => ({ communityStampAction: action }));
vi.mock("next/image", () => ({ default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt ?? ""} /> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { SharedPassportLanding } from "./shared-passport-landing";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const creator = { slug: "elina", name: "Elina", image: { url: "/images/calendar/yuna-portrait.jpg", alt: "Elina" } };

describe("SharedPassportLanding", () => {
  afterEach(() => { auth.ready = true; auth.authenticated = true; auth.user = { id: "visitor-a" }; auth.getAccessToken.mockReset().mockResolvedValue("token"); action.mockReset(); push.mockReset(); vi.clearAllMocks(); });

  it("posts one verified visit, disables repeats, and sends only the token", async () => {
    const pending = deferred<{ creator: string }>(); action.mockImplementation(() => pending.promise);
    render(<StrictMode><SharedPassportLanding token={"d".repeat(32)} creator={creator} locale="en" /></StrictMode>);
    const visit = screen.getByRole("button", { name: "View favorite" });
    fireEvent.click(visit); fireEvent.click(visit);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith(auth.getAccessToken, "share-visit", { token: "d".repeat(32) }, expect.any(Function));
    expect(visit).toBeDisabled();
  });

  it("does not navigate after an owner switch while an old visit is pending", async () => {
    const pending = deferred<{ creator: string }>(); action.mockImplementation(() => pending.promise);
    const view = render(<SharedPassportLanding token={"e".repeat(32)} creator={creator} locale="ko" />);
    fireEvent.click(screen.getByRole("button", { name: "최애 보기" }));
    auth.user = { id: "visitor-b" }; view.rerender(<SharedPassportLanding token={"e".repeat(32)} creator={creator} locale="ko" />);
    await act(async () => { pending.resolve({ creator: "elina" }); });
    expect(push).not.toHaveBeenCalled();
  });

  it("shows a retryable error and keeps a failed visit from double posting", async () => {
    action.mockRejectedValueOnce(new Error("COMMUNITY_STAMP_UNAVAILABLE")).mockResolvedValueOnce({ creator: "elina" });
    render(<SharedPassportLanding token={"f".repeat(32)} creator={creator} locale="ko" />);
    fireEvent.click(screen.getByRole("button", { name: "최애 보기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("열지 못했어요");
    const retry = screen.getByRole("button", { name: "최애 보기" });
    expect(retry).toBeEnabled(); fireEvent.click(retry); fireEvent.click(retry);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  });
});
