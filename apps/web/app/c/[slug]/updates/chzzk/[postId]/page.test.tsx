import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHZZK_CHANNEL_URL } from "@/features/fanpage/domain/chzzk-posts";
const mocks=vi.hoisted(()=>({find:vi.fn(),read:vi.fn()}));
vi.mock("@/server/content/published-content-repository",()=>({createPublishedContentRepositoryFromEnvironment:()=>({findBySlug:mocks.find})}));
vi.mock("@/server/chzzk/community",()=>({readChzzkPost:mocks.read}));
vi.mock("next/navigation",()=>({notFound:()=>{throw Error("NOT_FOUND");}}));
vi.mock("@/components/fan-shell/fan-app-shell",()=>({FanAppFrame:({children}:{children:React.ReactNode})=><div>{children}</div>,FanContentContainer:({children}:{children:React.ReactNode})=><main>{children}</main>}));
import Page from "./page";
const props=(slug="jenny-jeong",postId="123")=>({params:Promise.resolve({slug,postId}),searchParams:Promise.resolve({locale:"ko"})});
afterEach(()=>{cleanup();vi.resetAllMocks();});
describe("CHZZK detail page",()=>{
 it("gates unknown creators, invalid IDs and revoked channels before reading posts",async()=>{
  await expect(Page(props("other"))).rejects.toThrow("NOT_FOUND");
  await expect(Page(props("jenny-jeong","bad"))).rejects.toThrow("NOT_FOUND");
  mocks.find.mockResolvedValue({socialLinks:[]});
  await expect(Page(props())).rejects.toThrow("NOT_FOUND");
  expect(mocks.read).not.toHaveBeenCalled();
 });
 it("renders the public detail with a list return link",async()=>{
  mocks.find.mockResolvedValue({name:"정제니",socialLinks:[{platform:"chzzk",url:CHZZK_CHANNEL_URL}]});
  mocks.read.mockResolvedValue({id:"123",text:"방송 일정\n오늘 만나요",date:"2026-09-10",images:[]});
  render(await Page(props()));
  expect(screen.getByRole("heading",{name:"방송 일정"})).toBeInTheDocument();
  expect(screen.getByText(/오늘 만나요/)).toBeInTheDocument();
  expect(screen.getByRole("link",{name:"소식 목록"})).toHaveAttribute("href","/jenny-jeong?tab=notice&locale=ko#celebrity-content");
 });
 it("shows an upstream failure separately from an unavailable post",async()=>{
  mocks.find.mockResolvedValue({name:"정제니",socialLinks:[{platform:"chzzk",url:CHZZK_CHANNEL_URL}]});
  mocks.read.mockResolvedValueOnce(null).mockRejectedValueOnce(Error());
  await expect(Page(props())).rejects.toThrow("NOT_FOUND");
  render(await Page(props()));
  expect(screen.getByRole("heading",{name:"소식을 불러오지 못했어요"})).toBeInTheDocument();
 });
});
