import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: { id: "owner-a" } as { id: string } | undefined, getAccessToken: vi.fn<() => Promise<string | null>>().mockResolvedValue("token") }));
const action = vi.hoisted(() => vi.fn());
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true, ...auth }) }));
vi.mock("./use-community-stamps", () => ({ communityStampAction: action }));

import { SharePassport } from "./share-passport";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe("SharePassport", () => {
  afterEach(() => {
    auth.user = { id: "owner-a" }; auth.getAccessToken.mockReset().mockResolvedValue("token");
    action.mockReset(); vi.unstubAllGlobals(); vi.clearAllMocks();
  });

  it("uses two separate gestures: creating a token neither opens native share nor copies", async () => {
    const share = vi.fn(); const copy = vi.fn();
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    action.mockImplementation(async (_token, _name, _body, parse) => parse({ token: "a".repeat(32) }));
    render(<StrictMode><SharePassport creator={{ slug: "elina", name: "Elina" }} locale="en" /></StrictMode>);
    const create = screen.getByRole("button", { name: "Create share link" });
    fireEvent.click(create); fireEvent.click(create);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith(auth.getAccessToken, "share-link", { creator: "elina" }, expect.any(Function));
    expect(share).not.toHaveBeenCalled(); expect(copy).not.toHaveBeenCalled();
    expect(await screen.findByDisplayValue(/\/s\/a{32}\?locale=en$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(share).toHaveBeenCalledOnce());
  });

  it("treats a cancelled native share as neither an error nor an award", async () => {
    Object.defineProperty(navigator, "share", { configurable: true, value: vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError")) });
    action.mockImplementation(async (_token, _name, _body, parse) => parse({ token: "b".repeat(32) }));
    render(<SharePassport creator={{ slug: "elina" }} locale="ko" />);
    fireEvent.click(screen.getByRole("button", { name: "공유 링크 만들기" }));
    await screen.findByRole("button", { name: "공유" });
    fireEvent.click(screen.getByRole("button", { name: "공유" }));
    await waitFor(() => expect(navigator.share).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/스탬프가 기록/)).not.toBeInTheDocument();
  });

  it("drops an old owner's pending link after an owner switch", async () => {
    const pending = deferred<{ token: string }>();
    action.mockImplementation(() => pending.promise);
    const view = render(<SharePassport creator={{ slug: "elina" }} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Create share link" }));
    auth.user = { id: "owner-b" };
    view.rerender(<SharePassport creator={{ slug: "elina" }} locale="en" />);
    await act(async () => { pending.resolve({ token: "c".repeat(32) }); });
    expect(screen.queryByDisplayValue(/c{32}/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create share link" })).toBeEnabled();
  });
});
