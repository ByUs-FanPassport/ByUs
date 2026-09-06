import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CreatorFanLink } from "./creator-fan-link";
import { notifyFanActivityUpdated } from "./fan-activity-updates";
let authenticated = true;
const getAccessToken = vi.fn(async()=>"token");
vi.mock("@privy-io/react-auth",()=>({usePrivy:()=>({ready:true,authenticated,user:{id:"owner"},getAccessToken})}));
const reaction={reactionId:"11111111-1111-4111-8111-111111111111",status:"completed",mintStatus:"queued",blockchainJobId:"22222222-2222-4222-8222-222222222222",created:false,passportExists:false};
beforeEach(()=>{authenticated=true;vi.unstubAllGlobals()});
it("shows a filled heart for recorded reactions even before minting or Passport issuance",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json({reaction})));
 render(<CreatorFanLink slug="elina" name="엘리나" locale="ko"/>);
 expect(await screen.findByRole("link",{name:"엘리나 입덕 완료"})).toHaveAttribute("data-reacted","true");
});
it("refreshes a mounted card after a reaction is recorded elsewhere",async()=>{
 let recorded=false;vi.stubGlobal("fetch",vi.fn(async()=>Response.json({reaction:recorded?reaction:null})));
 render(<CreatorFanLink slug="elina" name="엘리나" locale="ko"/>);
 await screen.findByRole("link",{name:"엘리나 입덕하기"});
 recorded=true;act(()=>notifyFanActivityUpdated("owner"));
 await screen.findByRole("link",{name:"엘리나 입덕 완료"});
});
it("does not keep a previous owner's filled heart after logout",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json({reaction})));
 const {rerender}=render(<CreatorFanLink slug="elina" name="엘리나" locale="ko"/>);
 await screen.findByRole("link",{name:"엘리나 입덕 완료"});authenticated=false;
 rerender(<CreatorFanLink slug="elina" name="엘리나" locale="ko"/>);
 expect(screen.getByRole("link",{name:"엘리나 입덕하기"})).not.toHaveAttribute("data-reacted");
});
