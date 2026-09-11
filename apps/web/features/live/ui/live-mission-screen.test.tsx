import { act,render,screen,fireEvent,waitFor } from "@testing-library/react";
import { beforeEach,it,expect,vi } from "vitest";
import { LiveMissionScreen } from "./live-mission-screen";
let authenticated=true;
let owner="owner-a";
const getAccessToken=vi.fn(async()=>"token");
vi.mock("@privy-io/react-auth",()=>({usePrivy:()=>({ready:true,authenticated,user:{id:owner},getAccessToken,login:vi.fn()})}));
beforeEach(()=>{authenticated=true;owner="owner-a";getAccessToken.mockReset().mockResolvedValue("token");vi.unstubAllGlobals();});
it("keeps a locale-preserving return route for guests without showing a raw slug",()=>{
 authenticated=false;vi.stubGlobal("fetch",vi.fn(async()=>new Response(null,{status:404})));
 render(<LiveMissionScreen slug="test-live" locale="ko"/>);
 expect(screen.getByRole("link",{name:"LIVE로 돌아가기"})).toHaveAttribute("href","/live/test-live?locale=ko");
 expect(screen.getByRole("link",{name:"본문으로 바로가기"})).toHaveAttribute("href","#live-mission-main");
 expect(screen.getByRole("main")).toHaveAttribute("id","live-mission-main");
 expect(screen.getByRole("link",{name:"KO / EN"})).toHaveAttribute("href","/live/test-live/missions?locale=en");
 expect(screen.queryByText("LIVE · test-live")).not.toBeInTheDocument();
});
const mission={id:"10000000-0000-4000-8000-000000000001",type:"quiz",version:1,title:"LIVE 퀴즈",description:"오늘의 질문",attendanceRequired:true,completed:false,visibleFrom:"2026-09-10T00:00:00Z",visibleUntil:"2026-09-11T00:00:00Z",questions:[{id:"20000000-0000-4000-8000-000000000001",text:"오늘의 색상은?",media:null,options:[{id:"30000000-0000-4000-8000-000000000001",label:"분홍",displayMode:"text",media:null},{id:"30000000-0000-4000-8000-000000000002",label:"파랑",displayMode:"text",media:null}]}]};
const completion={mission:{id:mission.id,type:"quiz",completed:true,correctness:true,scorePoints:1,ticketAmount:1,stamp:{id:"40000000-0000-4000-8000-000000000001",businessStatus:"recorded",mintStatus:"queued"}}};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
async function readyMission(){const view=render(<LiveMissionScreen slug="test-live" locale="ko"/>);fireEvent.click(await screen.findByRole("radio",{name:"분홍"}));return view;}
it("guards token and POST waits, locks answers and confirms completion without another GET",async()=>{
 const token=deferred<string>();const post=deferred<Response>();
 const fetcher=vi.fn((url:string,init?:RequestInit)=>init?.method==="POST"?post.promise:Promise.resolve(url.includes("/missions?")?Response.json([mission]):new Response(null,{status:404})));
 vi.stubGlobal("fetch",fetcher);await readyMission();getAccessToken.mockReturnValueOnce(token.promise);
 const button=screen.getByRole("button",{name:"미션 완료"});fireEvent.click(button);fireEvent.click(button);
 expect(screen.getByRole("button",{name:"제출 중…"})).toBeDisabled();expect(screen.getByRole("radio",{name:"파랑"})).toBeDisabled();
 expect(fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
 await act(async()=>{token.resolve("token");});await waitFor(()=>expect(fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1));
 await act(async()=>{post.resolve(Response.json(completion));});
 expect(screen.getByRole("button",{name:"완료됨"})).toBeDisabled();expect(screen.getByRole("status")).toHaveTextContent("미션을 완료했어요");
});
it("reuses uncertain request keys for identical answers and replaces keys after changing answers",async()=>{
 const bodies: Array<{idempotencyKey:string}>=[];
 vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{if(init?.method==="POST"){bodies.push(JSON.parse(String(init.body)));throw new Error("offline");}return url.includes("/missions?")?Response.json([mission]):new Response(null,{status:404});}));
 await readyMission();fireEvent.click(screen.getByRole("button",{name:"미션 완료"}));await screen.findByRole("alert");
 fireEvent.click(screen.getByRole("button",{name:"미션 완료"}));await waitFor(()=>expect(bodies).toHaveLength(2));await waitFor(()=>expect(screen.getByRole("button",{name:"미션 완료"})).toBeEnabled());
 expect(bodies[0].idempotencyKey).toBe(bodies[1].idempotencyKey);
 fireEvent.click(screen.getByRole("radio",{name:"파랑"}));fireEvent.click(screen.getByRole("button",{name:"미션 완료"}));await waitFor(()=>expect(bodies).toHaveLength(3));
 expect(bodies[2].idempotencyKey).not.toBe(bodies[1].idempotencyKey);
});
it("does not submit an old owner's answers with the next owner's token",async()=>{
 const token=deferred<string>();const fetcher=vi.fn(async(url:string,_init?:RequestInit)=>url.includes("/missions?")?Response.json([mission]):new Response(null,{status:404}));
 vi.stubGlobal("fetch",fetcher);const view=await readyMission();getAccessToken.mockReturnValueOnce(token.promise);fireEvent.click(screen.getByRole("button",{name:"미션 완료"}));
 owner="owner-b";view.rerender(<LiveMissionScreen slug="test-live" locale="ko"/>);await screen.findByRole("radio",{name:"분홍"});
 await act(async()=>{token.resolve("owner-b-token");});
 expect(fetcher.mock.calls.every(([,init])=>init?.method!=="POST")).toBe(true);expect(screen.getByRole("radio",{name:"분홍"})).not.toBeChecked();
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
