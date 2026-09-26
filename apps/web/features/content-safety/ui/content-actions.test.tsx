import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentActions, ContentTranslation } from "./content-actions";
import { ContentAssetImage } from "./content-asset";
import { PostComposer } from "@/features/fan-posts/ui/post-composer";

const context = vi.hoisted(() => ({
  auth: { ready: true, authenticated: true, user: { id: "owner-a" }, getAccessToken: vi.fn(async () => "token-a") },
  session: { ready: true, ownerId: "owner-a", generation: 1 },
}));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => context.auth }));
vi.mock("@/components/byus-session-provider", () => ({ useByUsSession: () => context.session }));
const id = "10000000-0000-4000-8000-000000000001";
const translation = { targetType: "fan_post", targetId: id, targetLocale: "en", sourceRevision: 1, translatedText: "<img src=x onerror=alert(1)>", cached: true };
beforeEach(() => { context.auth.user = { id: "owner-a" }; context.auth.authenticated = true; context.session.ownerId = "owner-a"; context.session.generation = 1; context.auth.getAccessToken.mockResolvedValue("token-a"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("content ownership and retries", () => {
  it("renders translation as text, restores the original and reauthorizes another translation", async () => {
    const fetcher = vi.fn(async () => Response.json(translation)); vi.stubGlobal("fetch", fetcher);
    const { container } = render(<ContentTranslation targetType="fan_post" targetId={id} locale="en"><p>Original body</p></ContentTranslation>);
    fireEvent.click(screen.getByRole("button", { name: "Translate" }));
    await screen.findByText(translation.translatedText); expect(container.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show original" }));
    expect(screen.getByText("Original body")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Translate" }));
    await screen.findByText(translation.translatedText); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("clears report drafts and translated content when the account generation changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(translation)));
    const view = () => <><ContentTranslation targetType="fan_post" targetId={id} locale="en"><p>Original body</p></ContentTranslation><ContentActions targetType="fan_post" targetId={id} locale="en" /></>;
    const { rerender } = render(view());
    fireEvent.change(screen.getByLabelText("Reason for reporting"), { target: { value: "Private draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Translate" })); await screen.findByText(translation.translatedText);
    context.session.generation += 1; rerender(view());
    expect(screen.queryByText(translation.translatedText)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Reason for reporting")).toHaveValue("");
  });
  it("keeps blocking separate from reporting and restores focus after a report", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id })));
    render(<ContentActions targetType="fan_post" targetId={id} locale="en" />);
    const summary = document.querySelector("summary")!;
    const block = screen.getByRole("button", { name: "Block author" });
    expect(block.closest("form")).toBeNull();
    fireEvent.click(summary);
    fireEvent.change(screen.getByLabelText("Reason for reporting"), { target: { value: "Spam" } });
    fireEvent.submit(screen.getByLabelText("Reason for reporting").closest("form")!);
    await screen.findByText("Report submitted.");
    await waitFor(() => expect(summary).toHaveFocus());
  });
  it("reuses a post creation key after a lost response", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: "UNAVAILABLE" } }, { status: 503 })).mockResolvedValueOnce(Response.json({ id, revision: 1, replayed: true }));
    vi.stubGlobal("fetch", fetcher); const saved = vi.fn();
    render(<PostComposer slug="artist" locale="en" onSaved={saved} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" })); await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Publish" })); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    const first = JSON.parse(fetcher.mock.calls[0][1].body), second = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(first.idempotencyKey).toBe(second.idempotencyKey); expect(second).not.toHaveProperty("appUserId");
  });
  it("connects photo limits and validation errors to the file input", () => {
    render(<PostComposer slug="artist" locale="en" onSaved={vi.fn()} />);
    const input = screen.getByLabelText("Add photos");
    fireEvent.change(input, { target: { files: Array.from({ length: 5 }, (_, index) => new File(["x"], `${index}.jpg`, { type: "image/jpeg" })) } });

    expect(input).toHaveAttribute("aria-invalid", "true");
    const descriptions = input.getAttribute("aria-describedby")!.split(" ").map(value => document.getElementById(value)?.textContent);
    expect(descriptions).toEqual(["JPEG, PNG or WebP, up to 8MB each, 4 photos maximum", "JPEG, PNG or WebP, up to 8MB each, 4 photos maximum"]);
  });
  it("aborts a protected image from the previous owner and does not create its object URL", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; })).mockResolvedValue(Response.json({}, { status: 404 }));
    vi.stubGlobal("fetch", fetcher); const createObjectURL = vi.fn(() => "blob:image"), revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL; });
    const view = () => <ContentAssetImage asset={{ id, width: 2, height: 2 }} locale="en" alt="Private photo" />;
    const { rerender } = render(view()); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer token-a");
    context.session.ownerId = "owner-b"; context.session.generation += 1; rerender(view());
    await act(async () => resolve(new Response(new Blob(["old"]))));
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true); expect(createObjectURL).not.toHaveBeenCalled();
  });
});
