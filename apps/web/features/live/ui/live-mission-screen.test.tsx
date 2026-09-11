import { act,render,screen,fireEvent,waitFor } from "@testing-library/react";
import { beforeEach,it,expect,vi } from "vitest";
import { LiveMissionScreen } from "./live-mission-screen";
import { elinaLiveSlug } from "../domain/elina-event";
import { supportsArtMissionPlay } from "./art-mission-play";
import { liveMissionListSchema } from "../domain/live-mission";
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

const optionId = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const artQuiz = {
 ...mission, attendanceRequired: false,
 description: "그림을 살펴보세요. 작품 이미지: Banksy Exhibition Culture Co., Ltd. 제공.",
 questions: [{ ...mission.questions[0], text: "그림 속 빨간 풍선은 어떤 모양인가요?", media: { type: "image", url: "https://example.com/balloon.webp" },
  options: ["하트", "별", "동그라미", "꽃"].map((label, index) => ({ id: optionId(index + 1), label, displayMode: "text", media: null })) }],
};
const artVote = {
 ...mission, id: "10000000-0000-4000-8000-000000000002", type: "vote", attendanceRequired: false,
 description: "세 작품을 골라보세요. 작품 이미지: Banksy Exhibition Culture Co., Ltd. 제공.",
 questions: [{ id: "20000000-0000-4000-8000-000000000002", text: "가장 눈길이 가는 뱅크시 작품은 무엇인가요?", media: null,
  options: ["풍선을 든 소녀", "플라잉 코퍼", "러브 랫"].map((label, index) => ({ id: optionId(index + 5), label, displayMode: "text_media", media: { type: "image", url: `https://example.com/art-${index}.webp` } })) }],
};

function mockArtFetch(list = [artVote, artQuiz], post = async (id: string) => Response.json({ mission: { ...completion.mission, id, type: id === artVote.id ? "vote" : "quiz", correctness: id === artVote.id ? null : true } })) {
 const fetcher = vi.fn(async (url: string, init?: RequestInit) => init?.method === "POST" ? post(url.split("/")[3]) : url.includes("/missions?") ? Response.json(list) : new Response(null, { status: 404 }));
 vi.stubGlobal("fetch", fetcher);
 Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: vi.fn(), configurable: true });
 return fetcher;
}

it("runs the image vote then quiz, using server reward values on the final result", async () => {
 const fetcher = mockArtFetch([artQuiz, artVote], async id => Response.json({ mission: { ...completion.mission, id, type: id === artVote.id ? "vote" : "quiz", correctness: id === artVote.id ? null : true, scorePoints: 3, ticketAmount: 2 } }));
 render(<LiveMissionScreen slug={elinaLiveSlug} locale="ko" />);
 expect(await screen.findByRole("button", { name: "이 작품으로 결정" })).toBeDisabled();
 fireEvent.click(screen.getByRole("radio", { name: "플라잉 코퍼" }));
 fireEvent.click(screen.getByRole("button", { name: "이 작품으로 결정" }));
 expect(await screen.findByRole("heading", { name: "빨간 풍선의 모양은?" })).toHaveFocus();
 expect(screen.getByRole("button", { name: "취향 고르기 완료" })).toBeDisabled();
 fireEvent.click(screen.getByRole("radio", { name: "하트" }));
 fireEvent.click(screen.getByRole("button", { name: "정답 확인하기" }));
 expect(await screen.findByRole("heading", { name: /두 미션.*모두 완료/ })).toHaveFocus();
 expect(screen.getByRole("status")).toHaveTextContent("정답이에요");
 expect(screen.getByText("+3")).toBeInTheDocument();
 expect(screen.getByText("+2")).toBeInTheDocument();
 expect(screen.getByRole("link", { name: "엘리나 팬페이지로" })).toHaveAttribute("href", "/c/elina?locale=ko");
 expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
});

it("completes an incorrect quiz without claiming a correct answer or offering resubmission", async () => {
 mockArtFetch([{ ...artVote, completed: true }, artQuiz], async id => Response.json({ mission: { ...completion.mission, id, correctness: false, scorePoints: 0, ticketAmount: 0 } }));
 render(<LiveMissionScreen slug={elinaLiveSlug} locale="ko" />);
 fireEvent.click(await screen.findByRole("radio", { name: "별" }));
 fireEvent.click(screen.getByRole("button", { name: "정답 확인하기" }));
 expect(await screen.findByRole("status")).toHaveTextContent("정답은 아니지만, 미션 참여는 완료됐어요");
 expect(screen.getAllByText("+0")).toHaveLength(2);
 expect(screen.queryByRole("button", { name: "정답 확인하기" })).not.toBeInTheDocument();
 expect(screen.queryByText(/정답이에요/)).not.toBeInTheDocument();
});

it("shows a truthful already-completed state with no reconstructed rewards", async () => {
 const fetcher = mockArtFetch([{ ...artVote, completed: true }, { ...artQuiz, completed: true }]);
 render(<LiveMissionScreen slug={elinaLiveSlug} locale="en" />);
 expect(await screen.findByRole("heading", { name: /Both missions.*complete/ })).toBeInTheDocument();
 expect(screen.queryByRole("region", { name: "Rewards from this mission" })).not.toBeInTheDocument();
 expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
 expect(screen.getByRole("link", { name: "Back to Elina" })).toHaveAttribute("href", "/c/elina?locale=en");
 expect(fetcher.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
});

it("locks art controls while submitting and preserves the answer and idempotency key after failure", async () => {
 const post = deferred<Response>();
 const fetcher = mockArtFetch([artVote, artQuiz], () => post.promise);
 render(<LiveMissionScreen slug={elinaLiveSlug} locale="ko" />);
 fireEvent.click(await screen.findByRole("radio", { name: "러브 랫" }));
 const button = screen.getByRole("button", { name: "이 작품으로 결정" });
 fireEvent.click(button); fireEvent.click(button);
 expect(screen.getByRole("radio", { name: "풍선을 든 소녀" })).toBeDisabled();
 expect(screen.getByRole("button", { name: "디테일 퀴즈" })).toBeDisabled();
 await act(async () => post.resolve(Response.json({ error: { code: "MISSION_UNAVAILABLE" } }, { status: 503 })));
 expect(await screen.findByRole("alert")).toHaveTextContent("선택한 답은 그대로예요");
 expect(screen.getByRole("radio", { name: "러브 랫" })).toBeChecked();
 fireEvent.click(screen.getByRole("button", { name: "이 작품으로 결정" }));
 await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2));
 const bodies = fetcher.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(String(init?.body)));
 expect(bodies[0]).toEqual(bodies[1]);
});

it("keeps changed CMS questions and falls back for unsupported mission structures", async () => {
 mockArtFetch([artVote, { ...artQuiz, questions: [{ ...artQuiz.questions[0], text: "새로 등록된 질문" }] }]);
 render(<LiveMissionScreen slug={elinaLiveSlug} locale="ko" />);
 fireEvent.click(await screen.findByRole("button", { name: "디테일 퀴즈" }));
 expect(screen.getByRole("heading", { name: "새로 등록된 질문" })).toBeInTheDocument();
 const list = liveMissionListSchema.parse([artVote, artQuiz]);
 expect(supportsArtMissionPlay(list)).toBe(true);
 expect(supportsArtMissionPlay([{ ...list[0], questions: [...list[0].questions, list[0].questions[0]] }, list[1]])).toBe(false);
 expect(supportsArtMissionPlay([{ ...list[0], questions: [{ ...list[0].questions[0], media: { type: "video", url: "https://example.com/instructions.mp4" } }] }, list[1]])).toBe(false);
});
