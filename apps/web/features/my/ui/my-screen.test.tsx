import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MyScreen } from "./my-screen";

const id="11111111-1111-4111-8111-111111111111";
const summary={profile:{nickname:"카밀리아"},creators:[{celebrity:{slug:"kara",name:"KARA",image:"/kara.jpg"},relationship:"passport",passport:{id,tier:"Silver",score:15,remainingToNextTier:35},ticketBalance:4,firstReaction:{completedAt:"2026-09-03T00:00:00.000Z",txHash:null}}],live:{upcoming:[],history:[]},rewards:{availableCount:2,entries:3,items:[]},collection:{passportCount:1,stampCount:2,collectibleCount:0,recent:[]},unreadNotificationCount:1};
const getAccessToken=vi.fn(async()=>"token");
vi.mock("@privy-io/react-auth",()=>({usePrivy:()=>({ready:true,authenticated:true,getAccessToken})}));

describe("unified MY hub",()=>{
 it("renders the four owner activity sections and current Tier progress",async()=>{vi.stubGlobal("fetch",vi.fn(async()=>Response.json({summary})));render(<MyScreen locale="ko"/>);expect(await screen.findByRole("heading",{name:"My Creators"})).toBeInTheDocument();expect(screen.getByText("실버 · 15 Score · 35 점 남음")).toBeInTheDocument();expect(screen.getByRole("heading",{name:"LIVE"})).toBeInTheDocument();expect(screen.getByRole("heading",{name:"Rewards"})).toBeInTheDocument();expect(screen.getByRole("heading",{name:"Collection"})).toBeInTheDocument();expect(screen.getByText("알림 설정").closest("a")).toHaveAttribute("href","/settings?locale=ko");});
 it("renders explicit empty states",async()=>{vi.stubGlobal("fetch",vi.fn(async()=>Response.json({summary:{...summary,creators:[],rewards:{availableCount:0,entries:0,items:[]},collection:{passportCount:0,stampCount:0,collectibleCount:0,recent:[]}}})));render(<MyScreen locale="ko"/>);expect(await screen.findByText("아직 연결된 Creator가 없어요.")).toBeInTheDocument();expect(screen.getByText("예약한 LIVE가 없어요.")).toBeInTheDocument();expect(screen.getByText("아직 Reward 이력이 없어요.")).toBeInTheDocument();expect(screen.getByText("아직 수집한 항목이 없어요.")).toBeInTheDocument();});
});
