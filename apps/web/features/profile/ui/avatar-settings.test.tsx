import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Avatar } from "../domain/avatar";
import { AvatarSettings } from "./avatar-settings";

const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./load-avatar-editor", () => ({ loadAvatarEditor: load }));
const avatar: Avatar = { initialCharacterId: "star-cream", characterId: "star-cream", source: "character", hasImage: false, revision: 0 };
const resource = (ownerId = "owner-a") => ({ state: { status: "ready" as const, avatar, imageUrl: null }, refresh: vi.fn(), ownerId, getAccessToken: vi.fn(async () => "token") });
const editor = { AvatarEditor: ({ onClose }: { onClose(): void }) => <div role="dialog"><button onClick={onClose}>Close</button></div> };
afterEach(() => { cleanup(); load.mockReset(); });

it("does not load editing code until requested and permits retry after a chunk failure", async () => {
  load.mockRejectedValueOnce(new Error("chunk offline")).mockResolvedValueOnce(editor);
  render(<AvatarSettings locale="ko" resource={resource()} />);
  expect(load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "변경" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("프로필 이미지를 불러오지 못했어요.");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "변경" })).toHaveFocus());
});

it("does not open a previous owner's pending editor when the chunk finishes", async () => {
  let resolve!: (value: typeof editor) => void;
  load.mockReturnValue(new Promise((done) => { resolve = done; }));
  const view = render(<AvatarSettings locale="en" resource={resource()} />);
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  expect(screen.getByRole("status")).toHaveTextContent("Loading profile image");
  view.rerender(<AvatarSettings locale="en" resource={resource("owner-b")} />);
  await act(async () => { resolve(editor); });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
