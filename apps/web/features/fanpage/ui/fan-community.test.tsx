import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CheerComments } from "./cheer-comments";
import { FanCommunity } from "./fan-community";
import { FanGatheringPanel } from "./fan-gathering";
let owner = "owner-a";
let authenticated = true;
const getAccessToken = vi.fn(async (): Promise<string | null> => "token");
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated, user: authenticated ? { id: owner } : null, getAccessToken }) }));
const empty = { total: 0, comments: [], nextCursor: null };
const comment = { id: "c7000000-0000-4000-8000-000000000001", body: "늘 응원해요", nickname: "별빛팬", avatarUrl: "/images/avatars/star-pink.webp", createdAt: "2026-09-11T00:00:00Z", isOwner: true };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { owner = "owner-a"; authenticated = true; getAccessToken.mockReset().mockResolvedValue("token"); vi.unstubAllGlobals(); });

it("reuses the idempotency key after a lost response and clears only a confirmed cheer", async () => {
  const posted: { body: string; idempotencyKey: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)));
      if (posted.length === 1) throw new Error("response lost after server commit");
      return Response.json({ comment });
    }
    return Response.json(empty);
  }));
  render(<CheerComments slug="elina" name="엘리나" locale="ko" />);
  const input = await screen.findByLabelText("응원 남기기");
  fireEvent.change(input, { target: { value: "늘 응원해요" } });
  fireEvent.click(screen.getByRole("button", { name: "응원 보내기" }));
  await screen.findByRole("alert");
  expect(input).toHaveValue("늘 응원해요");
  fireEvent.click(screen.getByRole("button", { name: "응원 보내기" }));
  await waitFor(() => expect(input).toHaveValue(""));
  expect(posted).toHaveLength(2); expect(posted[0]).toEqual(posted[1]);
  expect(Object.keys(posted[0]!)).toEqual(["body", "idempotencyKey"]);
});

it("drops an old owner's draft and pending token instead of posting under a switched account", async () => {
  const token = deferred<string>();
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(empty)); vi.stubGlobal("fetch", fetcher);
  const view = render(<CheerComments slug="elina" name="엘리나" locale="ko" />);
  await screen.findByText("첫 응원을 남겨 주세요.");
  fireEvent.change(screen.getByLabelText("응원 남기기"), { target: { value: "이전 계정 응원" } });
  getAccessToken.mockReturnValueOnce(token.promise); fireEvent.click(screen.getByRole("button", { name: "응원 보내기" }));
  owner = "owner-b"; view.rerender(<CheerComments slug="elina" name="엘리나" locale="ko" />);
  await act(async () => { token.resolve("owner-b-token"); });
  expect(screen.getByLabelText("응원 남기기")).toHaveValue("");
  expect(fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});

it("shows guest login returning to cheers without reply or reaction controls", async () => {
  authenticated = false; vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...empty, total: 1, comments: [{ ...comment, isOwner: false }] })));
  render(<CheerComments slug="elina" name="Elina" locale="en" />);
  await screen.findByText("늘 응원해요");
  expect(screen.getByRole("link", { name: "Sign in to leave a cheer" })).toHaveAttribute("href", "/login?locale=en&returnTo=%2Fc%2Felina%3Flocale%3Den%23cheers");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("offers owner deletion and reads the older page using the server cursor", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => init?.method === "DELETE" ? Response.json({ removed: true }) : Response.json(url.includes("cursor=") ? empty : { total: 6, comments: [comment], nextCursor: "older-token" }));
  vi.stubGlobal("fetch", fetcher);
  render(<CheerComments slug="elina" name="엘리나" locale="ko" />);
  fireEvent.click(await screen.findByRole("button", { name: "내 응원댓글 삭제" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => url === `/api/cheers/${comment.id}` && init?.method === "DELETE")).toBe(true));
  fireEvent.click(await screen.findByRole("button", { name: "이전 응원 보기" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes("cursor=older-token"))).toBe(true));
  expect(await screen.findByRole("button", { name: "최신 응원" })).toBeInTheDocument();
});

it("shows the same participants without a public-count label or visibility control", async () => {
  const fetcher = vi.fn(async () => Response.json({ likeCount: 7, fanCount: 8, publicFanCount: 8, fans: [{ nickname: "별빛팬", avatarUrl: comment.avatarUrl }] }));
  vi.stubGlobal("fetch", fetcher);
  render(<><FanCommunity slug="elina" locale="ko" /><FanGatheringPanel slug="elina" locale="ko" /></>);
  expect(await screen.findByRole("link", { name: "함께하는 팬 8명 보기" })).toHaveAttribute("href", "/c/elina?tab=leaderboard&locale=ko#celebrity-content");
  expect(await screen.findByRole("button", { name: "별빛팬" })).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByText(/프로필 공개/)).not.toBeInTheDocument();
  expect(fetcher.mock.calls.every(call => !String((call as unknown[])[0]).includes("visibility"))).toBe(true);
});
