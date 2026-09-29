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
    fireEvent.click(screen.getByRole("button", { name: "Translate" })); await screen.findByText(translation.translatedText);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Report" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Reason for reporting" }), { target: { value: "Private draft" } });
    context.session.generation += 1; rerender(view());
    expect(screen.queryByText(translation.translatedText)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Report" }));
    expect(screen.getByRole("textbox", { name: "Reason for reporting" })).toHaveValue("");
  });
  it("keeps blocking separate from reporting and restores focus after a report", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id })));
    render(<ContentActions targetType="fan_post" targetId={id} locale="en" />);
    const more = screen.getByRole("button", { name: "More" });
    fireEvent.click(more);
    expect(screen.getByRole("menuitem", { name: "Block author" }).closest("form")).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Report" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Reason for reporting" }), { target: { value: "Spam" } });
    fireEvent.submit(screen.getByRole("textbox", { name: "Reason for reporting" }).closest("form")!);
    await screen.findByText("Report submitted.");
    await waitFor(() => expect(more).toHaveFocus());
  });
  it("opens and closes the More menu from the keyboard without dispatching an action", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    render(<ContentActions targetType="fan_post" targetId={id} locale="en" />);
    const more = screen.getByRole("button", { name: "More" });

    fireEvent.keyDown(more, { key: "ArrowDown" });
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    await waitFor(() => expect(more).toHaveFocus());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not block after confirmation is cancelled", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); vi.stubGlobal("confirm", vi.fn(() => false));
    render(<ContentActions targetType="fan_post" targetId={id} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Block author" }));

    expect(window.confirm).toHaveBeenCalledWith("You will no longer see each other’s posts. Block this author?");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("cancels a report without dispatching and restores focus", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    render(<ContentActions targetType="fan_post" targetId={id} locale="en" />);
    const more = screen.getByRole("button", { name: "More" });
    fireEvent.click(more);
    fireEvent.click(screen.getByRole("menuitem", { name: "Report" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Reason for reporting" }), { target: { value: "Draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("textbox", { name: "Reason for reporting" })).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
    await waitFor(() => expect(more).toHaveFocus());
  });
  it("enters the report dialog from the keyboard and Escape restores the More trigger", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<ContentActions targetType="fan_post" targetId={id} locale="en" />);
    const more = screen.getByRole("button", { name: "More" });
    more.focus(); fireEvent.keyDown(more, { key: "ArrowDown" });
    const report = await screen.findByRole("menuitem", { name: "Report" });
    await waitFor(() => expect(report).toHaveFocus());
    fireEvent.keyDown(report, { key: "Enter" }); fireEvent.keyUp(report, { key: "Enter" });
    const reason = await screen.findByRole("textbox", { name: "Reason for reporting" });
    await waitFor(() => expect(reason).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(more).toHaveFocus());
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
