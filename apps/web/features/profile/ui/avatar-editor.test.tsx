import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Avatar } from "../domain/avatar";
import { AvatarEditor, AvatarSettings, cropFromView, validateAvatarFile } from "./avatar-editor";

const metadata: Avatar = {
  initialCharacterId: "star-cream",
  characterId: "heart-pink",
  source: "upload",
  hasImage: true,
  revision: 7,
};

function resource() {
  return {
    state: { status: "ready" as const, avatar: metadata, imageUrl: "blob:current" },
    refresh: vi.fn(),
    ownerId: "owner-a",
    getAccessToken: vi.fn(async () => "token" as string | null),
  };
}

beforeEach(() => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:draft");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.stubGlobal("Image", class {
    src = "";
    naturalWidth = 1200;
    naturalHeight = 800;
    decode = vi.fn(async () => undefined);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("avatar editor", () => {
  it("validates uploads and expresses a normalized crop on the EXIF-oriented dimensions", () => {
    expect(validateAvatarFile(new File(["x"], "avatar.gif", { type: "image/gif" }))).toBe("type");
    expect(validateAvatarFile(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }))).toBe("size");
    expect(validateAvatarFile(new File(["x"], "avatar.webp", { type: "image/webp" }))).toBeNull();
    expect(cropFromView({ width: 1200, height: 800 }, { x: 0, y: 0 }, 2)).toEqual({ x: 1 / 3, y: 0.25, size: 0.5 });
  });

  it("chooses a character with an explicit PATCH save", async () => {
    const avatarResource = resource();
    const close = vi.fn();
    const fetcher = vi.fn(async () => Response.json({ avatar: { ...metadata, characterId: "fairy-lavender", source: "character", hasImage: false, revision: 8 } }));
    vi.stubGlobal("fetch", fetcher);
    render(<AvatarEditor locale="ko" resource={avatarResource} avatar={metadata} imageUrl="blob:current" onClose={close} />);

    fireEvent.click(screen.getByRole("button", { name: "라벤더 요정" }));
    expect(screen.getByRole("img", { name: "프로필 이미지" })).toHaveAttribute("src", "/images/avatars/fairy-lavender.webp");
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/me/avatar", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ characterId: "fairy-lavender", expectedRevision: 7 }),
    })));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps the selected upload and crop available after failure, then retries", async () => {
    const avatarResource = resource();
    const close = vi.fn();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(Response.json({ avatar: { ...metadata, revision: 8 } }));
    vi.stubGlobal("fetch", fetcher);
    render(<AvatarEditor locale="ko" resource={avatarResource} avatar={metadata} imageUrl="blob:current" onClose={close} />);

    const file = new File(["photo"], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("다른 사진 선택"), { target: { files: [file] } });
    expect(await screen.findByRole("img", { name: "조정할 프로필 사진" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "확대" }), { target: { value: "1.5" } });
    fireEvent.keyDown(screen.getByRole("img", { name: "조정할 프로필 사진" }), { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("저장하지 못했어요. 선택한 내용을 유지했으니 다시 시도해 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "조정할 프로필 사진" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const form = fetcher.mock.calls[1][1].body as FormData;
    expect(form.get("file")).toBe(file);
    expect(JSON.parse(String(form.get("crop"))).size).toBeCloseTo(2 / 3);
    expect(form.get("expectedRevision")).toBe("7");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("refreshes on a stale write while preserving the draft and only offers delete for a stored photo", async () => {
    const avatarResource = resource();
    const fetcher = vi.fn(async () => new Response(null, { status: 409 }));
    vi.stubGlobal("fetch", fetcher);
    render(<AvatarEditor locale="ko" resource={avatarResource} avatar={metadata} imageUrl="blob:current" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "사진 삭제" }));
    expect(await screen.findByText("다른 곳에서 프로필 이미지가 변경됐어요. 최신 상태를 확인한 뒤 다시 저장해 주세요.")).toBeInTheDocument();
    expect(avatarResource.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith("/api/me/avatar", expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ expectedRevision: 7 }),
    }));
  });

  it("does not offer photo removal when the saved avatar is already a character", () => {
    const characterAvatar: Avatar = { ...metadata, source: "character", hasImage: false };
    render(<AvatarEditor locale="ko" resource={{ ...resource(), state: { status: "ready", avatar: characterAvatar, imageUrl: null } }} avatar={characterAvatar} imageUrl={null} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "사진 삭제" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("does not send the previous owner's draft when the account changes while access token resolution is pending", async () => {
    let resolveToken!: (token: string | null) => void;
    const delayedToken = new Promise<string | null>((resolve) => { resolveToken = resolve; });
    const ownerAResource = { ...resource(), getAccessToken: vi.fn(() => delayedToken) };
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const view = render(<AvatarEditor locale="ko" resource={ownerAResource} avatar={metadata} imageUrl="blob:current" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "라벤더 요정" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(ownerAResource.getAccessToken).toHaveBeenCalledTimes(1);

    view.rerender(<AvatarEditor
      locale="ko"
      resource={{ ...ownerAResource, ownerId: "owner-b", getAccessToken: vi.fn(async () => "owner-b-token") }}
      avatar={metadata}
      imageUrl="blob:current"
      onClose={vi.fn()}
    />);
    await act(async () => { resolveToken("owner-b-token"); await Promise.resolve(); });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("still permits a current-owner save after StrictMode replays effect setup and cleanup", async () => {
    const avatarResource = resource();
    const fetcher = vi.fn(async () => Response.json({ avatar: { ...metadata, characterId: "star-pink", source: "character", hasImage: false, revision: 8 } }));
    vi.stubGlobal("fetch", fetcher);
    render(<StrictMode><AvatarEditor locale="ko" resource={avatarResource} avatar={metadata} imageUrl="blob:current" onClose={vi.fn()} /></StrictMode>);

    fireEvent.click(screen.getByRole("button", { name: "핑크 별" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  });

  it("ignores and revokes an older file decode when a newer choice finishes first", async () => {
    const decoders: Array<{ resolve: () => void }> = [];
    vi.mocked(URL.createObjectURL).mockReset().mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    vi.stubGlobal("Image", class {
      src = "";
      naturalWidth = 1200;
      naturalHeight = 800;
      decode() {
        return new Promise<void>((resolve) => { decoders.push({ resolve }); });
      }
    });
    render(<AvatarEditor locale="ko" resource={resource()} avatar={metadata} imageUrl="blob:current" onClose={vi.fn()} />);
    const input = screen.getByLabelText("다른 사진 선택");
    fireEvent.change(input, { target: { files: [new File(["first"], "first.jpg", { type: "image/jpeg" })] } });
    fireEvent.change(input, { target: { files: [new File(["second"], "second.jpg", { type: "image/jpeg" })] } });

    await act(async () => { decoders[1].resolve(); await Promise.resolve(); });
    expect(screen.getByRole("img", { name: "조정할 프로필 사진" }).querySelector("img")).toHaveAttribute("src", "blob:second");
    await act(async () => { decoders[0].resolve(); await Promise.resolve(); });
    expect(screen.getByRole("img", { name: "조정할 프로필 사진" }).querySelector("img")).toHaveAttribute("src", "blob:second");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:first");
  });

  it("keeps the dialog and character draft when a 409 refresh falls into an error state", async () => {
    const avatarResource = resource();
    const fetcher = vi.fn(async () => new Response(null, { status: 409 }));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<AvatarSettings locale="ko" resource={avatarResource} />);

    fireEvent.click(screen.getByRole("button", { name: "변경" }));
    fireEvent.click(screen.getByRole("button", { name: "라벤더 요정" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("다른 곳에서 프로필 이미지가 변경됐어요. 최신 상태를 확인한 뒤 다시 저장해 주세요.");
    expect(avatarResource.refresh).toHaveBeenCalledTimes(1);

    view.rerender(<AvatarSettings locale="ko" resource={{ ...avatarResource, state: { status: "error" } }} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "라벤더 요정" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("최신 상태를 불러오지 못했어요. 연결을 확인하고 다시 불러와 주세요.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "최신 상태 다시 불러오기" }));
    expect(avatarResource.refresh).toHaveBeenCalledTimes(2);
  });
});
