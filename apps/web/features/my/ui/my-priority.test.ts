import { afterEach, describe, expect, it, vi } from "vitest";
import { prioritizeReservedLives } from "../domain/my-summary";
import { passportProgressLabel,scheduleRaffleBoundary } from "./my-screen";
import type { MySummary } from "../domain/my-summary";
afterEach(()=>vi.useRealTimers());
describe("MY display semantics",()=>{
 it("sorts active before scheduled and excludes ended/cancelled without mutation",()=>{
  const events=(["scheduled","cancelled","live","ended"] as const).map((effectiveStatus,i)=>({id:String(i),slug:String(i),title:String(i),startsAt:`2026-09-0${i+1}T00:00:00Z`,effectiveStatus,attended:false}));
  expect(prioritizeReservedLives(events,Date.parse("2026-08-01T00:00:00Z")).map(e=>e.effectiveStatus)).toEqual(["live","scheduled"]);
  expect(events[0].effectiveStatus).toBe("scheduled");
 });
 it("excludes past scheduled reservations and orders future reservations",()=>{
  const events=[
   {id:"past-new",slug:"past-new",title:"Past newer",startsAt:"2026-09-20T00:00:00Z",effectiveStatus:"scheduled" as const,attended:false},
   {id:"future-later",slug:"future-later",title:"Future later",startsAt:"2026-10-02T00:00:00Z",effectiveStatus:"scheduled" as const,attended:false},
   {id:"past-old",slug:"past-old",title:"Past older",startsAt:"2026-09-10T00:00:00Z",effectiveStatus:"scheduled" as const,attended:false},
   {id:"future-near",slug:"future-near",title:"Future near",startsAt:"2026-09-28T00:00:00Z",effectiveStatus:"scheduled" as const,attended:false},
  ];
  expect(prioritizeReservedLives(events,Date.parse("2026-09-27T00:00:00Z")).map(event=>event.id)).toEqual(["future-near","future-later"]);
 });
 it("expires scheduled reservations at the exact start across timezone offsets, while retaining live ones",()=>{
  const event={id:"reservation",slug:"reservation",title:"Reserved LIVE",startsAt:"2026-09-30T07:00:00+09:00",effectiveStatus:"scheduled" as const,attended:false};
  const start=Date.parse("2026-09-29T22:00:00Z");
  expect(prioritizeReservedLives([event],start-1)).toEqual([event]);
  expect(prioritizeReservedLives([event],start)).toEqual([]);
  expect(prioritizeReservedLives([event],start+1)).toEqual([]);
  expect(prioritizeReservedLives([{...event,effectiveStatus:"live"}],start+86400000)).toHaveLength(1);
 });
 it("uses the tier order but never invents remaining points or a goal after Diamond",()=>{
  const passport={id:"1",tier:"Bronze",score:3,remainingToNextTier:12} as NonNullable<MySummary["creators"][number]["passport"]>;
  expect(passportProgressLabel(passport,"ko")).toContain("실버까지 팬 점수 12점");
  expect(passportProgressLabel({...passport,tier:"Diamond",remainingToNextTier:0},"ko")).toContain("최고 등급");
 });
 it("refreshes a preparing raffle as soon as its opening boundary is crossed",()=>{
  vi.useFakeTimers();
  const now=Date.parse("2026-09-10T00:00:00Z");
  vi.setSystemTime(now);
  const boundary=vi.fn(); const retry=vi.fn();
  scheduleRaffleBoundary([{id:"10000000-0000-4000-8000-000000000001",benefitId:"20000000-0000-4000-8000-000000000001",title:"Prize",summary:"Summary",imageUrl:null,winnerQuantity:1,status:"preparing",entryOpensAt:"2026-09-10T00:00:01Z",entryClosesAt:"2026-09-10T01:00:00Z",fulfillmentMethod:"digital",perFanTicketLimit:null}],now,boundary,retry);
  vi.advanceTimersByTime(1_000);
  expect(retry).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(boundary).toHaveBeenCalledOnce();
  expect(retry).toHaveBeenCalledOnce();
 });
});
