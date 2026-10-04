import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FanPostDetail } from "./fan-post-detail";
import { FanPostFeed } from "./fan-post-feed";

const state = vi.hoisted(() => ({
  authenticated: true,
  replace: vi.fn(),
  request: vi.fn(),
  returnTo: null as string | null,
  post: {} as Record<string, unknown>,
  comments: [] as Record<string, unknown>[],
  commentPages: {} as Record<string, { items: Record<string, unknown>[]; nextCursor: string | null }>,
  pages: {} as Record<string, { items: Record<string, unknown>[]; nextCursor: string | null }>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace }), useSearchParams: () => new URLSearchParams(state.returnTo ? { returnTo: state.returnTo } : {}) }));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: state.authenticated, user: { id: "viewer" }, getAccessToken: vi.fn(async () => "token") }),
}));
vi.mock("@/features/content-safety/ui/use-content-mutation", () => ({
  useContentMutation: () => ({ request: state.request, busy: false, error: "" }),
}));
vi.mock("@/features/content-safety/ui/content-actions", () => ({
  ContentActions: () => null,
  ContentTranslation: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/features/fanpage/ui/use-community-resource", () => ({
  useCommunityResource: (url: string) => {
    if (url.includes("/comments?")) {
      const cursor = new URL(url, "https://example.test").searchParams.get("cursor") ?? "first";
      return { state: { status: "ready", data: state.commentPages[cursor] ?? { items: state.comments, nextCursor: null } }, retry: vi.fn() };
    }
    if (url.startsWith("/api/posts/")) return { state: { status: "ready", data: state.post }, retry: vi.fn() };
    const cursor = new URL(url, "https://example.test").searchParams.get("cursor") ?? "first";
    return { state: { status: "ready", data: state.pages[cursor] }, retry: vi.fn() };
  },
}));

const post = (body: string, isOwner = false) => ({
  id: "10000000-0000-4000-8000-000000000001",
  celebritySlug: "artist",
  body,
  visibility: "public",
  revision: 1,
  author: { nickname: "Writer", avatarUrl: "/images/avatars/star-pink.webp" },
  assets: [],
  createdAt: "2026-09-26T00:00:00Z",
  updatedAt: "2026-09-26T00:00:00Z",
  isOwner,
  likeCount: 0,
  liked: false,
  commentCount: 0,
});

beforeEach(() => {
  state.authenticated = true;
  state.replace.mockReset();
  state.request.mockReset().mockResolvedValue({ ok: true });
  state.returnTo = null;
  state.post = post("Post body");
  state.comments = [];
  state.commentPages = {};
  state.pages = {};
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("fan post UI navigation and context", () => {
  it("uses a quiet visibility dialog and returns focus before cancelling the composer", async () => {
    state.pages = { first: { items: [], nextCursor: null } };
    render(<FanPostFeed slug="artist" locale="en" />);

    expect(screen.queryByRole("textbox", { name: "Write a post" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Write a post" }));
    expect(screen.getByRole("textbox", { name: "Write a post" })).toHaveFocus();
    const photoInput = screen.getByLabelText("Add photos") as HTMLInputElement;
    expect(photoInput).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: "Add photos" })).toHaveAccessibleDescription(/4/);
    const openPhotoChooser = vi.spyOn(photoInput, "click");
    fireEvent.click(screen.getByRole("button", { name: "Add photos" }));
    expect(openPhotoChooser).toHaveBeenCalledOnce();
    const visibility = screen.getByRole("button", { name: "Visibility: Public" });
    visibility.focus();
    fireEvent.click(visibility);
    expect(await screen.findByRole("dialog", { name: "Visibility" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(visibility).toHaveFocus());
    fireEvent.click(visibility);
    fireEvent.click(await screen.findByRole("radio", { name: "Passport members" }));
    expect(screen.queryByRole("dialog", { name: "Visibility" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visibility: Passport members" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No posts yet");
  });

  it("uses the shared bottom-sheet variant on mobile", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    state.pages = { first: { items: [], nextCursor: null } };
    render(<FanPostFeed slug="artist" locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Write a post" }));
    fireEvent.click(screen.getByRole("button", { name: "Visibility: Public" }));
    expect(await screen.findByRole("dialog", { name: "Visibility" })).toHaveAttribute("data-variant", "bottom-sheet");
  });

  it("preserves member-only visibility while editing", async () => {
    const memberPost = { ...post("Members only", true), visibility: "members" };
    state.pages = { first: { items: [memberPost], nextCursor: null } };
    render(<FanPostFeed slug="artist" locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Visibility: Passport members" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Edit" }), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(state.request).toHaveBeenCalledWith(
      `/api/posts/${memberPost.id}`,
      "PATCH",
      expect.objectContaining({ body: "Updated", visibility: "members" }),
    ));
  });

  it("preserves the creator-local return path through details and deletion", async () => {
    state.post = post("Owned post", true);
    state.returnTo = "/artist?tab=community&locale=en#celebrity-content";
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<FanPostDetail postId={state.post.id as string} locale="en" />);

    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", state.returnTo);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith(state.returnTo));
  });

  it("shows a filled active heart immediately and rolls it back when the API fails", async () => {
    let finish: (value: null) => void = () => undefined;
    state.request.mockReturnValue(new Promise<null>(resolve => { finish = resolve; }));
    state.pages = { first: { items: [post("Like me")], nextCursor: null } };
    render(<FanPostFeed slug="artist" locale="en" />);

    const like = screen.getByRole("button", { name: "Like 0" });
    fireEvent.click(like);
    expect(like).toHaveAttribute("aria-pressed", "true");
    expect(like).toHaveTextContent("Like 1");
    expect(like.querySelector("svg")).toHaveAttribute("fill", "currentColor");
    finish(null);
    await waitFor(() => expect(like).toHaveAttribute("aria-pressed", "false"));
    expect(like).toHaveTextContent("Like 0");
  });

  it("returns to the community after deleting the detailed post", async () => {
    state.post = post("Owned post", true);
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<FanPostDetail postId={state.post.id as string} locale="en" />);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    await waitFor(() => expect(state.replace).toHaveBeenCalledWith("/community?creator=artist&tab=posts&locale=en"));
    expect(state.request).toHaveBeenCalledWith(`/api/posts/${state.post.id}`, "DELETE");
  });

  it("describes the reply target and restores focus when reply is cancelled", async () => {
    state.comments = [{
      id: "20000000-0000-4000-8000-000000000002",
      postId: state.post.id,
      parentId: null,
      body: "A comment that identifies the exact reply target",
      revision: 1,
      author: { nickname: "Alex", avatarUrl: "/images/avatars/heart-pink.webp" },
      createdAt: "2026-09-26T01:00:00Z",
      isOwner: false,
    }];
    render(<FanPostDetail postId={state.post.id as string} locale="en" />);
    const reply = screen.getByRole("button", { name: "Reply" });

    fireEvent.click(reply);

    const textarea = screen.getByRole("textbox", { name: "Write a comment" });
    const description = document.getElementById(textarea.getAttribute("aria-describedby")!);
    expect(description).toHaveTextContent("Alex");
    expect(description).toHaveTextContent("A comment that identifies the exact reply target");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(reply).toHaveFocus());
  });

  it("keeps the reply target visible while comments move to another page", () => {
    const comment = {
      id: "20000000-0000-4000-8000-000000000002",
      postId: state.post.id,
      parentId: null,
      body: "A comment that stays the reply target across pages",
      revision: 1,
      author: { nickname: "Alex", avatarUrl: "/images/avatars/heart-pink.webp" },
      createdAt: "2026-09-26T01:00:00Z",
      isOwner: false,
    };
    state.commentPages = {
      first: { items: [comment], nextCursor: "page-2" },
      "page-2": { items: [], nextCursor: null },
    };
    render(<FanPostDetail postId={state.post.id as string} locale="en" />);

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(screen.getByText(/Writing a reply/)).toHaveTextContent("Alex");
    fireEvent.click(screen.getByRole("button", { name: "Older posts" }));

    expect(screen.getByText(/Writing a reply/)).toHaveTextContent("Alex");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("returns from the third feed page to the immediately newer page", () => {
    state.authenticated = false;
    state.pages = {
      first: { items: [post("Page one")], nextCursor: "page-2" },
      "page-2": { items: [post("Page two")], nextCursor: "page-3" },
      "page-3": { items: [post("Page three")], nextCursor: null },
    };
    render(<FanPostFeed slug="artist" locale="en" />);

    fireEvent.click(screen.getByRole("button", { name: "Older posts" }));
    expect(screen.getByText("Page two")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Older posts" }));
    expect(screen.getByText("Page three")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Newer posts" }));
    expect(screen.getByText("Page two")).toBeInTheDocument();
  });
});
