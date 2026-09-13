import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecurringLivePanel } from "./recurring-live-panel";
const id="11111111-1111-4111-8111-111111111111";
const candidate="22222222-2222-4222-8222-222222222222";
const data={roster:{celebrities:[{id,slug:"ifewknow",nameKo:"이퓨",nameEn:"IfeW",latestObservation:{result:"regular",verification:"verified",observedAt:"2026-09-13T13:23:00Z"}}]},reviews:[{id,seriesId:id,celebrityName:"이퓨",revision:2,reason:"duplicate",rule:null,currentRule:null,expectedCurrentRevisionId:id,observations:[{sourceUrl:"https://www.tiktok.com/@ifewknow",originalText:"Mon-Fri 7am KST",observedAt:"2026-09-13T13:23:00Z"}],reviewPayload:{candidateEventIds:[candidate],candidateEvents:[{id:candidate,slug:"ifew-event",startsAt:"2026-09-14T22:00:00Z",title:"기존 방송",reservationCount:4}]}}]};
afterEach(()=>vi.unstubAllGlobals());
const token=async()=>"synthetic-token";
describe("recurring operator review",()=>{
 it("shows evidence and existing reservation count but no write controls to viewer",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json(data)));
  render(<RecurringLivePanel locale="ko" role="viewer" getAccessToken={token}/>);
  await screen.findByText("정기 규칙 확인");expect(screen.getByRole("link",{name:"공식 출처"})).toHaveAttribute("href","https://www.tiktok.com/@ifewknow");
  expect(screen.queryByRole("button",{name:"이 LIVE에 연결"})).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"규칙 승인"})).not.toBeInTheDocument();
 });
 it("requires explicit selection and reason before cancelling and preserves the review CAS",async()=>{
  const fetch=vi.fn(async(_url:unknown,options?:RequestInit)=>Response.json(options?.method==="POST"?{status:"resolved"}:data));vi.stubGlobal("fetch",fetch);
  render(<RecurringLivePanel locale="ko" role="admin" getAccessToken={token}/>);
  const cancel=await screen.findByRole("button",{name:"선택한 LIVE 취소"});expect(cancel).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));expect(cancel).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox",{name:"처리 사유 (거절·취소)"}),{target:{value:"공식 휴방 공지 확인"}});expect(cancel).toBeEnabled();fireEvent.click(cancel);
  await waitFor(()=>expect(fetch.mock.calls.some(([,options])=>options?.method==="POST")).toBe(true));
  const request=fetch.mock.calls.find(([,options])=>options?.method==="POST")?.[1];
  expect(JSON.parse(String(request?.body))).toEqual({revisionId:id,expectedCurrentRevisionId:id,resolution:{action:"cancel_occurrences",eventIds:[candidate],reason:"공식 휴방 공지 확인"}});
 });
});
