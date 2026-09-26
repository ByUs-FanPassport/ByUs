import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreatorNews, ChzzkPostBody } from "./chzzk-posts";
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: false, user: null, getAccessToken: async () => null }) }));
vi.mock("@/components/byus-session-provider", () => ({ useByUsSession: () => ({ ready: true, ownerId: null, generation: 0 }) }));
const items = Array.from({ length: 5 }, (_, index) => ({ id: String(index + 1), text: index === 0 ? "<script>alert(1)</script>\n방송 일정" : `소식 ${index}`, date: `2026-09-${String(15-index).padStart(2,"0")}`, images: index === 0 ? [{ url: "https://nng-phinf.pstatic.net/schedule.jpg" }] : [] }));
const notice = {slug:"important",title:"중요 공지",pinned:true,kind:"standard",publishedAt:"2026-08-01"};
const response = (data: unknown) => new Response(JSON.stringify(data));
const normalFetch = (url: string) => Promise.resolve(response(url.includes("/chzzk") ? {items} : {notices:[notice]}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("creator news", () => {
  it("keeps a filtered home preview discoverable when matching updates are on the next page", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(response(url.includes("cursor=")
      ? { notices: [{ ...notice, slug: "artist-news", title: "아티스트의 새 소식", postType: "artist_post" }], nextCursor: null }
      : { notices: [{ ...notice, postType: "notice" }], nextCursor: "page-two" }))));
    render(<CreatorNews slug="elina" locale="ko" initialFilter="artist_post" />);
    await screen.findByText("더 보기를 눌러 이 분류의 소식을 확인해 보세요.");
    expect(screen.queryByText("아직 공개된 소식이 없어요.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
    expect(await screen.findByText("아티스트의 새 소식")).toBeInTheDocument();
  });
  it("merges a pinned notice with two latest compact posts and links to internal details", async () => {
    vi.stubGlobal("fetch",vi.fn(normalFetch));
    const {container}=render(<CreatorNews channelId="0a3f97086cb81d3360c69fdf5d020045" slug="jenny-jeong" locale="ko" />);
    await screen.findByText("중요 공지");
    await waitFor(()=>expect(container.querySelectorAll("li")).toHaveLength(3));
    expect(container.querySelector("li")).toHaveTextContent("중요 공지");
    expect(screen.getByRole("link",{name:/alert/})).toHaveAttribute("href","/c/jenny-jeong/updates/chzzk/1?locale=ko");
    expect(container.querySelector("script")).toBeNull();
    expect(screen.queryByText("방송 일정")).not.toBeInTheDocument();
    expect(screen.getByRole("link",{name:"전체 보기"})).toHaveAttribute("href","/jenny-jeong?tab=notice&locale=ko#celebrity-content");
  });
  it("filters before applying the home limit and carries the category into View all", async () => {
    vi.stubGlobal("fetch",vi.fn(normalFetch));
    const {container}=render(<CreatorNews channelId="0a3f97086cb81d3360c69fdf5d020045" slug="jenny-jeong" locale="ko" />);
    await screen.findByText("중요 공지");
    fireEvent.click(screen.getByRole("button",{name:"치지직"}));
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(screen.queryByText("중요 공지")).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"치지직"})).toHaveAttribute("aria-pressed","true");
    expect(screen.getByRole("link",{name:"전체 보기"})).toHaveAttribute("href","/jenny-jeong?tab=notice&locale=ko&news=chzzk#celebrity-content");
    fireEvent.click(screen.getByRole("button",{name:"공지"}));
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(screen.getByText("중요 공지")).toBeInTheDocument();
  });
  it("initializes the full view from the selected category and ignores failures in other sources",async()=>{
    vi.stubGlobal("fetch",vi.fn((url:string)=>url.includes("/chzzk")?Promise.reject(Error()):normalFetch(url)));
    render(<CreatorNews channelId="0a3f97086cb81d3360c69fdf5d020045" slug="jenny-jeong" locale="en" full initialFilter="notice" />);
    await screen.findByText("중요 공지");
    expect(screen.getByRole("button",{name:"Notices"})).toHaveAttribute("aria-pressed","true");
    expect(screen.queryByRole("button",{name:"Retry"})).not.toBeInTheDocument();
    expect(screen.queryByRole("link",{name:/CHZZK community/})).not.toBeInTheDocument();
  });
  it("loads real next cursors, deduplicates pages, retains rows on failure and stops at the end",async()=>{
    let fail=true;
    const fetcher=vi.fn((url:string)=>{
      if(url.includes("/notices"))return Promise.resolve(response({notices:[],nextCursor:null}));
      if(url.includes("cursor=10"))return fail?Promise.reject(Error()):Promise.resolve(response({items:[items[0],{...items[1]!,id:"99",text:"다음 페이지 글"}],nextCursor:null}));
      return Promise.resolve(response({items,nextCursor:"10"}));
    });
    vi.stubGlobal("fetch",fetcher);
    const {container}=render(<CreatorNews channelId="0a3f97086cb81d3360c69fdf5d020045" slug="jenny-jeong" locale="ko" full initialFilter="chzzk" />);
    await screen.findByRole("button",{name:"더 보기"});
    fireEvent.click(screen.getByRole("button",{name:"더 보기"}));
    await screen.findByText(/다음 소식을 불러오지 못했어요/);
    expect(container.querySelectorAll("li")).toHaveLength(5);
    fail=false;fireEvent.click(screen.getByRole("button",{name:"더 보기"}));
    await screen.findByText("다음 페이지 글");
    expect(container.querySelectorAll("li")).toHaveLength(6);
    expect(screen.queryByRole("button",{name:"더 보기"})).not.toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([url])=>url.includes("cursor=10"))).toHaveLength(2);
  });
  it("paginates notices for a creator without CHZZK, with no CHZZK request or filter",async()=>{
    const fetcher=vi.fn((url:string)=>Promise.resolve(response(url.includes("cursor=next")?{notices:[{...notice,slug:"second",title:"두 번째 공지"}],nextCursor:null}:{notices:[notice],nextCursor:"next"})));
    vi.stubGlobal("fetch",fetcher);
    render(<CreatorNews slug="kara" locale="ko" full />);
    await screen.findByText("중요 공지");
    expect(screen.getByRole("button",{name:"아티스트 소식"})).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"치지직"})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"더 보기"}));
    await screen.findByText("두 번째 공지");
    expect(fetcher.mock.calls.every(([url])=>url.includes("/notices"))).toBe(true);
  });
  it("shows the full combined list",async()=>{
    vi.stubGlobal("fetch",vi.fn(normalFetch));
    const {container}=render(<CreatorNews channelId="0a3f97086cb81d3360c69fdf5d020045" slug="jenny-jeong" locale="en" full />);
    await waitFor(()=>expect(container.querySelectorAll("li")).toHaveLength(6));
    expect(screen.queryByRole("link",{name:"View all"})).not.toBeInTheDocument();
  });
  it("retains notices during CHZZK failure and retries only the failed source", async()=>{
    let fail=true;
    const fetcher=vi.fn((url:string)=>url.includes("/chzzk")&&fail?Promise.reject(Error()):normalFetch(url));
    vi.stubGlobal("fetch",fetcher);
    render(<CreatorNews channelId="0a3f97086cb81d3360c69fdf5d020045" slug="jenny-jeong" locale="en" />);
    expect(await screen.findByText("Some updates couldn't be loaded.")).toBeInTheDocument();
    expect(screen.getByText("중요 공지")).toBeInTheDocument();
    fail=false;fireEvent.click(screen.getByRole("button",{name:"Retry"}));
    await screen.findByText(/alert/);
    expect(fetcher.mock.calls.filter(([url])=>url.includes("/notices"))).toHaveLength(1);
  });
  it("does not render late posts from a previous creator",async()=>{
    let resolve!: (value:Response)=>void;
    vi.stubGlobal("fetch",vi.fn((url:string)=>url.includes("previous/chzzk")?new Promise<Response>(done=>{resolve=done;}):Promise.resolve(response(url.includes("/chzzk")?{items:[]}:{notices:[]}))));
    const {rerender}=render(<CreatorNews channelId="0a3f97086cb81d3360c69fdf5d020045" slug="previous" locale="ko" />);
    await waitFor(() => expect(resolve).toBeTypeOf("function"));
    rerender(<CreatorNews channelId="0a3f97086cb81d3360c69fdf5d020045" slug="jenny-jeong" locale="ko" />);
    await screen.findByText("아직 공개된 소식이 없어요.");
    await act(async()=>resolve(response({items})));
    expect(screen.queryByText(/alert/)).not.toBeInTheDocument();
  });
  it("preserves full text and source when a detail image fails",()=>{
    render(<ChzzkPostBody post={items[0]!} name="정제니" locale="ko" />);
    fireEvent.error(screen.getByRole("img",{name:/게시글 이미지/}));
    expect(screen.getByText(/이미지를 불러오지 못했어요/)).toBeInTheDocument();
    expect(screen.getByText(/방송 일정/)).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"치지직 원문 커뮤니티, 새 창"})).toHaveAttribute("target","_blank");
  });
});

describe("multi-page news",()=>{
 it("loads 25 CHZZK posts across three pages while avoiding duplicate requests",async()=>{
  const all=Array.from({length:25},(_,i)=>({id:String(i+1),text:`기록 ${i+1}`,date:"2026-09-01",images:[]}));
  const fetcher=vi.fn((url:string)=>{
   if(url.includes("/notices"))return Promise.resolve(response({notices:[]}));
   const offset=Number(new URL(url,"http://localhost").searchParams.get("cursor")??0);
   return Promise.resolve(response({items:all.slice(offset,offset+10),nextCursor:offset+10<all.length?String(offset+10):null}));
  });
  vi.stubGlobal("fetch",fetcher);
  const {container}=render(<CreatorNews channelId="0a3f97086cb81d3360c69fdf5d020045" slug="jenny-jeong" locale="ko" full initialFilter="chzzk" />);
  await waitFor(()=>expect(container.querySelectorAll("li")).toHaveLength(10));
  const more=screen.getByRole("button",{name:"더 보기"});fireEvent.click(more);fireEvent.click(more);
  await waitFor(()=>expect(container.querySelectorAll("li")).toHaveLength(20));
  fireEvent.click(screen.getByRole("button",{name:"더 보기"}));
  await waitFor(()=>expect(container.querySelectorAll("li")).toHaveLength(25));
  expect(screen.queryByRole("button",{name:"더 보기"})).not.toBeInTheDocument();
  expect(fetcher.mock.calls.filter(([url])=>url.includes("/chzzk"))).toHaveLength(3);
 });
});
