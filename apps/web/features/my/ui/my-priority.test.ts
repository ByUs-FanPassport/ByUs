import { describe,it,expect } from "vitest";
import { prioritizeReservedLives,passportProgressLabel } from "./my-screen";
import type { MySummary } from "../domain/my-summary";
describe("MY display semantics",()=>{
 it("sorts active before scheduled and excludes ended/cancelled without mutation",()=>{
  const events=(["scheduled","cancelled","live","ended"] as const).map((effectiveStatus,i)=>({id:String(i),slug:String(i),title:String(i),startsAt:`2026-09-0${i+1}T00:00:00Z`,effectiveStatus,attended:false}));
  expect(prioritizeReservedLives(events).map(e=>e.effectiveStatus)).toEqual(["live","scheduled"]);
  expect(events[0].effectiveStatus).toBe("scheduled");
 });
 it("uses the tier order but never invents remaining points or a goal after Diamond",()=>{
  const passport={id:"1",tier:"Bronze",score:3,remainingToNextTier:12} as NonNullable<MySummary["creators"][number]["passport"]>;
  expect(passportProgressLabel(passport,"ko")).toContain("실버까지 팬 점수 12점");
  expect(passportProgressLabel({...passport,tier:"Diamond",remainingToNextTier:0},"ko")).toContain("최고 등급");
 });
});
