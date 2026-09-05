import { render,screen,fireEvent } from "@testing-library/react";
import { beforeEach,it,expect,vi } from "vitest";
import { LiveMissionScreen } from "./live-mission-screen";
let authenticated=true;
const getAccessToken=vi.fn(async()=>"token");
vi.mock("@privy-io/react-auth",()=>({usePrivy:()=>({ready:true,authenticated,getAccessToken,login:vi.fn()})}));
beforeEach(()=>{authenticated=true;vi.unstubAllGlobals();});
it("keeps a locale-preserving return route for guests without showing a raw slug",()=>{
 authenticated=false;vi.stubGlobal("fetch",vi.fn(async()=>new Response(null,{status:404})));
 render(<LiveMissionScreen slug="test-live" locale="ko"/>);
 expect(screen.getByRole("link",{name:"LIVE로 돌아가기"})).toHaveAttribute("href","/live/test-live?locale=ko");
 expect(screen.queryByText("LIVE · test-live")).not.toBeInTheDocument();
});
it("distinguishes failed load from empty and retries without submitting",async()=>{
 let failed=true;
 const fetcher=vi.fn(async(url:string)=>url.includes("/missions?") ? (failed?new Response(null,{status:500}):Response.json([])) : new Response(null,{status:404}));
 vi.stubGlobal("fetch",fetcher);
 render(<LiveMissionScreen slug="test-live" locale="ko"/>);
 expect(await screen.findByText("미션을 불러오지 못했어요.")).toBeInTheDocument();
 expect(screen.queryByText("지금 참여할 수 있는 미션이 없어요.")).not.toBeInTheDocument();
 failed=false;fireEvent.click(screen.getByRole("button",{name:"다시 시도"}));
 expect(await screen.findByText("지금 참여할 수 있는 미션이 없어요.")).toBeInTheDocument();
 expect(fetcher.mock.calls.every(([url])=>!url.includes("/submit"))).toBe(true);
});
